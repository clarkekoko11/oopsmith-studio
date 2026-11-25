// Electron main process: window, IPC, settings, account check and agents.
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AccountState, AgentEvent, AgentId, ShortRow, UsageState } from '../shared/types';
import { checkAccount } from './account';
import { DAILY_KICKOFF } from './agentDefs';
import { cloneToolkit, pullToolkit } from './git';
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
  try {
    const reg = JSON.parse(readFileSync(join(root, 'shorts', 'registry.json'), 'utf8')) as {
      shorts: Record<string, { id: string; title?: string; topic?: string; status?: string; version?: number }>;
    };
    return Object.values(reg.shorts)
      .map((s) => ({ id: s.id, title: s.title || s.topic || '(untitled)', status: s.status || 'new', version: s.version || 1 }))
      .sort((a, b) => b.id.localeCompare(a.id));
  } catch {
    return [];
  }
}

app.whenReady().then(() => {
  // toolkit://file/<relative path> serves files from the toolkit folder only (audio players in chat).
  protocol.handle('toolkit', (req) => {
    const root = loadSettings().toolkitPath;
    const rel = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''));
    const full = resolve(root, rel);
    if (!root || !inside(root, full) || !existsSync(full)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(full).toString());
  });

  ipcMain.handle('agents:list', () => agents.list());
  ipcMain.handle('app:version', () => app.getVersion());
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
  ipcMain.handle('file:url', (_e, rel: string) => {
    const root = loadSettings().toolkitPath;
    const full = resolve(root, rel);
    return root && inside(root, full) && existsSync(full) ? `toolkit://file/${rel.split(/[\\/]/).map(encodeURIComponent).join('/')}` : null;
  });

  createWindow();
  if (process.env.OOPSMITH_SMOKE) {
    // test mode: save a screenshot of the window and quit
    setTimeout(async () => {
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
  const started = await agents.send('script-writer', DAILY_KICKOFF, reason === 'schedule' ? "Daily run: make today's Short" : "Make today's Short");
  if (started && reason === 'schedule') saveSettings({ lastDailyRun: today() });
}
setInterval(() => {
  const s = loadSettings();
  if (!s.autopilot || !/^\d{1,2}:\d{2}$/.test(s.dailyTime) || s.lastDailyRun === today() || !account.signedIn) return;
  const [h, m] = s.dailyTime.split(':').map(Number);
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() >= h * 60 + m) void runDaily('schedule');
}, 60_000);

app.on('window-all-closed', () => {
  agents.closeAll();
  app.quit();
});
