// Electron main process: window, IPC, settings, account check and agents.
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAIN_TEAM, type AccountState, type AgentEvent, type AgentId, type ShortRow, type TeamId, type UsageState } from '../shared/types';
import { checkAccount } from './account';
import { DAILY_KICKOFF } from './agentDefs';
import { Pipeline } from './pipeline';
import { applyUpdate, checkForUpdate } from './updater';
import { allUsage, totalTokens } from './usage';
import { disableWorkerUpload, listChannels } from './buffer';
import { getSecret, hasSecret, setSecret } from './secrets';
import { publishSetupMissing } from './pipeline';
import { signInYouTube, useClientSecret, youtubeStatus } from './youtube';
import { detectRenderReady, outputDir, setupRendering, shortsCmd, stopJob } from './render';
import { basename } from 'node:path';
import { cloneToolkit, commitAndPush, pullToolkit } from './git';
import { claudeExecutable } from './sdk';
import { AgentManager } from './agents';
import { inside } from './permissions';
import { loadSettings, saveSettings, setGeminiKey, testGeminiKey } from './settings';
import { addTeam, listTeams, removeTeam, renameTeam, setTeamPath, setTeamRepo, settingsFor } from './teams';

const here = dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow | undefined;
let account: AccountState = { checked: false, signedIn: false, apiKeyInEnv: false };

protocol.registerSchemesAsPrivileged([
  { scheme: 'toolkit', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload);
const helper = (f: string) => join(app.getAppPath(), 'resources', f).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);

/** One crew per team: its four desks and the pipeline that moves its Shorts between them. Teams run in parallel;
 *  the graphics card and uploads are shared, so renders and uploads take turns across teams. */
interface Crew { agents: AgentManager; pipeline: Pipeline }
const crews = new Map<TeamId, Crew>();

function makeCrew(team: TeamId): Crew {
  const agents = new AgentManager(
    team,
    (e: AgentEvent) => send('agent:event', e),
    (u: UsageState) => send('usage', u),
  );
  const pipeline = new Pipeline(team, agents, { upload: helper('yt_upload.py'), status: helper('yt_status.py') });
  pipeline.onChange = () => send('board:changed', team);
  pipeline.onBlocked = (message) => {
    send('pipeline:blocked', { team, message });
    agents.post('editor', { kind: 'notice', tone: 'warn', text: message });
    void autoDetectRendering(team);
  };
  agents.onUsage(() => send('board:changed', team));
  agents.onTurnEnd(() => {
    send('board:changed', team);
    void tickAll();
  });
  return { agents, pipeline };
}
/** Keep the crews in step with the team list (after adding or removing a team). */
function syncCrews() {
  const ids = listTeams().map((t) => t.id);
  for (const id of ids) if (!crews.has(id)) crews.set(id, makeCrew(id));
  for (const [id, c] of crews) {
    if (ids.includes(id)) continue;
    c.agents.closeAll();
    crews.delete(id);
  }
}
syncCrews();
const crew = (team: TeamId | undefined): Crew => crews.get(team || MAIN_TEAM) ?? crews.get(MAIN_TEAM)!;
/** Any team's work can free the graphics card, so every finished job nudges every team. */
const tickAll = async () => { for (const c of crews.values()) await c.pipeline.tick(); };

/** If the render worker was already set up on this PC, mark rendering ready without re-running setup. */
async function autoDetectRendering(team: TeamId = MAIN_TEAM) {
  const s = settingsFor(team);
  if (s.renderReady || !s.toolkitPath || !existsSync(s.toolkitPath)) return;
  const py = await detectRenderReady(s.pythonCommand, s.toolkitPath);
  if (!py) return;
  saveSettings({ renderReady: true, pythonCommand: py });
  send('pipeline:blocked', { team, message: '' });
  crew(team).agents.post('editor', { kind: 'notice', text: `Rendering was already set up on this PC (found with "${py}"), so I can build and render now.` });
  void tickAll();
}

const toolkitStatus = (s: { team: TeamId; busy: boolean; ok?: boolean; message: string }) => send('toolkit', s);
async function doClone(team: TeamId) {
  const s = settingsFor(team);
  toolkitStatus({ team, busy: true, message: `Getting ${s.toolkitRepo} from GitHub…` });
  const r = await cloneToolkit(s.toolkitRepo, s.toolkitPath, (line) => toolkitStatus({ team, busy: true, message: line.slice(0, 120) }));
  toolkitStatus({ team, busy: false, ...r });
  if (r.ok) send('board:changed', team);
  return r;
}
async function doSync(team: TeamId) {
  const s = settingsFor(team);
  if (!existsSync(s.toolkitPath)) return doClone(team);
  const r = await pullToolkit(s.toolkitPath);
  toolkitStatus({ team, busy: false, ...r });
  return r;
}

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

function shorts(team: TeamId): ShortRow[] {
  const root = settingsFor(team).toolkitPath;
  const usage = allUsage(team);
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
    // toolkit://video/<team>/<file> and toolkit://file/<team>/<path>
    const [team, ...rest] = url.pathname.replace(/^\//, '').split('/');
    const ts = settingsFor(decodeURIComponent(team));
    if (url.host === 'video') {
      // finished renders, from the worker's output folder only
      const dir = outputDir(ts.toolkitPath);
      const full = join(dir, basename(decodeURIComponent(rest.join('/'))));
      if (!existsSync(full)) return new Response('not found', { status: 404 });
      return net.fetch(pathToFileURL(full).toString(), { headers: req.headers });
    }
    const root = ts.toolkitPath;
    const rel = rest.map(decodeURIComponent).join('/');
    const full = resolve(root, rel);
    if (!root || !inside(root, full) || !existsSync(full)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(full).toString());
  });

  ipcMain.handle('agents:list', (_e, team: TeamId) => crew(team).agents.list());
  ipcMain.handle('usage:get', (_e, team: TeamId) => allUsage(team));
  const teamsChanged = () => { syncCrews(); const t = listTeams(); send('teams', t); return t; };
  ipcMain.handle('teams:list', () => listTeams());
  ipcMain.handle('teams:add', async (_e, name: string, repo: string) => {
    const r = addTeam(name, repo);
    if (!r.ok || !r.team) return r;
    teamsChanged();
    void doSync(r.team.id).then(() => void tickAll());
    return { ...r, message: `${r.message} Getting ${r.team.toolkitRepo} from GitHub…` };
  });
  ipcMain.handle('teams:rename', (_e, team: TeamId, name: string) => { renameTeam(team, name); return teamsChanged(); });
  ipcMain.handle('teams:repo', (_e, team: TeamId, repo: string) => { setTeamRepo(team, repo); return teamsChanged(); });
  ipcMain.handle('teams:remove', async (_e, team: TeamId) => {
    const c = crews.get(team);
    if (c && team !== MAIN_TEAM) for (const a of c.agents.list()) await c.agents.stop(a.id);
    const r = removeTeam(team);
    if (r.ok) teamsChanged();
    return r;
  });
  ipcMain.handle('review:get', (_e, team: TeamId, id: string) => {
    const s = settingsFor(team);
    const { pipeline } = crew(team);
    const row = shorts(team).find((r) => r.id === id);
    let review: string | null = null;
    try { review = readFileSync(join(s.toolkitPath, 'shorts', id, 'review.md'), 'utf8'); } catch { /* none yet */ }
    const video = row?.file && existsSync(join(outputDir(s.toolkitPath), row.file)) ? `toolkit://video/${encodeURIComponent(team)}/${encodeURIComponent(row.file)}` : null;
    let publish: string | null = null;
    try { publish = readFileSync(join(s.toolkitPath, 'shorts', id, 'publish.md'), 'utf8'); } catch { /* none yet */ }
    let m: { buffer_post_id?: string; youtube_id?: string; publish_at?: string } = {};
    try { m = JSON.parse(readFileSync(join(s.toolkitPath, 'shorts', 'registry.json'), 'utf8')).shorts[id] ?? {}; } catch { /* none */ }
    return {
      id, status: row?.status ?? '', waiting: pipeline.explain(id), review, publish,
      inBuffer: Boolean(m.buffer_post_id), youtubeId: m.youtube_id || null, publishAt: m.publish_at || null,
      videoUrl: video, usage: allUsage(team)[id] ?? null,
    };
  });
  // your own decision from the review screen overrides Hawk's
  ipcMain.handle('review:decide', async (_e, team: TeamId, id: string, approve: boolean, notes: string) => {
    const s = settingsFor(team);
    const { pipeline } = crew(team);
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
    send('board:changed', team);
    await pipeline.tick();
    const next = approve ? '' : ` ${pipeline.explain(id)}`;
    return { ok: true, message: `${approve ? 'Approved' : 'Changes requested'}. ${g.message}${next}` };
  });
  ipcMain.handle('review:upload', async (_e, team: TeamId, id: string) => {
    const { pipeline } = crew(team);
    const missing = publishSetupMissing(settingsFor(team));
    if (missing) return { ok: false, message: `First ${missing}` };
    pipeline.requestUpload(id);
    await pipeline.tick();
    return { ok: true, message: pipeline.explain(id) };
  });
  ipcMain.handle('publish:status', (_e, team: TeamId) => {
    const s = settingsFor(team);
    const missing = publishSetupMissing(s);
    let workerAutoUpload = false;
    try { workerAutoUpload = Boolean(JSON.parse(readFileSync(join(s.toolkitPath, 'worker.json'), 'utf8')).youtube?.enabled); } catch { /* none */ }
    return {
      hasBufferKey: hasSecret('buffer'),
      channel: s.bufferChannelName,
      hostReady: !missing || !/video host/.test(missing),
      missing,
      workerAutoUpload,
    };
  });
  ipcMain.handle('publish:secret', (_e, name: 'buffer' | 'cloudinarySecret' | 'r2Secret', value: string) => {
    try {
      setSecret(name, value);
      if (name === 'buffer' && value.trim() && listTeams().map((t) => disableWorkerUpload(t.toolkitPath)).some(Boolean)) {
        return { ok: true, message: "Saved. Also turned off the render worker's own YouTube upload, so posts only go out after review, through Buffer." };
      }
      void tickAll();
      return { ok: true, message: value.trim() ? 'Saved (encrypted on this PC).' : 'Removed.' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  });
  ipcMain.handle('youtube:status', (_e, team: TeamId) => youtubeStatus(settingsFor(team).toolkitPath));
  ipcMain.handle('youtube:client-secret', async (_e, team: TeamId) => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose client_secret.json (OAuth client, Desktop app)', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, message: 'No file chosen.' };
    try {
      const j = JSON.parse(readFileSync(r.filePaths[0], 'utf8'));
      if (!j.installed && !j.web) return { ok: false, message: "That file doesn't look like a Google OAuth client (Desktop app)." };
      useClientSecret(settingsFor(team).toolkitPath, r.filePaths[0]);
      return { ok: true, message: 'client_secret.json saved in the toolkit (it is git-ignored, never pushed).' };
    } catch (e) {
      return { ok: false, message: `Couldn't read it: ${(e as Error).message}` };
    }
  });
  ipcMain.handle('youtube:sign-in', async (_e, team: TeamId) => {
    const s = settingsFor(team);
    const r = await signInYouTube(s.pythonCommand, s.toolkitPath, (l) => send('youtube:log', l));
    if (r.ok && disableWorkerUpload(s.toolkitPath)) send('youtube:log', "Turned off the render worker's own YouTube upload: posts only go out after review.");
    if (r.ok) void crew(team).pipeline.tick();
    return r;
  });
  ipcMain.handle('review:mark-posted', async (_e, team: TeamId, id: string, whenIso: string | null) => {
    const { pipeline } = crew(team);
    await pipeline.markPosted(id, whenIso);
    send('board:changed', team);
    return pipeline.explain(id);
  });
  ipcMain.handle('review:unmark-posted', async (_e, team: TeamId, id: string) => {
    const { pipeline } = crew(team);
    await pipeline.unmarkPosted(id);
    send('board:changed', team);
    await pipeline.tick();
    return pipeline.explain(id);
  });
  ipcMain.handle('publish:channels', async () => {
    const key = getSecret('buffer');
    if (!key) return { ok: false, message: 'Save your Buffer API key first.', channels: [] };
    try {
      const channels = await listChannels(key);
      return { ok: true, message: channels.some((c) => /youtube/i.test(c.service)) ? '' : 'No YouTube channel is connected in Buffer yet: connect it in Buffer, then refresh.', channels };
    } catch (e) {
      return { ok: false, message: (e as Error).message, channels: [] };
    }
  });
  ipcMain.handle('review:send-on', async (_e, team: TeamId, id: string) => {
    const { pipeline } = crew(team);
    pipeline.follow(id);
    await autoDetectRendering(team);
    await pipeline.tick();
    send('board:changed', team);
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
    for (const c of crews.values()) c.agents.closeAll();
    const r = await applyUpdate((step) => send('update', { available: true, behind: 0, changes: [], busy: step }));
    if (!r.ok) send('update', { available: true, behind: 0, changes: [], error: r.message });
    return r;
  });
  setTimeout(() => void checkUpdates(), 8000);
  setInterval(() => void checkUpdates(), 3 * 60 * 60 * 1000);
  ipcMain.handle('agents:daily', (_e, team: TeamId) => runDaily(team, 'manual'));
  ipcMain.handle('agents:history', (_e, team: TeamId, id: AgentId) => crew(team).agents.history(id));
  ipcMain.handle('agents:send', (_e, team: TeamId, id: AgentId, text: string) => crew(team).agents.send(id, text));
  ipcMain.handle('agents:stop', (_e, team: TeamId, id: AgentId) => crew(team).agents.stop(id));
  ipcMain.handle('agents:new', (_e, team: TeamId, id: AgentId) => crew(team).agents.newChat(id));
  ipcMain.handle('agents:permission', (_e, team: TeamId, id: AgentId, permId: string, allow: boolean) => crew(team).agents.answer(id, permId, allow));

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
  ipcMain.handle('settings:pick-toolkit', async (_e, team: TeamId) => {
    const r = await dialog.showOpenDialog(win!, { title: "Choose this team's toolkit folder", properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    setTeamPath(team, p);
    send('teams', listTeams());
    return p;
  });

  ipcMain.handle('toolkit:clone', (_e, team: TeamId) => doClone(team));
  ipcMain.handle('toolkit:sync', (_e, team: TeamId) => doSync(team));
  ipcMain.handle('shorts:list', (_e, team: TeamId) => shorts(team));
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
    if (r.ok) void tickAll();
    return r;
  });
  ipcMain.handle('render:open-log', () => shell.openPath(join(app.getPath('userData'), 'render-setup.log')));
  ipcMain.handle('render:open-output', async (_e, team: TeamId) => {
    const dir = outputDir(settingsFor(team).toolkitPath);
    await shell.openPath(dir);
    return dir;
  });
  ipcMain.handle('file:url', (_e, team: TeamId, rel: string, source?: string) => {
    const t = encodeURIComponent(team || MAIN_TEAM);
    if (source === 'video') return `toolkit://video/${t}/${encodeURIComponent(basename(rel))}`;
    const root = settingsFor(team).toolkitPath;
    const full = resolve(root, rel);
    return root && inside(root, full) && existsSync(full) ? `toolkit://file/${t}/${rel.split(/[\\/]/).map(encodeURIComponent).join('/')}` : null;
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
  win!.webContents.once('did-finish-load', () => { for (const t of listTeams()) void doSync(t.id); });
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
async function runDaily(team: TeamId, reason: 'manual' | 'schedule') {
  const { agents } = crew(team);
  if (!agents.isIdle('script-writer')) return false;
  return Boolean(await agents.send('script-writer', DAILY_KICKOFF, reason === 'schedule' ? "Daily run: make today's Short" : "Make today's Short", { fresh: true }));
}
setInterval(() => void tickAll(), 60_000);
setInterval(() => {
  const s = loadSettings();
  if (!s.autopilot || !/^\d{1,2}:\d{2}$/.test(s.dailyTime) || s.lastDailyRun === today() || !account.signedIn) return;
  const [h, m] = s.dailyTime.split(':').map(Number);
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  // every team makes its own Short each day, in parallel
  void Promise.all(listTeams().map((t) => runDaily(t.id, 'schedule'))).then((r) => { if (r.some(Boolean)) saveSettings({ lastDailyRun: today() }); });
}, 60_000);

app.on('window-all-closed', () => {
  for (const c of crews.values()) c.agents.closeAll();
  stopJob();
  app.quit();
});
