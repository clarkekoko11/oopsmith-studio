// Electron main process: window, IPC, settings, account check and agents.
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AccountState, AgentEvent, AgentId, ShortRow, UsageState } from '../shared/types';
import { checkAccount } from './account';
import { DAILY_KICKOFF } from './agentDefs';
import { Pipeline } from './pipeline';
import { applyUpdate, checkForUpdate } from './updater';
import { allUsage, totalTokens } from './usage';
import { disableWorkerUpload, signInYouTube, useClientSecret, youtubeStatus } from './youtube';
import { detectRenderReady, outputDir, setupRendering, shortsCmd, stopJob } from './render';
import { basename } from 'node:path';
import { cloneToolkit, commitAndPush, pullToolkit } from './git';
import { claudeExecutable } from './sdk';
import { AgentManager } from './agents';
import { inside } from './permissions';
import { loadSettings, saveSettings, setGeminiKey, testGeminiKey } from './settings';

const here = dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow | undefined;
let account: AccountState = { checked: false, signedIn: false, apiKeyInEnv: false };

protocol.registerSchemesAsPrivileged([
  { scheme: 'toolkit', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload);
const agents = new AgentManager(
  (e: AgentEvent) => send('agent:event', e),
  (u: UsageState) => send('usage', u),
);
const pipeline = new Pipeline(agents, join(app.getAppPath(), 'resources', 'yt_upload.py').replace(`app.asar${sep}`, `app.asar.unpacked${sep}`));
pipeline.onChange = () => send('board:changed', null);
pipeline.onBlocked = (message) => {
  send('pipeline:blocked', message);
  agents.post('editor', { kind: 'notice', tone: 'warn', text: message });
  void autoDetectRendering();
};
/** If the render worker was already set up on this PC, mark rendering ready without re-running setup. */
async function autoDetectRendering() {
  const s = loadSettings();
  if (s.renderReady || !s.toolkitPath || !existsSync(s.toolkitPath)) return;
  const py = await detectRenderReady(s.pythonCommand, s.toolkitPath);
  if (!py) return;
  saveSettings({ renderReady: true, pythonCommand: py });
  send('pipeline:blocked', '');
  agents.post('editor', { kind: 'notice', text: `Rendering was already set up on this PC (found with "${py}"), so I can build and render now.` });
  void pipeline.tick();
}
agents.onUsage(() => send('board:changed', null));
agents.onTurnEnd(() => {
  send('board:changed', null);
  void pipeline.tick();
});

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#1b1d29',
    title: 'Oopsmith Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(join(here, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function shorts(): ShortRow[] {
  const root = loadSettings().toolkitPath;
  const usage = allUsage();
  try {
    const reg = JSON.parse(readFileSync(join(root, 'shorts', 'registry.json'), 'utf8')) as {
      shorts: Record<string, { id: string; title?: string; topic?: string; status?: string; version?: number; file?: string; youtube_id?: string }>;
    };
    return Object.values(reg.shorts)
      .map((s) => {
        const u = usage[s.id];
        return { id: s.id, title: s.title || s.topic || '(untitled)', status: s.status || 'new', version: s.version || 1, tokens: u ? totalTokens(u.total) : undefined, file: s.file };
      })
      .sort((a, b) => b.id.localeCompare(a.id));
  } catch {
    return [];
  }
}

app.whenReady().then(() => {
  // toolkit://file/<relative path> serves files from the toolkit folder only (audio players in chat).
  protocol.handle('toolkit', (req) => {
    const url = new URL(req.url);
    if (url.host === 'video') {
      // finished renders, from the worker's output folder only
      const dir = outputDir(loadSettings().toolkitPath);
      const full = join(dir, basename(decodeURIComponent(url.pathname)));
      if (!existsSync(full)) return new Response('not found', { status: 404 });
      return net.fetch(pathToFileURL(full).toString(), { headers: req.headers });
    }
    const root = loadSettings().toolkitPath;
    const rel = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const full = resolve(root, rel);
    if (!root || !inside(root, full) || !existsSync(full)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(full).toString());
  });

  ipcMain.handle('agents:list', () => agents.list());
  ipcMain.handle('usage:get', () => allUsage());
  ipcMain.handle('review:get', (_e, id: string) => {
    const s = loadSettings();
    const row = shorts().find((r) => r.id === id);
    let review: string | null = null;
    try { review = readFileSync(join(s.toolkitPath, 'shorts', id, 'review.md'), 'utf8'); } catch { /* none yet */ }
    const video = row?.file && existsSync(join(outputDir(s.toolkitPath), row.file)) ? `toolkit://video/${encodeURIComponent(row.file)}` : null;
    let publish: string | null = null;
    try { publish = readFileSync(join(s.toolkitPath, 'shorts', id, 'publish.md'), 'utf8'); } catch { /* none yet */ }
    let youtubeId: string | null = null;
    try {
      youtubeId = (JSON.parse(readFileSync(join(s.toolkitPath, 'shorts', 'registry.json'), 'utf8')).shorts[id]?.youtube_id as string) ?? null;
    } catch { /* none */ }
    return { id, status: row?.status ?? '', waiting: pipeline.explain(id), review, publish, youtubeId, videoUrl: video, usage: allUsage()[id] ?? null };
  });
  // your own decision from the review screen overrides Hawk's
  ipcMain.handle('review:decide', async (_e, id: string, approve: boolean, notes: string) => {
    const s = loadSettings();
    const file = join(s.toolkitPath, 'shorts', id, 'review.md');
    const stamp = new Date().toLocaleString();
    const note = notes.trim();
    if (approve) {
      if (note) appendFileSync(file, `\n\n## From you (${stamp})\nAPPROVED. ${note}\n`);
      await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', id, 'status=approved']);
    } else {
      if (!note) return { ok: false, message: 'Write what should change first.' };
      appendFileSync(file, `\n\n## From you (${stamp}) — CHANGES\n${note}\n`);
      await shortsCmd(s.pythonCommand, s.toolkitPath, ['revise', id, `You: ${note.split('\n')[0].slice(0, 120)}`]);
      await shortsCmd(s.pythonCommand, s.toolkitPath, ['set', id, 'status=changes_requested']);
      pipeline.follow(id); // your request moves on even with Autopilot off
    }
    const g = await commitAndPush(s.toolkitPath, [`shorts/${id}`, 'shorts/registry.json', 'SHORTS.md'], `${id}: ${approve ? 'approved' : 'changes requested'} by you`);
    send('board:changed', null);
    await pipeline.tick();
    const next = approve ? '' : ` ${pipeline.explain(id)}`;
    return { ok: true, message: `${approve ? 'Approved' : 'Changes requested'}. ${g.message}${next}` };
  });
  ipcMain.handle('review:upload', async (_e, id: string) => {
    const s = loadSettings();
    if (!youtubeStatus(s.toolkitPath).signedIn) return { ok: false, message: 'Connect YouTube first: Settings → YouTube.' };
    pipeline.requestUpload(id);
    await pipeline.tick();
    return { ok: true, message: pipeline.explain(id) };
  });
  ipcMain.handle('youtube:status', () => youtubeStatus(loadSettings().toolkitPath));
  ipcMain.handle('youtube:client-secret', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose client_secret.json (OAuth client, Desktop app)', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, message: 'No file chosen.' };
    try {
      const j = JSON.parse(readFileSync(r.filePaths[0], 'utf8'));
      if (!j.installed && !j.web) return { ok: false, message: "That file doesn't look like a Google OAuth client (Desktop app)." };
      useClientSecret(loadSettings().toolkitPath, r.filePaths[0]);
      return { ok: true, message: 'client_secret.json saved in the toolkit (it is git-ignored, never pushed).' };
    } catch (e) {
      return { ok: false, message: `Couldn't read it: ${(e as Error).message}` };
    }
  });
  ipcMain.handle('youtube:sign-in', async () => {
    const s = loadSettings();
    const r = await signInYouTube(s.pythonCommand, s.toolkitPath, (l) => send('youtube:log', l));
    if (r.ok && disableWorkerUpload(s.toolkitPath)) {
      send('youtube:log', "Turned off the render worker's own YouTube upload: uploads now happen after review, through Pip.");
    }
    if (r.ok) void pipeline.tick();
    return r;
  });
  ipcMain.handle('review:send-on', async (_e, id: string) => {
    pipeline.follow(id);
    await autoDetectRendering();
    await pipeline.tick();
    send('board:changed', null);
    return pipeline.explain(id);
  });
  ipcMain.handle('app:version', () => app.getVersion());
  const checkUpdates = async () => {
    const u = await checkForUpdate();
    send('update', u);
    return u;
  };
  ipcMain.handle('update:check', checkUpdates);
  ipcMain.handle('update:apply', async () => {
    agents.closeAll();
    const r = await applyUpdate((step) => send('update', { available: true, behind: 0, changes: [], busy: step }));
    if (!r.ok) send('update', { available: true, behind: 0, changes: [], error: r.message });
    return r;
  });
  setTimeout(() => void checkUpdates(), 8000);
  setInterval(() => void checkUpdates(), 3 * 60 * 60 * 1000);
  ipcMain.handle('agents:daily', () => runDaily('manual'));
  ipcMain.handle('agents:history', (_e, id: AgentId) => agents.history(id));
  ipcMain.handle('agents:send', (_e, id: AgentId, text: string) => agents.send(id, text));
  ipcMain.handle('agents:stop', (_e, id: AgentId) => agents.stop(id));
  ipcMain.handle('agents:new', (_e, id: AgentId) => agents.newChat(id));
  ipcMain.handle('agents:permission', (_e, id: AgentId, permId: string, allow: boolean) => agents.answer(id, permId, allow));

  ipcMain.handle('account:get', () => account);
  ipcMain.handle('account:recheck', async () => (account = await checkAccount()));
  // Opens a terminal running Claude Code so you can type /login (the app never sees your password).
  ipcMain.handle('account:login', () => {
    const exe = claudeExecutable();
    if (!exe) return { ok: false, message: 'Claude Code was not found. Re-run npm install in the app folder.' };
    if (process.platform === 'win32') spawn('cmd.exe', ['/d', '/s', '/c', `start "Claude sign-in" cmd /k ""${exe}""`], { detached: true, windowsVerbatimArguments: true }).unref();
    else if (process.platform === 'darwin') spawn('open', ['-a', 'Terminal', exe], { detached: true }).unref();
    else spawn('x-terminal-emulator', ['-e', exe], { detached: true }).unref();
    return { ok: true, message: 'A terminal opened. Type /login, finish signing in, close it, then press Check again.' };
  });

  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:save', (_e, patch) => saveSettings(patch));
  ipcMain.handle('settings:gemini', (_e, key: string) => {
    try {
      setGeminiKey(key);
      return { ok: true, message: key.trim() ? 'Gemini key saved.' : 'Gemini key removed.' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  });
  ipcMain.handle('settings:gemini-test', () => testGeminiKey());
  ipcMain.handle('settings:pick-toolkit', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose your roblox-shorts-toolkit folder', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    saveSettings({ toolkitPath: p });
    return p;
  });

  const toolkitStatus = (s: { busy: boolean; ok?: boolean; message: string }) => send('toolkit', s);
  const doClone = async () => {
    const s = loadSettings();
    toolkitStatus({ busy: true, message: `Getting ${s.toolkitRepo} from GitHub…` });
    const r = await cloneToolkit(s.toolkitRepo, s.toolkitPath, (line) => toolkitStatus({ busy: true, message: line.slice(0, 120) }));
    toolkitStatus({ busy: false, ...r });
    return r;
  };
  const doSync = async () => {
    const s = loadSettings();
    if (!existsSync(s.toolkitPath)) return doClone();
    const r = await pullToolkit(s.toolkitPath);
    toolkitStatus({ busy: false, ...r });
    return r;
  };
  ipcMain.handle('toolkit:clone', doClone);
  ipcMain.handle('toolkit:sync', doSync);
  ipcMain.handle('shorts:list', () => shorts());
  ipcMain.handle('render:setup', async () => {
    const s = loadSettings();
    const logFile = join(app.getPath('userData'), 'render-setup.log');
    writeFileSync(logFile, `setup ${new Date().toISOString()}\n`);
    const r = await setupRendering(
      s.pythonCommand,
      s.toolkitPath,
      (activity, line) => {
        try { appendFileSync(logFile, line + '\n'); } catch { /* ignore */ }
        send('render:setup', { busy: true, activity, line });
      },
      (py) => saveSettings({ pythonCommand: py }),
    );
    try { appendFileSync(logFile, `RESULT: ${r.message}\n`); } catch { /* ignore */ }
    if (r.ok) saveSettings({ renderReady: true });
    send('render:setup', { busy: false, ok: r.ok, activity: r.message, line: '' });
    if (r.ok) void pipeline.tick();
    return r;
  });
  ipcMain.handle('render:open-log', () => shell.openPath(join(app.getPath('userData'), 'render-setup.log')));
  ipcMain.handle('render:open-output', async () => {
    const dir = outputDir(loadSettings().toolkitPath);
    await shell.openPath(dir);
    return dir;
  });
  ipcMain.handle('file:url', (_e, rel: string, source?: string) => {
    if (source === 'video') return `toolkit://video/${encodeURIComponent(basename(rel))}`;
    const root = loadSettings().toolkitPath;
    const full = resolve(root, rel);
    return root && inside(root, full) && existsSync(full) ? `toolkit://file/${rel.split(/[\\/]/).map(encodeURIComponent).join('/')}` : null;
  });

  createWindow();
  setTimeout(() => void autoDetectRendering(), 5000);
  if (process.env.OOPSMITH_SMOKE) {
    win!.webContents.on('console-message', (e) => console.log('[renderer]', (e as unknown as { message: string }).message));
    // test mode: save a screenshot of the window and quit
    setTimeout(async () => {
      console.log('[renderer errors]', await win!.webContents.executeJavaScript('JSON.stringify(window.__errors || [])'));
      const img = await win!.webContents.capturePage();
      writeFileSync(process.env.OOPSMITH_SMOKE!, img.toPNG());
      app.quit();
    }, Number(process.env.OOPSMITH_SMOKE_MS ?? 12000));
  }
  // get the latest toolkit: clone it on first run, pull it every start
  win!.webContents.once('did-finish-load', () => void doSync());
  checkAccount().then((a) => {
    account = a;
    send('account', a);
  });
});

// ---- daily autopilot run: once a day at settings.dailyTime (or the first time the app is open after it)
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
async function runDaily(reason: 'manual' | 'schedule') {
  if (!agents.isIdle('script-writer')) return;
  const started = await agents.send('script-writer', DAILY_KICKOFF, reason === 'schedule' ? "Daily run: make today's Short" : "Make today's Short", { fresh: true });
  if (started && reason === 'schedule') saveSettings({ lastDailyRun: today() });
}
setInterval(() => void pipeline.tick(), 60_000);
setInterval(() => {
  const s = loadSettings();
  if (!s.autopilot || !/^\d{1,2}:\d{2}$/.test(s.dailyTime) || s.lastDailyRun === today() || !account.signedIn) return;
  const [h, m] = s.dailyTime.split(':').map(Number);
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() >= h * 60 + m) void runDaily('schedule');
}, 60_000);

app.on('window-all-closed', () => {
  agents.closeAll();
  stopJob();
  app.quit();
});
