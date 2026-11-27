// Electron main process: window, IPC, settings, account check and agents.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, shell, Tray } from 'electron';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crewNames, MAIN_TEAM, renameCrew, type AccountState, type AgentEvent, type AgentId, type CelebrateEvent, type GuardState, type ProfileState, type Settings, type ShortRow, type TeamId, type UsageState } from '../shared/types';
import { checkAccount } from './account';
import { backlogKickoff, backlogRefill, dailyKickoff } from './agentDefs';
import { IN_PRODUCTION, Pipeline, TAKES_A_DAY, type PipelineEvent } from './pipeline';
import { BACKLOG_FILE, readBacklog, readyCards, writeBacklog } from './backlog';
import { lastUsage, pausedReason, pendingResets, recordUsage, resetMs } from './guard';
import { notify } from './notify';
import { addProfile, listProfiles, profileEnv, profileName, removeProfile, setTeamProfile, teamProfile } from './profiles';
import { dayKey, daysForQuota, describeSlot } from './schedule';
import { allEntries, dueReminders, filedVideo, planEntry, planState, plannedDays, renderRoot, weekFolder, weeksRoot } from './weeks';
import { applyUpdate, checkForUpdate } from './updater';
import { allUsage, madeMs, totalTokens } from './usage';
import { disableWorkerUpload, listChannels } from './buffer';
import { getSecret, hasSecret, setSecret } from './secrets';
import { publishSetupMissing } from './pipeline';
import { signInYouTube, useClientSecret, youtubeStatus } from './youtube';
import { detectRenderReady, outputDir, renderBusy, setOutputDir, setupRendering, shortsCmd, stopJob } from './render';
import { basename } from 'node:path';
import { cloneToolkit, commitAndPush, pullToolkit } from './git';
import { claudeExecutable } from './sdk';
import { AgentManager } from './agents';
import { inside } from './permissions';
import { loadSettings, saveSettings, setGeminiKey, testGeminiKey } from './settings';
import { addTeam, crewOf, listTeams, removeTeam, renameTeam, setTeamPath, setTeamRepo, settingsFor, teamsOnToolkit, uniqueToolkits } from './teams';

const here = dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow | undefined;
let account: AccountState = { checked: false, signedIn: false, apiKeyInEnv: false };
/** login state per Claude account ('' = this PC's default login) */
const accounts = new Map<string, AccountState>();
// Windows shows notifications under this name
app.setAppUserModelId('com.oopsmith.studio');
// one studio at a time: opening it again brings the running one back (e.g. from the tray)
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => showWindow());
/** set when you really quit (tray → Quit, or an update restarting), so closing isn't turned into hiding */
let quitting = false;
app.on('before-quit', () => { quitting = true; });
let tray: Tray | undefined;
let trayHintShown = false;
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
/** Hide to the tray; the agents, the daily run and reminders keep going. */
function hideToTray() {
  if (!win || !tray) return false;
  win.hide();
  if (!trayHintShown) {
    trayHintShown = true;
    void notify('Oopsmith Studio is still running', 'It is in the tray by the clock, so the daily run and reminders keep going. Click the icon to open it, or right-click → Quit.', 'info');
  }
  return true;
}
function buildTray() {
  const icon = nativeImage.createFromPath(join(here, 'renderer', 'assets', 'brand', 'mark.png')).resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip('Oopsmith Studio');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open Oopsmith Studio', click: showWindow },
    { label: "Make today's Short", click: () => void runDaily(MAIN_TEAM, 'manual') },
    { type: 'checkbox', label: 'Autopilot', checked: loadSettings().autopilot, click: (i) => { saveSettings({ autopilot: i.checked }); send('settings:changed', null); } },
    { type: 'separator' },
    { label: 'Quit (stops the agents)', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.on('click', showWindow);
  tray.on('right-click', () => tray?.popUpContextMenu(menu()));
  tray.setContextMenu(null);
}
/** Start with Windows (installed app only), into the tray. */
function applyLoginItem() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  app.setLoginItemSettings({ openAtLogin: loadSettings().startWithWindows, args: ['--hidden'] });
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'toolkit', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

const send = (channel: string, payload: unknown) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const helper = (f: string) => join(app.getAppPath(), 'resources', f).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);

/** One crew per team: its four desks and the pipeline that moves its Shorts between them. Teams run in parallel;
 *  the graphics card and uploads are shared, so renders and uploads take turns across teams. */
interface Crew { agents: AgentManager; pipeline: Pipeline }
const crews = new Map<TeamId, Crew>();

const tname = (team: TeamId) => listTeams().find((t) => t.id === team)?.name ?? team;
const multi = () => listTeams().length > 1;
const who = (team: TeamId, agent: AgentId) => `${crewNames(crewOf(team))[agent]}${multi() ? ` (${tname(team)})` : ''}`;
/** a message written with the original crew's names, in this team's crew names */
const rn = (team: TeamId, text: string) => renameCrew(text, crewOf(team));

function makeCrew(team: TeamId): Crew {
  const agents = new AgentManager(
    team,
    (e: AgentEvent) => {
      send('agent:event', e);
      // things worth a notification
      if (e.type === 'status' && e.status === 'needs-you') void notify(`${who(team, e.agent)} needs you`, e.activity ?? 'Waiting for your OK in the studio.', 'urgent');
      if (e.type === 'upsert' && e.item?.kind === 'notice' && e.item.tone === 'error') void notify(`${who(team, e.agent)}: something went wrong`, e.item.text.slice(0, 240), 'urgent');
    },
    (u: UsageState) => onUsage(u),
  );
  const pipeline = new Pipeline(team, agents, { upload: helper('yt_upload.py'), status: helper('yt_status.py') });
  pipeline.onChange = () => { send('board:changed', team); sendPlan(); };
  pipeline.gate = () => pausedReason(team, listTeams());
  pipeline.takenDays = () => takenDaysAll();
  pipeline.onEvent = (e) => void onPipelineEvent(team, e);
  // teams sharing a toolkit: each works on its own Shorts
  pipeline.owner = (m) => ownerOf(team, m);
  pipeline.firstOnToolkit = () => teamsOnToolkit(settingsFor(team).toolkitPath)[0]?.id === team;
  pipeline.busyElsewhere = (id) => [...crews.entries()].some(([t, c]) => t !== team && sameToolkit(t, team) && (['script-writer', 'editor', 'reviewer', 'publisher'] as AgentId[]).some((a) => c.agents.currentWork(a) === id));
  pipeline.onBlocked = (raw) => {
    const message = rn(team, raw);
    send('pipeline:blocked', { team, message });
    agents.post('editor', { kind: 'notice', tone: 'warn', text: message });
    if (message) void notify(`${tname(team)} is waiting`, message, 'info');
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

// ---------------- teams sharing one toolkit: each Short belongs to one team (registry "team"; unclaimed = the first team)
const sameToolkit = (a: TeamId, b: TeamId) => settingsFor(a).toolkitPath.toLowerCase() === settingsFor(b).toolkitPath.toLowerCase();
function ownerOf(team: TeamId, m: { team?: string }): TeamId {
  const on = teamsOnToolkit(settingsFor(team).toolkitPath);
  if (on.length < 2) return team;
  return m.team && on.some((t) => t.id === m.team) ? m.team : on[0].id;
}

// ---------------- registries of every toolkit (for the weekly plan, quota and milestones)
type RegShort = { id: string; team?: string; status?: string; title?: string; topic?: string; publish_at?: string; file?: string; version?: number };
function registryOf(team: TeamId): Record<string, RegShort> {
  try { return JSON.parse(readFileSync(join(settingsFor(team).toolkitPath, 'shorts', 'registry.json'), 'utf8')).shorts ?? {}; } catch { return {}; }
}
/** Upload days already used: the weekly plan plus Shorts posted or scheduled another way, on every team. */
function takenDaysAll(): Set<string> {
  const tz = loadSettings().audienceTimezone;
  const days = plannedDays();
  for (const t of uniqueToolkits()) for (const m of Object.values(registryOf(t.id))) if (m.publish_at && TAKES_A_DAY.test(m.status ?? '')) days.add(dayKey(Date.parse(m.publish_at), tz));
  return days;
}
/** Shorts still being made, on every team (ready-to-post ones not yet filed count too). */
function inProduction(): number {
  let n = 0;
  for (const t of uniqueToolkits()) for (const m of Object.values(registryOf(t.id))) {
    if (IN_PRODUCTION.test(m.status ?? '')) n++;
    else if (m.status === 'ready_to_publish' && !planEntry(ownerOf(t.id, m), m.id)) n++;
  }
  return n;
}
const sendPlan = () => send('plan', planState(inProduction()));
/** Shorts that are out (posted by you or published), all teams. */
function postedCount(): number {
  let n = 0;
  for (const t of uniqueToolkits()) for (const m of Object.values(registryOf(t.id))) if (/^(published|published_manual)$/.test(m.status ?? '')) n++;
  return n;
}
/** studio upgrades unlock at these counts (the office shows them; see world.ts) */
const MILESTONES: [number, string][] = [
  [1, 'the first Short is out: a gold plaque goes up in the lounge'],
  [7, 'a full week of Shorts: the neon OOPS sign lights up'],
  [25, '25 Shorts: the trophy shelf arrives'],
  [50, '50 Shorts: a disco ball for the record corner'],
  [100, '100 Shorts: the gold record goes on the wall'],
];
function checkMilestones(team: TeamId) {
  const n = postedCount();
  const s = loadSettings();
  const hit = MILESTONES.filter(([at]) => at <= n && at > (s.milestoneSeen ?? 0));
  if (!hit.length) return;
  saveSettings({ milestoneSeen: hit[hit.length - 1][0] });
  const [, what] = hit[hit.length - 1];
  const text = `Studio upgrade: ${what}.`;
  celebrate({ team, id: '', title: '', kind: 'milestone', text });
  void notify('Studio upgrade unlocked', text, 'good');
}
const celebrate = (c: CelebrateEvent) => send('celebrate', c);

async function onPipelineEvent(team: TeamId, e: PipelineEvent) {
  const pre = multi() ? `${tname(team)}: ` : '';
  if (e.type === 'filed') {
    sendPlan();
    void notify(`${e.id} is ready to upload`, `${pre}${e.title}. ${e.text.replace(`${e.id} is ready to upload. `, '')}`, 'info');
    const p = planState(inProduction());
    const w = p.weeks.find((x) => x.week === e.week);
    if (e.fresh && w && w.entries.length >= w.quota) {
      const text = `Week ${e.week} is ready: all ${w.quota} Shorts are in the folder.`;
      celebrate({ team, id: e.id, title: e.title, kind: 'week', text });
      void notify(`Week ${e.week} is ready`, text, 'good');
    }
  } else if (e.type === 'posted' || e.type === 'published') {
    sendPlan();
    celebrate({ team, id: e.id, title: e.title, kind: e.type, text: e.text });
    void notify(e.type === 'posted' ? `${e.id} is out` : `${e.id} is live`, `${pre}${e.title}`, 'good');
    checkMilestones(team);
  } else if (e.type === 'failed') {
    void notify(`${e.id}: publishing failed`, `${pre}${e.text}`, 'urgent');
  }
}

// ---------------- Claude plan usage, the budget guard, and picking up after the limit resets
const resetTimers = new Map<string, NodeJS.Timeout>();
function guardStates(): GuardState[] {
  const teams = listTeams();
  return teams.map((t) => ({ team: t.id, paused: pausedReason(t.id, teams) }));
}
const sendGuard = () => send('guard', guardStates());
function onUsage(u: UsageState) {
  const before = guardStates();
  recordUsage(u);
  send('usage', u);
  const after = guardStates();
  sendGuard();
  const prof = u.profile ?? '';
  if (u.status === 'rejected') void notify('Claude plan limit reached', `${prof ? `${profileName(prof)}: ` : ''}work picks up by itself${u.resetsAt ? ` at ${new Date(resetMs(u.resetsAt)!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ' when it resets'}.`, 'info');
  else if (after.some((g, i) => g.paused && !before[i]?.paused)) {
    const g = after.find((x, i) => x.paused && !before[i]?.paused)!;
    void notify(`${tname(g.team)} paused`, g.paused!, 'info');
  }
  scheduleResets();
}
function scheduleResets() {
  for (const [prof, at] of pendingResets()) {
    if (resetTimers.has(prof)) continue;
    resetTimers.set(prof, setTimeout(() => {
      resetTimers.delete(prof);
      sendGuard();
      const teams = listTeams().filter((t) => teamProfile(t.id) === prof);
      for (const t of teams) {
        const c = crews.get(t.id);
        if (!c) continue;
        c.pipeline.resetTries();
        void resumeUnfinished(t.id, 'limit');
      }
      if (teams.length) void notify('Claude plan reset', `${teams.map((t) => t.name).join(', ')} ${teams.length === 1 ? 'is' : 'are'} back at work.`, 'info');
      void tickAll();
    }, Math.max(5_000, at - Date.now() + 60_000)));
  }
}

/**
 * Jobs that didn't finish: the app closed, the PC restarted, or the plan limit cut them off. Cutter, Hawk and Pip
 * pick up from each Short's status by themselves; Scripty's daily run or backlog research is started again
 * (a Short he already created an ID for is continued by the pipeline instead).
 */
async function resumeUnfinished(team: TeamId, why: 'restart' | 'limit') {
  const c = crews.get(team);
  if (!c) return;
  for (const j of c.agents.unfinished()) {
    if (why === 'restart' && j.limit && pausedReason(team, listTeams())) continue; // still over the limit: later
    if (why === 'limit' && !j.limit) continue;
    c.agents.clearUnfinished(j.agent);
    if (Date.now() - j.at > 24 * 3600_000) continue; // too old to pick up
    const auto = j.text.includes('[AUTOPILOT]');
    const label = why === 'limit' ? 'after the plan limit reset' : 'after the app restarted';
    if (j.agent === 'script-writer' && auto) {
      const reg = registryOf(team);
      const madeId = Object.values(reg).some((m) => /^(planned|scripted)$/.test(m.status ?? ''));
      if (!madeId && /Make today's Short|Fill the story backlog/.test(j.text) && c.agents.isIdle('script-writer')) {
        await c.agents.send('script-writer', j.text, `Picking up ${label}: ${j.display ?? 'the last job'}`, { fresh: true });
        continue;
      }
    }
    if (!auto) c.agents.post(j.agent, { kind: 'notice', tone: 'warn', text: `Your last message didn't finish (${label === 'after the app restarted' ? 'the app closed' : 'the plan limit was reached'}). Send it again if you still need it.` });
    else c.agents.post(j.agent, { kind: 'notice', text: `Picking up ${label}: the desk continues from where each Short is.` });
  }
  void c.pipeline.tick();
}

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
  const r = existsSync(s.toolkitPath) ? await pullToolkit(s.toolkitPath) : await doClone(team);
  if (existsSync(s.toolkitPath)) {
    toolkitStatus({ team, busy: false, ...r });
    // every team renders into the folder chosen in Settings → Rendering
    if (s.renderDir) setOutputDir(s.toolkitPath, s.renderDir);
  }
  return r;
}

/** Move the rendered videos every team's registry knows about from one render folder to another. */
async function moveRenders(from: string[], to: string): Promise<number> {
  mkdirSync(to, { recursive: true });
  let n = 0;
  for (const t of uniqueToolkits()) {
    for (const m of Object.values(registryOf(t.id))) {
      if (!m.file) continue;
      const src = from.map((d) => join(d, m.file!)).find((p) => existsSync(p) && dirname(p) !== to);
      if (!src) continue;
      const dest = join(to, m.file);
      if (existsSync(dest)) continue;
      try { await rename(src, dest); } catch { try { await copyFile(src, dest); await unlink(src).catch(() => {}); } catch { continue; } }
      n++;
    }
  }
  return n;
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
    // started with Windows: straight into the tray
    show: !process.argv.includes('--hidden'),
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(join(here, 'renderer', 'index.html'));
  // minimize / close go to the tray (Settings → Studio), so the studio keeps working
  win.on('minimize', () => {
    if (loadSettings().trayOnMinimize) hideToTray();
  });
  win.on('close', (e) => {
    if (!quitting && loadSettings().closeToTray && hideToTray()) e.preventDefault();
  });
  // the 3D office stops drawing while hidden (the graphics card is free for renders)
  win.on('hide', () => send('window:visible', false));
  win.on('show', () => send('window:visible', true));
  win.on('restore', () => send('window:visible', true));
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
      shorts: Record<string, { id: string; team?: string; title?: string; topic?: string; status?: string; version?: number; file?: string; youtube_id?: string }>;
    };
    return Object.values(reg.shorts)
      .filter((s) => ownerOf(team, s) === team)   // a shared toolkit: each team's board shows its own Shorts
      .map((s) => {
        const u = usage[s.id];
        return { id: s.id, title: s.title || s.topic || '(untitled)', status: s.status || 'new', version: s.version || 1, tokens: u ? totalTokens(u.total) : undefined, file: s.file, madeMs: madeMs(u), made: Boolean(u?.doneAt) };
      })
      .sort((a, b) => b.id.localeCompare(a.id));
  } catch {
    return [];
  }
}

function profileStates(): ProfileState[] {
  return listProfiles().map((p) => ({ ...p, account: accounts.get(p.id) ?? (p.id ? { checked: false, signedIn: false, apiKeyInEnv: false } : account), usage: lastUsage(p.id) ?? undefined }));
}
// Opens a terminal running Claude Code so you can type /login (the app never sees your password).
function openLogin(profile: string) {
  const exe = claudeExecutable();
  if (!exe) return { ok: false, message: 'Claude Code was not found. Re-run npm install in the app folder.' };
  const env = { ...process.env, ...profileEnv(profile) } as NodeJS.ProcessEnv;
  const title = profile ? `Claude sign-in: ${profileName(profile)}` : 'Claude sign-in';
  if (process.platform === 'win32') spawn('cmd.exe', ['/d', '/s', '/c', `start "${title.replace(/"/g, '')}" cmd /k ""${exe}""`], { detached: true, windowsVerbatimArguments: true, env }).unref();
  else if (process.platform === 'darwin') spawn('open', ['-a', 'Terminal', exe], { detached: true, env }).unref();
  else spawn('x-terminal-emulator', ['-e', exe], { detached: true, env }).unref();
  return { ok: true, message: `A terminal opened${profile ? ` for ${profileName(profile)}` : ''}. Type /login, sign in with that account, close it, then press Check again.` };
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
      const name = basename(decodeURIComponent(rest.join('/')));
      // a Short that was filed into its week folder plays from there (so the render folder's copy isn't held open)
      const full = filedVideo(decodeURIComponent(team), name) ?? join(dir, name);
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
    const video = row?.file && (existsSync(join(outputDir(s.toolkitPath), row.file)) || filedVideo(team, row.file)) ? `toolkit://video/${encodeURIComponent(team)}/${encodeURIComponent(row.file)}` : null;
    let publish: string | null = null;
    try { publish = readFileSync(join(s.toolkitPath, 'shorts', id, 'publish.md'), 'utf8'); } catch { /* none yet */ }
    let m: { buffer_post_id?: string; youtube_id?: string; publish_at?: string } = {};
    try { m = JSON.parse(readFileSync(join(s.toolkitPath, 'shorts', 'registry.json'), 'utf8')).shorts[id] ?? {}; } catch { /* none */ }
    return {
      id, status: row?.status ?? '', waiting: pipeline.explain(id), review, publish,
      inBuffer: Boolean(m.buffer_post_id), youtubeId: m.youtube_id || null, publishAt: m.publish_at || null,
      videoUrl: video, usage: allUsage(team)[id] ?? null, plan: planEntry(team, id),
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
    quitting = true; // let the update close the window for real
    for (const c of crews.values()) c.agents.closeAll();
    const r = await applyUpdate((step) => send('update', { available: true, behind: 0, changes: [], busy: step }));
    if (!r.ok) send('update', { available: true, behind: 0, changes: [], error: r.message });
    return r;
  });
  setTimeout(() => void checkUpdates(), 8000);
  setInterval(() => void checkUpdates(), 3 * 60 * 60 * 1000);
  ipcMain.handle('agents:daily', (_e, team: TeamId) => runDaily(team, 'manual'));
  // every team makes a Short now: teams that have to wait (sharing a toolkit, or Scripty still busy) start by themselves
  ipcMain.handle('agents:daily-all', async () => {
    const started: string[] = [], waiting: string[] = [], not: string[] = [];
    for (const t of listTeams()) {
      const r = await runDaily(t.id, 'manual', undefined, { waitTurn: true });
      if (r === 'started') started.push(t.name);
      else if (r === 'busy') { queued.set(t.id, Date.now()); waiting.push(t.name); }
      else not.push(`${t.name}: ${r}`);
    }
    const parts = [];
    if (started.length) parts.push(`${started.join(' and ')} started.`);
    if (waiting.length) parts.push(`${waiting.join(' and ')} ${waiting.length === 1 ? 'starts' : 'start'} as soon as ${waiting.length === 1 ? 'its' : 'their'} Scripty is free to pick a story.`);
    if (not.length) parts.push(not.join(' '));
    return parts.join(' ') || 'Nothing to start.';
  });
  ipcMain.handle('agents:history', (_e, team: TeamId, id: AgentId) => crew(team).agents.history(id));
  ipcMain.handle('agents:send', (_e, team: TeamId, id: AgentId, text: string) => crew(team).agents.send(id, text));
  ipcMain.handle('agents:stop', (_e, team: TeamId, id: AgentId) => crew(team).agents.stop(id));
  ipcMain.handle('agents:new', (_e, team: TeamId, id: AgentId) => crew(team).agents.newChat(id));
  ipcMain.handle('agents:permission', (_e, team: TeamId, id: AgentId, permId: string, allow: boolean) => crew(team).agents.answer(id, permId, allow));

  ipcMain.handle('account:get', () => account);
  ipcMain.handle('account:recheck', async () => {
    account = await checkAccount();
    accounts.set('', account);
    send('profiles', profileStates());
    return account;
  });
  ipcMain.handle('account:login', () => openLogin(''));
  // extra Claude accounts (one per team if you like)
  ipcMain.handle('profiles:list', () => profileStates());
  ipcMain.handle('profiles:add', (_e, name: string) => {
    const r = addProfile(name);
    send('profiles', profileStates());
    return r;
  });
  ipcMain.handle('profiles:remove', (_e, id: string) => {
    const r = removeProfile(id);
    if (r.ok) accounts.delete(id);
    send('profiles', profileStates());
    return r;
  });
  ipcMain.handle('profiles:login', (_e, id: string) => openLogin(id));
  ipcMain.handle('profiles:recheck', async (_e, id: string) => {
    const a = await checkAccount(id);
    accounts.set(id, a);
    if (!id) { account = a; send('account', a); }
    const p = profileStates();
    send('profiles', p);
    return p;
  });
  ipcMain.handle('teams:profile', (_e, team: TeamId, profile: string) => {
    const before = teamProfile(team);
    setTeamProfile(team, profile);
    if (before !== teamProfile(team)) crew(team).agents.forgetSessions();
    sendGuard();
    void checkAccount(profile).then((a) => { accounts.set(profile, a); send('profiles', profileStates()); });
    return teamsChanged();
  });

  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    if ('startWithWindows' in patch) setTimeout(applyLoginItem, 0);
    // a new daily time that has already passed today starts tomorrow, not right now
    // (catching up stays for when the app was closed at the set time)
    if (typeof patch.dailyTime === 'string' && /^\d{1,2}:\d{2}$/.test(patch.dailyTime)) {
      const [h, m] = patch.dailyTime.split(':').map(Number);
      const now = new Date();
      if (now.getHours() * 60 + now.getMinutes() >= h * 60 + m) patch = { ...patch, lastDailyRun: today() };
    }
    const r = saveSettings(patch);
    if ('budgetGuard' in patch) sendGuard();
    if ('postingDays' in patch || 'audienceTimezone' in patch) sendPlan();
    return r;
  });

  // ---- weekly plan and folders
  ipcMain.handle('plan:get', () => planState(inProduction()));
  ipcMain.handle('plan:days', (_e, days: Settings['postingDays']) => {
    saveSettings({ postingDays: days?.length ? days : daysForQuota(7) });
    const p = planState(inProduction());
    send('plan', p);
    return p;
  });
  ipcMain.handle('plan:open', async (_e, week: number | null) => {
    const s = loadSettings();
    const dir = week && s.weekOneStart ? weekFolder(s, week) : weeksRoot(s);
    mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return dir;
  });
  ipcMain.handle('folders:get', () => ({ render: renderRoot(), weeks: weeksRoot() }));
  const setFolder = async (kind: 'render' | 'weeks', dir: string) => {
    if (kind === 'weeks') {
      saveSettings({ weeksDir: dir });
      sendPlan();
      return { ok: true, message: `New Shorts are filed into ${weeksRoot()}. Weeks already filed stay where they are.`, path: weeksRoot() };
    }
    const old = listTeams().map((t) => outputDir(t.toolkitPath));
    saveSettings({ renderDir: dir });
    for (const t of listTeams()) setOutputDir(t.toolkitPath, dir);
    const now = renderRoot();
    const moved = await moveRenders(old, now);
    for (const t of listTeams()) send('board:changed', t.id);
    sendPlan();
    return { ok: true, message: `Videos now render into ${now}.${moved ? ` Moved ${moved} earlier render${moved === 1 ? '' : 's'} there too.` : ''}`, path: now };
  };
  ipcMain.handle('folders:pick', async (_e, kind: 'render' | 'weeks') => {
    if (kind === 'render' && renderBusy()) {
      return { ok: false, message: 'A render is running. Change the folder after it finishes.' };
    }
    const r = await dialog.showOpenDialog(win!, { title: kind === 'render' ? 'Where should finished videos be rendered?' : 'Where should the Week folders go?', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, message: 'No folder chosen.' };
    return setFolder(kind, r.filePaths[0]);
  });
  ipcMain.handle('folders:reset', (_e, kind: 'render' | 'weeks') => setFolder(kind, ''));

  // ---- story backlog
  ipcMain.handle('backlog:get', (_e, team: TeamId) => readBacklog(settingsFor(team).toolkitPath));
  ipcMain.handle('backlog:save', async (_e, team: TeamId, cards) => {
    const s = settingsFor(team);
    writeBacklog(s.toolkitPath, cards);
    send('backlog', team);
    const g = await commitAndPush(s.toolkitPath, [BACKLOG_FILE], 'Backlog: reordered by you');
    return { ok: true, message: g.message };
  });
  ipcMain.handle('backlog:refill', async (_e, team: TeamId) => {
    const c = crew(team);
    if (!c.agents.isIdle('script-writer')) return { ok: false, message: rn(team, 'Scripty is busy. Try again when he is free.') };
    const left = readyCards(settingsFor(team).toolkitPath).length;
    const n = Math.max(3, 5 - left);
    await c.agents.send('script-writer', backlogRefill(n), `Research ${n} stories for the backlog`, { fresh: true, effort: 'medium' });
    return { ok: true, message: rn(team, `Scripty is researching ${n} stories. They show up on the corkboard as he adds them.`) };
  });
  ipcMain.handle('backlog:make', async (_e, team: TeamId, card: string) => {
    const r = await runDaily(team, 'manual', card);
    return r === 'started' ? { ok: true, message: rn(team, 'Scripty is making a Short from this story now.') } : { ok: false, message: r === 'busy' ? rn(team, 'Scripty is busy. Try again when he is free.') : r };
  });

  // ---- notifications, guard
  ipcMain.handle('notify:test', () => notify('Oopsmith Studio', 'Notifications work. You will hear from the studio when a Short is ready to upload or something needs you.', 'info', { force: true }));
  ipcMain.handle('guard:get', () => guardStates());
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
  buildTray();
  applyLoginItem();
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
  // get the latest toolkit (clone on first run, pull every start), then pick up anything that was cut off
  win!.webContents.once('did-finish-load', () => {
    for (const t of listTeams()) void doSync(t.id).then(() => resumeUnfinished(t.id, 'restart'));
    sendGuard();
    sendPlan();
  });
  scheduleResets();
  checkAccount().then((a) => {
    account = a;
    accounts.set('', a);
    send('account', a);
    send('profiles', profileStates());
  });
  for (const p of listProfiles().filter((x) => x.id)) void checkAccount(p.id).then((a) => { accounts.set(p.id, a); send('profiles', profileStates()); });
});

// ---- daily autopilot run: once a day at settings.dailyTime (or the first time the app is open after it)
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Shorts ready or on their way, not yet posted: a full week's worth means the daily run can rest. */
function aheadCount(): number {
  const tz = loadSettings().audienceTimezone;
  const todayKey = dayKey(Date.now(), tz);
  return inProduction() + allEntries().filter((e) => !e.posted && e.day >= todayKey).length;
}
let quotaNoticeDay = '';
/** 'started', 'busy' (Scripty is working), or why it didn't start. */
/** Backlog cards handed to a team's Scripty and not used yet (so two teams never take the same story). */
const cardTaken = new Map<string, TeamId>();
/** "Make today's Short" for every team: teams waiting their turn (queued at), started within 30 minutes */
const queued = new Map<TeamId, number>();
setInterval(() => {
  for (const [t, at] of [...queued]) {
    if (!listTeams().some((x) => x.id === t) || Date.now() - at > 30 * 60_000) { queued.delete(t); continue; }
    void runDaily(t, 'manual', undefined, { waitTurn: true }).then((r) => { if (r !== 'busy') queued.delete(t); });
  }
}, 10_000);
async function runDaily(team: TeamId, reason: 'manual' | 'schedule', cardId?: string, opts: { waitTurn?: boolean } = {}): Promise<string> {
  const { agents } = crew(team);
  if (!agents.isIdle('script-writer')) return 'busy';
  // teams sharing the toolkit take turns choosing a story: wait while another team's Scripty is still picking his
  // (working, but no Short ID yet), so two of them never pick the same one
  const picking = listTeams().find((t) => t.id !== team && sameToolkit(t.id, team) && !crew(t.id).agents.isIdle('script-writer') && !crew(t.id).agents.currentWork('script-writer'));
  if (picking && !cardId) return reason === 'schedule' || opts.waitTurn ? 'busy' : `${picking.name}'s ${crewNames(crewOf(picking.id))['script-writer']} is choosing a story right now (you share a toolkit). Try again in a minute.`;
  const paused = pausedReason(team, listTeams());
  if (paused && reason === 'schedule') return `Waiting: ${paused}`;
  const s = loadSettings();
  // the weekly quota: once a full week of Shorts is ready or being made, the daily run skips a day
  if (reason === 'schedule' && !cardId && aheadCount() >= s.postingDays.length) {
    if (quotaNoticeDay !== today()) {
      quotaNoticeDay = today();
      agents.post('script-writer', { kind: 'notice', text: `Skipping today's Short: ${aheadCount()} Shorts are already ready or on the way, a full week (${s.postingDays.length} a week). The daily run starts again when one is posted.` });
    }
    return 'quota';
  }
  const cards = readyCards(settingsFor(team).toolkitPath);
  const ready = new Set(cards.map((c) => c.id));
  for (const k of [...cardTaken.keys()]) if (!ready.has(k.split('|')[1])) cardTaken.delete(k);   // used or set aside
  const key = (id: string) => `${settingsFor(team).toolkitPath.toLowerCase()}|${id}`;
  const card = cardId ? cards.find((c) => c.id === cardId) : cards.find((c) => !cardTaken.has(key(c.id)) || cardTaken.get(key(c.id)) === team);
  if (cardId && !card) return 'That story is no longer on the backlog.';
  if (cardId && cardTaken.has(key(cardId)) && cardTaken.get(key(cardId)) !== team) return 'Another team is already making that story.';
  if (card) cardTaken.set(key(card.id), team);
  const text = card ? backlogKickoff(card, team) : dailyKickoff(team);
  const label = card ? `${reason === 'schedule' ? 'Daily run: ' : ''}Make a Short from ${card.id}: ${card.title}` : reason === 'schedule' ? "Daily run: make today's Short" : "Make today's Short";
  return (await agents.send('script-writer', text, label, { fresh: true })) ? 'started' : 'not started';
}
setInterval(() => void tickAll(), 60_000);
// which teams already started today's run (kept on disk, so a restart mid-day doesn't start a second Short)
const dailyFile = () => join(app.getPath('userData'), 'daily.json');
let dailyDay = '';
const dailyDone = new Set<TeamId>();
try { const d = JSON.parse(readFileSync(dailyFile(), 'utf8')); dailyDay = d.day; for (const t of d.done ?? []) dailyDone.add(t); } catch { /* none yet */ }
const saveDaily = () => { try { writeFileSync(dailyFile(), JSON.stringify({ day: dailyDay, done: [...dailyDone] })); } catch { /* best effort */ } };
setInterval(() => {
  const s = loadSettings();
  if (!s.autopilot || !/^\d{1,2}:\d{2}$/.test(s.dailyTime) || s.lastDailyRun === today()) return;
  const [h, m] = s.dailyTime.split(':').map(Number);
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
  // every team makes its own Short each day, in parallel (each on its own Claude account); teams sharing a toolkit
  // take turns choosing their story. A team counts as done for today once its run started (or was skipped).
  if (dailyDay !== today()) { dailyDay = today(); dailyDone.clear(); }
  const ready = listTeams().filter((t) => !dailyDone.has(t.id) && (accounts.get(teamProfile(t.id)) ?? (teamProfile(t.id) ? undefined : account))?.signedIn);
  if (!ready.length) return;
  void (async () => {
    for (const t of ready) {
      const r = await runDaily(t.id, 'schedule');
      if (r !== 'busy' && !r.startsWith('Waiting')) { dailyDone.add(t.id); saveDaily(); }
    }
    if (listTeams().every((t) => dailyDone.has(t.id))) saveSettings({ lastDailyRun: today() });
  })();
}, 60_000);
// upload-day reminders when you post the Shorts yourself
setInterval(() => {
  const s = loadSettings();
  if (s.publishVia !== 'manual') return;
  for (const e of dueReminders()) {
    void notify(`Upload today: ${e.id}`, `${e.title} · ${describeSlot(Date.parse(e.at), s.audienceTimezone)}. It's in Week ${e.week}'s folder.`, 'info');
  }
}, 60_000);

app.on('window-all-closed', () => {
  for (const c of crews.values()) c.agents.closeAll();
  stopJob();
  app.quit();
});
