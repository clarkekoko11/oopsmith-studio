// Wires the 3D office to the chat drawer, top bar and settings.
import { MAIN_TEAM, type AccountState, type AgentEvent, type AgentId, type AgentInfo, type BacklogCard, type CelebrateEvent, type ChatItem, type GuardState, type PlanState, type ProfileState, type Settings, type ShortRow, type StudioApi, type TeamConfig, type TeamId, type TokenCount, type UpdateInfo, type UsageState } from '../shared/types';
import { Office, type CameraMode } from './office/game';
import { renderMarkdown } from './ui/markdown';
import { mockApi } from './ui/mock';
import { MILESTONES, STATION_COLORS, TEAM_ACCENTS } from './office/world';

declare global {
  interface Window { studio?: StudioApi; __office?: Office }
}
const errors: string[] = ((window as unknown as { __errors: string[] }).__errors = []);
window.addEventListener('error', (e) => errors.push(String(e.error?.stack ?? e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String((e.reason as Error)?.stack ?? e.reason)));
const api: StudioApi = window.studio ?? mockApi();
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const COLORS: Record<AgentId, string> = STATION_COLORS;
const STARTERS: Partial<Record<AgentId, string[]>> = {
  'script-writer': [
    'Pitch me 3 little-known true stories about tiny mistakes.',
    'Write a script about the Gimli Glider.',
    'Which Shorts have we made so far?',
  ],
  editor: ['What are you working on?', 'Build the latest voiced Short.', 'Why did the last render fail?'],
  reviewer: ['What did you think of the last Short?', 'Review the latest render again.', 'What do you check for?'],
  publisher: ['Give the latest Short a punchier title.', 'What is uploaded so far?', 'Write upload details for the latest approved Short.'],
};
const BLURB: Partial<Record<AgentId, string>> = {
  'script-writer': 'finds true stories, checks the facts, writes your script and makes the voiceover.',
  editor: 'builds the cast, sets, story, sound and captions, checks the stills, and renders on your graphics card.',
  reviewer: 'watches every render, checks picture, captions and sound against the script, and approves it or sends Cutter a fix list.',
  publisher: 'writes the title, description and tags for every approved Short and uploads it to YouTube as private or scheduled.',
};

// every team has its own four agents; "active" is the team the top bar, review screen and toolkit settings act on
let teams: TeamConfig[] = [{ id: MAIN_TEAM, name: 'Team Oopsmith', toolkitRepo: '', toolkitPath: '' }];
let active: TeamId = MAIN_TEAM;
const agentsBy = new Map<TeamId, AgentInfo[]>();
const teamAgents = (t: TeamId) => agentsBy.get(t) ?? [];
let open: { team: TeamId; id: AgentId } | null = null;
const hkey = (t: TeamId, a: AgentId) => `${t}/${a}`;
const histories = new Map<string, ChatItem[]>();
const isOpen = (t: TeamId, a: AgentId) => open?.team === t && open.id === a;
const teamName = (t: TeamId) => teams.find((x) => x.id === t)?.name ?? t;

const office = new Office($('#stage'), $('#tags'));
window.__office = office;

// ---------------- camera mode
function showMode(m: CameraMode) {
  document.body.dataset.mode = m;
  document.querySelectorAll<HTMLButtonElement>('#camseg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
}
office.onMode = (m) => {
  showMode(m);
  void api.saveSettings({ cameraMode: m });
};
document.querySelectorAll<HTMLButtonElement>('#camseg button').forEach((b) =>
  b.addEventListener('click', () => office.setMode(b.dataset.mode as CameraMode)),
);
office.onHint = (key) => {
  const h = $('#hint');
  const [t, id] = (key ?? '').split('/') as [TeamId, AgentId];
  const a = key ? teamAgents(t).find((x) => x.id === id) : undefined;
  h.hidden = !a;
  if (a) h.innerHTML = `<kbd>E</kbd> Talk to ${a.name}${teams.length > 1 ? ` (${teamName(t)})` : ''}`;
};

// ---------------- agents + chat
office.onTalk = (team, id) => openChat(team, id);

function showAutopilot(on: boolean) {
  const b = $('#autopilot');
  b.classList.toggle('on', on);
  b.querySelector('b')!.textContent = on ? 'ON' : 'OFF';
  ($('#autopilotBox') as HTMLInputElement).checked = on;
}
$('#autopilot').addEventListener('click', async () => {
  const s = await api.saveSettings({ autopilot: !(await api.getSettings()).autopilot });
  showAutopilot(s.autopilot);
});
$('#autopilotBox').addEventListener('change', async (e) => showAutopilot((await api.saveSettings({ autopilot: (e.target as HTMLInputElement).checked })).autopilot));
$('#dailyTime').addEventListener('change', (e) => api.saveSettings({ dailyTime: (e.target as HTMLInputElement).value }));
$('#runToday').addEventListener('click', async () => {
  const r = await api.runDaily(active);
  if (r !== 'started') toast('Not started', r === 'busy' ? 'Scripty is busy right now.' : r);
});

function refreshAgent(team: TeamId, a: AgentInfo) {
  if (a.id === 'script-writer' && team === active) ($('#runToday') as HTMLButtonElement).disabled = a.status === 'working' || a.status === 'needs-you';
  office.setAgentInfo(team, a.id, a.name, a.role, a.status, a.activity);
  if (isOpen(team, a.id)) {
    $('#chat .status').textContent = a.status === 'offline' ? 'not here yet' : a.activity && a.status !== 'idle' ? a.activity : a.status;
    $('#stopBtn').hidden = a.status !== 'working' && a.status !== 'needs-you';
  }
}

async function openChat(team: TeamId, id: AgentId) {
  const a = teamAgents(team).find((x) => x.id === id);
  if (!a) return;
  open = { team, id };
  setActive(team);
  office.setTalking(hkey(team, id));
  office.inputEnabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  const chat = $('#chat');
  chat.classList.add('open');
  chat.setAttribute('aria-hidden', 'false');
  const av = $('#chat .avatar');
  av.style.background = COLORS[id];
  av.textContent = a.name[0];
  $('#chat .name').textContent = a.name;
  $('#chat .role').textContent = teams.length > 1 ? `${a.role} · ${teamName(team)}` : a.role;
  const live = a.status !== 'offline';
  ($('#input') as HTMLTextAreaElement).disabled = !live;
  ($('#sendBtn') as HTMLButtonElement).disabled = !live;
  $('#newChat').hidden = !live;
  ($('#input') as HTMLTextAreaElement).placeholder = live ? `Ask ${a.name}…` : `${a.name} arrives in Phase ${a.phase}`;
  histories.set(hkey(team, id), await api.getHistory(team, id));
  renderMessages();
  refreshAgent(team, a);
  if (live) setTimeout(() => $('#input').focus(), 250);
}

function closeChat() {
  if (open) office.setAgentSpeaking(open.team, open.id, false);
  open = null;
  office.setTalking(null);
  office.inputEnabled = true;
  $('#chat').classList.remove('open');
  $('#chat').setAttribute('aria-hidden', 'true');
  ($('#input') as HTMLTextAreaElement).blur();
}
$('#closeChat').addEventListener('click', closeChat);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#review').hidden) return closeReview();
  if (e.key === 'Escape' && !$('#weeks').hidden) return closeWeeks();
  if (e.key === 'Escape' && !$('#backlog').hidden) return closeBacklog();
  if (e.key === 'Escape' && !$('#teams').hidden) return closeTeams();
  if (e.key === 'Escape' && open && !document.pointerLockElement && $('#settings').hidden) closeChat();
});
$('#newChat').addEventListener('click', async () => {
  if (open && confirm('Start a new conversation? The current one will be cleared from this desk.')) await api.newChat(open.team, open.id);
});
$('#stopBtn').addEventListener('click', () => open && api.stop(open.team, open.id));

const composer = $('#composer') as HTMLFormElement;
const input = $('#input') as HTMLTextAreaElement;
composer.addEventListener('submit', (e) => {
  e.preventDefault();
  sendText(input.value);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendText(input.value);
  }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
});
function sendText(text: string) {
  const t = text.trim();
  if (!t || !open) return;
  input.value = '';
  input.style.height = 'auto';
  void api.send(open.team, open.id, t);
}

const itemEls = new Map<string, HTMLElement>();
function renderMessages() {
  const box = $('#messages');
  box.innerHTML = '';
  itemEls.clear();
  const items = (open && histories.get(hkey(open.team, open.id))) || [];
  const a = open ? teamAgents(open.team).find((x) => x.id === open!.id) : undefined;
  if (!items.length && a && a.status !== 'offline') {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = `<b>${a.name}</b> ${BLURB[a.id] ?? ''}<div class="starters"></div>`;
    for (const s of STARTERS[a.id] ?? []) {
      const b = document.createElement('button');
      b.textContent = s;
      b.onclick = () => sendText(s);
      empty.querySelector('.starters')!.appendChild(b);
    }
    box.appendChild(empty);
  }
  for (const it of items) upsertEl(it);
  box.scrollTop = box.scrollHeight;
}

function upsertEl(it: ChatItem) {
  const box = $('#messages');
  box.querySelector('.empty')?.remove();
  let el = itemEls.get(it.id);
  const fresh = !el;
  if (!el) {
    el = document.createElement('div');
    itemEls.set(it.id, el);
    box.appendChild(el);
  }
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  switch (it.kind) {
    case 'user':
      el.className = 'msg user';
      el.textContent = it.text;
      break;
    case 'agent':
      el.className = 'msg agent' + (it.streaming ? ' streaming' : '');
      el.innerHTML = renderMarkdown(it.text);
      break;
    case 'tool':
      el.className = 'tool';
      el.textContent = it.text;
      break;
    case 'notice':
      el.className = `notice ${it.tone ?? ''}`;
      el.textContent = it.text;
      break;
    case 'permission': {
      el.className = 'perm' + (it.state === 'pending' ? '' : ' done');
      el.innerHTML = `<div class="what"></div><div class="detail"></div><div class="btns"><button class="allow">Allow</button><button class="deny">Don't allow</button></div>${it.state === 'pending' ? '' : `<div class="result">${it.state === 'allowed' ? 'Allowed' : 'Not allowed'}</div>`}`;
      el.querySelector('.what')!.textContent = 'Needs your OK: ' + it.text;
      el.querySelector('.detail')!.textContent = it.detail;
      const who = open!;
      el.querySelector<HTMLButtonElement>('.allow')!.onclick = () => api.answerPermission(who.team, who.id, it.id, true);
      el.querySelector<HTMLButtonElement>('.deny')!.onclick = () => api.answerPermission(who.team, who.id, it.id, false);
      break;
    }
    case 'media': {
      if (!fresh) break;
      el.className = 'media';
      el.textContent = it.path;
      el.textContent = it.source === 'video' ? it.path.split(/[\\/]/).pop()! : it.path;
      void api.fileUrl(open?.team ?? active, it.path, it.source).then((url) => {
        if (!url) return;
        const m = document.createElement(it.path.endsWith('.mp4') ? 'video' : 'audio');
        m.controls = true;
        m.src = url;
        el!.appendChild(m);
      });
      break;
    }
  }
  if (nearBottom || fresh) box.scrollTop = box.scrollHeight;
}

api.onEvent((e: AgentEvent) => {
  const team = e.team ?? MAIN_TEAM;
  const k = hkey(team, e.agent);
  if (e.type === 'reset') {
    histories.set(k, []);
    if (isOpen(team, e.agent)) renderMessages();
    return;
  }
  if (e.type === 'status') {
    const a = teamAgents(team).find((x) => x.id === e.agent);
    if (!a) return;
    a.status = e.status!;
    a.activity = e.activity;
    refreshAgent(team, a);
    if (e.status !== 'working') office.setAgentSpeaking(team, e.agent, false);
    return;
  }
  if (e.item) {
    const h = histories.get(k) ?? [];
    const i = h.findIndex((x) => x.id === e.item!.id);
    if (i >= 0) h[i] = e.item; else h.push(e.item);
    histories.set(k, h);
    if (e.item.kind === 'agent') office.setAgentSpeaking(team, e.agent, !!e.item.streaming);
    if (isOpen(team, e.agent)) upsertEl(e.item);
  }
});

// ---------------- account, usage, banner
function showAccount(a: AccountState) {
  const chip = $('#account');
  chip.classList.remove('ok', 'warn');
  if (!a.checked) chip.textContent = 'Checking Claude login…';
  else if (a.signedIn) {
    chip.classList.add('ok');
    chip.textContent = `${a.email ?? 'Signed in'}${a.plan ? ' · ' + a.plan[0].toUpperCase() + a.plan.slice(1) : ''}`;
  } else {
    chip.classList.add('warn');
    chip.textContent = 'Not signed in to Claude';
  }
  const detail = $('#acctDetail');
  detail.textContent = !a.checked ? 'Checking…'
    : a.signedIn ? `Signed in as ${a.email ?? 'unknown'}${a.plan ? ` (${a.plan} plan)` : ''}.`
    : `Not signed in${a.error ? `: ${a.error}` : '.'}`;
  updateBanner(a);
}
let lastAccount: AccountState | null = null;
async function updateBanner(a: AccountState | null = lastAccount, busyMsg: string | null = null) {
  lastAccount = a;
  const s = await api.getSettings();
  const b = $('#banner');
  const msgs: string[] = [];
  if (a?.checked && !a.signedIn) msgs.push('Sign in to Claude Code on this PC so the agents can work.');
  if (a?.apiKeyInEnv) msgs.push('An ANTHROPIC_API_KEY is set on this PC. The app ignores it and uses your Claude plan login.');
  if (busyMsg) msgs.unshift(busyMsg);
  if (blockedMsg) msgs.push(blockedMsg);
  const g = guard.get(active);
  if (g) msgs.push(`${teams.length > 1 ? `${teamName(active)} is paused: ` : 'Paused: '}${g}`);
  if (toolkitProblem) msgs.push(toolkitProblem);
  else if (!toolkitBusy && !s.hasGeminiKey) msgs.push('Add your Gemini API key so Scripty can make voiceovers.');
  else if (!toolkitBusy && !s.renderReady) msgs.push('Set up rendering once so Cutter can build and render (Settings → Rendering).');
  b.hidden = !msgs.length;
  if (msgs.length) {
    const m = msgs[0];
    const where = /Gemini/i.test(m) ? 'Voiceover' : /render/i.test(m) ? 'Rendering' : /Claude|ANTHROPIC/i.test(m) ? 'Account' : /Publishing|Buffer|YouTube/i.test(m) ? 'Publishing' : /toolkit|GitHub|clone/i.test(m) ? 'Toolkit' : undefined;
    b.innerHTML = `<span></span><button>Open settings</button>`;
    b.querySelector('span')!.textContent = m;
    b.querySelector('button')!.onclick = () => void openSettings(where);
  }
}
api.onAccount(showAccount);
void api.getAccount().then(showAccount);
const usageBy = new Map<string, UsageState>();
const teamProfileOf = (t: TeamId) => teams.find((x) => x.id === t)?.profile ?? '';
api.onUsage((u: UsageState) => {
  usageBy.set(u.profile ?? '', u);
  if ((u.profile ?? '') === teamProfileOf(active)) showUsage(u);
});
function showUsage(u: UsageState | undefined) {
  const el = $('#usage');
  if (!u) { el.hidden = true; return; }
  el.hidden = u.utilization === undefined && !u.status;
  const pct = Math.round((u.utilization ?? (u.status === 'rejected' ? 1 : 0)) * 100);
  (el.querySelector('.meter i') as HTMLElement).style.width = pct + '%';
  el.querySelector('.val')!.textContent = u.utilization !== undefined ? `${pct}%` : u.status === 'rejected' ? 'limit' : 'ok';
  el.classList.toggle('warn', u.status === 'allowed_warning');
  el.classList.toggle('full', u.status === 'rejected');
  el.title = `Claude plan usage (${u.window?.replace('_', '-') ?? 'current window'})${u.resetsAt ? ` · resets ${new Date(u.resetsAt * (u.resetsAt < 1e12 ? 1000 : 1)).toLocaleString()}` : ''}`;
}

// ---------------- settings (side menu, one section at a time)
const sections = [...document.querySelectorAll<HTMLElement>('.set-body section')];
const navBox = $('.set-links');
function showSection(title: string) {
  for (const sec of sections) sec.classList.toggle('on', sec.dataset.title === title);
  navBox.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.title === title));
}
for (const sec of sections) {
  const b = document.createElement('button');
  b.dataset.title = sec.dataset.title!;
  b.textContent = sec.dataset.title!;
  b.onclick = () => showSection(sec.dataset.title!);
  navBox.appendChild(b);
}
showSection('Account');
async function openSettings(section?: string) {
  if (typeof section === 'string') showSection(section);
  const s = await api.getSettings();
  teams = await api.listTeams();
  const tm = teams.find((t) => t.id === active) ?? teams[0];
  ($('#toolkitPath') as HTMLInputElement).value = tm.toolkitPath;
  ($('#toolkitRepo') as HTMLInputElement).value = tm.toolkitRepo;
  $('#toolkitTeam').textContent = teams.length > 1 ? tm.name : '';
  ($('#model') as HTMLSelectElement).value = s.scriptWriterModel;
  ($('#editorModel') as HTMLSelectElement).value = s.editorModel;
  ($('#reviewerModel') as HTMLSelectElement).value = s.reviewerModel;
  ($('#publisherModel') as HTMLSelectElement).value = s.publisherModel;
  ($('#ytMode') as HTMLSelectElement).value = s.youtubeMode;
  ($('#ytTz') as HTMLSelectElement).value = s.audienceTimezone;
  renderTimes(s.postingTimes);
  ($('#ytAuto') as HTMLInputElement).checked = s.youtubeAutoUpload;
  renderEffort(s.effort);
  void showPublishing();
  $('#renderState').textContent = s.renderReady ? 'Ready' : 'Not set up';
  ($('#python') as HTMLInputElement).value = s.pythonCommand;
  ($('#dailyTime') as HTMLInputElement).value = s.dailyTime;
  showAutopilot(s.autopilot);
  ($('#geminiKey') as HTMLInputElement).value = '';
  ($('#geminiKey') as HTMLInputElement).placeholder = s.hasGeminiKey ? '•••••••• saved (paste a new one to replace)' : 'Paste key from Google AI Studio';
  $('#geminiMsg').textContent = '';
  ($('#budgetGuard') as HTMLSelectElement).value = String(s.budgetGuard ?? 0.8);
  ($('#backlogAuto') as HTMLInputElement).checked = s.backlogAuto;
  ($('#notifyDesktop') as HTMLInputElement).checked = s.notifyDesktop;
  ($('#ntfyTopic') as HTMLInputElement).value = s.ntfyTopic;
  ($('#remindMinutes') as HTMLSelectElement).value = String(s.remindMinutes);
  ($('#dayNight') as HTMLInputElement).checked = s.dayNight;
  ($('#trayOnMinimize') as HTMLInputElement).checked = s.trayOnMinimize;
  ($('#closeToTray') as HTMLInputElement).checked = s.closeToTray;
  ($('#startWithWindows') as HTMLInputElement).checked = s.startWithWindows;
  renderDays($('#setDays'), s.postingDays);
  void api.folders().then((f) => { ($('#renderDir') as HTMLInputElement).value = f.render; ($('#weeksDir') as HTMLInputElement).value = f.weeks; });
  renderFame();
  void api.listProfiles().then(renderProfiles);
  $('#settings').hidden = false;
  office.inputEnabled = false;
}
function closeSettings() {
  $('#settings').hidden = true;
  office.inputEnabled = !open;
  void updateBanner();
}
$('#settingsBtn').addEventListener('click', () => void openSettings());
$('#account').addEventListener('click', () => void openSettings('Account'));
$('#closeSettings').addEventListener('click', closeSettings);
$('#settings').addEventListener('click', (e) => { if (e.target === $('#settings')) closeSettings(); });
$('#pickToolkit').addEventListener('click', async () => {
  const p = await api.pickToolkitFolder(active);
  if (p) {
    ($('#toolkitPath') as HTMLInputElement).value = p;
    void loadBoard();
  }
});
$('#toolkitRepo').addEventListener('change', async (e) => { teams = await api.setTeamRepo(active, (e.target as HTMLInputElement).value.trim()); });
$('#cloneToolkit').addEventListener('click', async () => {
  teams = await api.setTeamRepo(active, ($('#toolkitRepo') as HTMLInputElement).value.trim());
  await api.cloneToolkit(active);
});
let toolkitBusy = false;
let toolkitProblem: string | null = null;
const toolkitState = new Map<TeamId, { busy: boolean; ok?: boolean; message: string }>();
api.onToolkit((t) => {
  const team = t.team ?? MAIN_TEAM;
  toolkitState.set(team, t);
  const prefix = teams.length > 1 ? `${teamName(team)}: ` : '';
  if (team === active) {
    const m = $('#toolkitMsg');
    m.textContent = t.message;
    m.className = `muted small ${t.busy ? '' : t.ok ? 'ok-text' : 'bad-text'}`;
  }
  toolkitBusy = [...toolkitState.values()].some((x) => x.busy);
  const bad = [...toolkitState.entries()].find(([, x]) => !x.busy && x.ok === false);
  toolkitProblem = bad ? `${teams.length > 1 ? `${teamName(bad[0])}: ` : ''}${bad[1].message}` : null;
  if (!t.busy && t.ok) void loadBoard(team);
  renderTeams();
  void updateBanner(undefined, t.busy ? prefix + t.message : null);
});
$('#publisherModel').addEventListener('change', (e) => api.saveSettings({ publisherModel: (e.target as HTMLSelectElement).value }));
$('#ytMode').addEventListener('change', (e) => api.saveSettings({ youtubeMode: (e.target as HTMLSelectElement).value as 'private' | 'scheduled' }));
$('#ytTz').addEventListener('change', async (e) => { await api.saveSettings({ audienceTimezone: (e.target as HTMLSelectElement).value }); showNextSlots(); });
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const RESEARCHED = { mon: '18:00', tue: '19:00', wed: '18:00', thu: '19:00', fri: '16:00', sat: '18:00', sun: '17:00' };
function renderTimes(t: Record<string, string>) {
  const box = $('#ytTimes');
  box.innerHTML = '';
  for (const d of DAY_ORDER) {
    const l = document.createElement('label');
    l.textContent = d;
    const i = document.createElement('input');
    i.type = 'time';
    i.value = t[d] ?? RESEARCHED[d];
    i.onchange = async () => {
      const s = await api.getSettings();
      await api.saveSettings({ postingTimes: { ...s.postingTimes, [d]: i.value || RESEARCHED[d] } });
      showNextSlots();
    };
    l.appendChild(i);
    box.appendChild(l);
  }
  showNextSlots();
}
async function showNextSlots() {
  const s = await api.getSettings();
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: s.audienceTimezone, weekday: 'short' }).format(new Date()).toLowerCase().slice(0, 3) as keyof typeof s.postingTimes;
  const city = s.audienceTimezone.split('/').pop()!.replace(/_/g, ' ');
  $('#ytNext').textContent = `Today in ${city} (${wd}): ${s.postingTimes[wd]}. One Short per day; extra Shorts take the next free days.`;
}
$('#ytResetTimes').addEventListener('click', async () => {
  await api.saveSettings({ postingTimes: { ...RESEARCHED } });
  renderTimes(RESEARCHED);
});
$('#ytAuto').addEventListener('change', (e) => api.saveSettings({ youtubeAutoUpload: (e.target as HTMLInputElement).checked }));
// ---------------- publishing (Buffer)
const HOST_FIELDS = ['cloudinaryCloud', 'cloudinaryKey', 'r2Account', 'r2Bucket', 'r2KeyId', 'r2PublicBase'] as const;
const pubMsg = (r: { ok: boolean; message: string }) => {
  const m = $('#pubMsg');
  m.textContent = r.message;
  m.className = `muted small ${r.ok ? 'ok-text' : 'bad-text'}`;
};
async function showPublishing() {
  const s = await api.getSettings();
  ($('#publishVia') as HTMLSelectElement).value = s.publishVia;
  $('#pubYouTube').hidden = s.publishVia !== 'youtube';
  $('#pubBuffer').hidden = s.publishVia !== 'buffer';
  $('#pubManual').hidden = s.publishVia !== 'manual';
  // posting times matter in every mode (they set the upload days when you post yourself)
  $('#pubSchedule').hidden = false;
  for (const id of ['#ytMode', '#ytAuto', '#ytCategory']) ($(id).closest('label') as HTMLElement).hidden = s.publishVia === 'manual';
  if (s.publishVia === 'youtube') {
    const y = await api.youtubeStatus(active);
    ($('#ytSignIn') as HTMLButtonElement).textContent = y.signedIn ? '2. Signed in (sign in again)' : '2. Sign in to YouTube';
    ($('#ytSecret') as HTMLButtonElement).textContent = y.hasClientSecret ? '1. client_secret.json saved (replace)' : '1. Choose client_secret.json…';
  }
  for (const f of HOST_FIELDS) ($(`#${f}`) as HTMLInputElement).value = s[f];
  ($('#mediaHost') as HTMLSelectElement).value = s.mediaHost;
  ($('#ytCategory') as HTMLSelectElement).value = s.youtubeCategory;
  $('#hostCloudinary').hidden = s.mediaHost !== 'cloudinary';
  $('#hostR2').hidden = s.mediaHost !== 'r2';
  const sel = $('#bufferChannel') as HTMLSelectElement;
  if (s.bufferChannelId && !sel.querySelector(`option[value="${s.bufferChannelId}"]`)) {
    sel.innerHTML = `<option value="${s.bufferChannelId}"></option>`;
    sel.options[0].textContent = s.bufferChannelName || s.bufferChannelId;
  }
  sel.value = s.bufferChannelId;
  const p = await api.publishingStatus(active);
  if (s.publishVia !== 'buffer') {
    $('#pubState').textContent = s.publishVia === 'manual' ? 'You post' : p.missing ? 'Not ready' : 'Ready';
    if (p.missing) pubMsg({ ok: false, message: `Still needed: ${p.missing}` });
    else pubMsg({ ok: true, message: '' });
    return;
  }
  ($('#bufferKey') as HTMLInputElement).placeholder = p.hasBufferKey ? '•••••••• saved (paste a new one to replace)' : 'Paste your Buffer API key';
  $('#pubState').textContent = p.missing ? 'Not ready' : 'Ready';
  if (p.missing) pubMsg({ ok: false, message: `Still needed: ${p.missing}` });
  else if (p.workerAutoUpload) pubMsg({ ok: false, message: "Your render worker is set to upload to YouTube by itself. Saving the Buffer key turns that off." });
}
async function loadChannels() {
  const r = await api.bufferChannels();
  if (!r.ok) return pubMsg(r);
  const s = await api.getSettings();
  const sel = $('#bufferChannel') as HTMLSelectElement;
  sel.innerHTML = '<option value="">—</option>';
  for (const c of r.channels) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.name} (${c.service})`;
    sel.appendChild(o);
  }
  const yt = r.channels.find((c) => /youtube/i.test(c.service));
  if (!s.bufferChannelId && yt) await api.saveSettings({ bufferChannelId: yt.id, bufferChannelName: `${yt.name} (YouTube)` });
  sel.value = (await api.getSettings()).bufferChannelId;
  if (r.message) pubMsg({ ok: false, message: r.message });
  void showPublishing();
}
$('#publishVia').addEventListener('change', async (e) => {
  await api.saveSettings({ publishVia: (e.target as HTMLSelectElement).value as 'youtube' | 'buffer' | 'manual' });
  pubMsg({ ok: true, message: '' });
  void showPublishing();
});
$('#ytSecret').addEventListener('click', async () => { pubMsg(await api.chooseClientSecret(active)); void showPublishing(); });
const ytLines: string[] = [];
api.onYouTubeLog((l) => {
  ytLines.push(l);
  if (ytLines.length > 40) ytLines.shift();
  const log = $('#ytLog');
  log.hidden = false;
  log.textContent = ytLines.join('\n');
  log.scrollTop = log.scrollHeight;
});
$('#ytSignIn').addEventListener('click', async () => {
  ytLines.length = 0;
  pubMsg({ ok: true, message: 'Signing in… finish it in the browser window.' });
  pubMsg(await api.signInYouTube(active));
  void showPublishing();
});
$('#saveBufferKey').addEventListener('click', async () => {
  const v = ($('#bufferKey') as HTMLInputElement).value;
  if (!v.trim()) return pubMsg({ ok: false, message: 'Paste the key first.' });
  pubMsg(await api.setSecret('buffer', v));
  ($('#bufferKey') as HTMLInputElement).value = '';
  await loadChannels();
});
$('#refreshChannels').addEventListener('click', () => void loadChannels());
$('#bufferChannel').addEventListener('change', async (e) => {
  const sel = e.target as HTMLSelectElement;
  await api.saveSettings({ bufferChannelId: sel.value, bufferChannelName: sel.selectedOptions[0]?.textContent ?? '' });
  void showPublishing();
});
$('#mediaHost').addEventListener('change', async (e) => {
  await api.saveSettings({ mediaHost: (e.target as HTMLSelectElement).value as 'cloudinary' | 'r2' });
  void showPublishing();
});
$('#ytCategory').addEventListener('change', (e) => api.saveSettings({ youtubeCategory: (e.target as HTMLSelectElement).value }));
for (const f of HOST_FIELDS) {
  $(`#${f}`).addEventListener('change', async (e) => {
    await api.saveSettings({ [f]: (e.target as HTMLInputElement).value.trim() });
    void showPublishing();
  });
}
document.querySelectorAll<HTMLButtonElement>('button[data-secret]').forEach((b) =>
  b.addEventListener('click', async () => {
    const name = b.dataset.secret as 'cloudinarySecret' | 'r2Secret';
    const input = $(`#${name}`) as HTMLInputElement;
    if (!input.value.trim()) return pubMsg({ ok: false, message: 'Paste the secret first.' });
    pubMsg(await api.setSecret(name, input.value));
    input.value = '';
    input.placeholder = '•••••••• saved';
    void showPublishing();
  }),
);
$('#reviewerModel').addEventListener('change', (e) => api.saveSettings({ reviewerModel: (e.target as HTMLSelectElement).value }));
$('#editorModel').addEventListener('change', (e) => api.saveSettings({ editorModel: (e.target as HTMLSelectElement).value }));
$('#setupRender').addEventListener('click', async () => {
  setupLines.length = 0;
  ($('#setupRender') as HTMLButtonElement).disabled = true;
  await api.setupRendering();
  ($('#setupRender') as HTMLButtonElement).disabled = false;
});
$('#openOutput').addEventListener('click', () => void api.openOutputFolder(active));
$('#openLog').addEventListener('click', () => void api.openSetupLog());
const setupLines: string[] = [];
api.onSetup((p) => {
  const m = $('#setupMsg');
  m.textContent = p.busy ? `${p.activity}…` : p.activity;
  if (p.line) {
    setupLines.push(p.line);
    if (setupLines.length > 60) setupLines.shift();
  }
  const log = $('#setupLog');
  log.hidden = !setupLines.length;
  log.textContent = setupLines.join('\n');
  log.scrollTop = log.scrollHeight;
  if (!p.busy) void api.getSettings().then((s) => (($('#python') as HTMLInputElement).value = s.pythonCommand));
  m.className = `muted small ${p.busy ? '' : p.ok ? 'ok-text' : 'bad-text'}`;
  if (!p.busy && p.ok) $('#renderState').textContent = 'Ready';
  void updateBanner(undefined, p.busy ? `Setting up rendering: ${p.activity}…` : null);
});
api.onBoardChanged((team) => void loadBoard(team || undefined));

// ---------------- self-update from GitHub
function showUpdate(u: UpdateInfo) {
  const chip = $('#updateChip');
  const msg = $('#updateMsg');
  const btn = $('#applyUpdate') as HTMLButtonElement;
  chip.hidden = !(u.behind > 0 || u.busy);
  chip.querySelector('span')!.textContent = u.busy ? `${u.busy}…` : 'Update ready';
  chip.title = u.busy ? u.busy : `${u.behind} new change${u.behind === 1 ? '' : 's'}: click to install and restart`;
  btn.hidden = !(u.behind > 0);
  if (!u.available) msg.textContent = 'This copy is not a Git clone, so it cannot update itself. Re-install it with "git clone" (see README).';
  else if (u.busy) msg.textContent = `Updating: ${u.busy}…`;
  else if (u.error) msg.textContent = u.error;
  else if (u.behind) msg.textContent = `${u.behind} new change${u.behind === 1 ? '' : 's'} on GitHub: ${u.changes.slice(0, 4).join(' · ')}`;
  else msg.textContent = `Up to date${u.current ? ` (${u.current})` : ''}.`;
}
async function doUpdate() {
  if (!confirm('Download the new version, rebuild and restart the app? Agents stop for a moment and pick up where they left off.')) return;
  await api.applyUpdate();
}
api.onUpdate(showUpdate);
$('#updateChip').addEventListener('click', () => void doUpdate());
$('#applyUpdate').addEventListener('click', () => void doUpdate());
$('#checkUpdate').addEventListener('click', async () => {
  $('#updateMsg').textContent = 'Checking…';
  showUpdate(await api.checkUpdate());
});
$('#model').addEventListener('change', (e) => api.saveSettings({ scriptWriterModel: (e.target as HTMLSelectElement).value }));
$('#python').addEventListener('change', (e) => api.saveSettings({ pythonCommand: (e.target as HTMLInputElement).value.trim() || 'python' }));
const geminiMsg = (r: { ok: boolean; message: string }) => {
  const m = $('#geminiMsg');
  m.textContent = r.message;
  m.className = `muted small ${r.ok ? 'ok-text' : 'bad-text'}`;
};
$('#saveGemini').addEventListener('click', async () => {
  const k = ($('#geminiKey') as HTMLInputElement).value;
  if (!k.trim()) return geminiMsg({ ok: false, message: 'Paste a key first.' });
  geminiMsg(await api.setGeminiKey(k));
  ($('#geminiKey') as HTMLInputElement).value = '';
  ($('#geminiKey') as HTMLInputElement).placeholder = '•••••••• saved (paste a new one to replace)';
});
$('#testGemini').addEventListener('click', async () => {
  geminiMsg({ ok: true, message: 'Testing…' });
  geminiMsg(await api.testGeminiKey());
});
$('#loginBtn').addEventListener('click', async () => {
  const r = await api.openLogin();
  $('#loginMsg').textContent = r.message;
});
$('#recheck').addEventListener('click', async () => {
  $('#acctDetail').textContent = 'Checking…';
  showAccount(await api.recheckAccount());
});

// ---------------- pipeline board
let boardRows: ShortRow[] = [];
/** Refresh one team's board (or all of them). */
async function loadBoard(team?: TeamId) {
  for (const t of team ? [team] : teams.map((x) => x.id)) {
    const rows = await api.listShorts(t);
    office.setBoard(t, rows);
    // each line's review screen plays its newest rendered Short
    const latest = rows.find((r) => r.file);
    office.setReviewVideo(t, latest?.file ? await api.fileUrl(t, latest.file, 'video') : null);
    postedBy.set(t, rows.filter((r) => /^(published|published_manual)$/.test(r.status)).length);
    void api.getBacklog(t).then((cards) => { office.setCork(t, cards); if (t === active && !$('#backlog').hidden) renderCards(cards); });
    if (t === active) {
      boardRows = rows;
      if (!$('#review').hidden) renderReviewList();
    }
  }
  office.setMilestones([...postedBy.values()].reduce((a, b) => a + b, 0));
  void api.getPlan().then(showPlan);
}
const postedBy = new Map<TeamId, number>();

// ---------------- review screen
let reviewing: string | null = null;
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const NAMES: Record<string, string> = { 'script-writer': 'Scripty', editor: 'Cutter', reviewer: 'Hawk', publisher: 'Pip' };
function usageTable(byAgent: Partial<Record<string, TokenCount>>, total: TokenCount): string {
  const row = (name: string, t: TokenCount) =>
    `<tr><td>${name}</td><td>${fmt(t.input + t.output + t.cacheRead + t.cacheWrite)}</td><td>${fmt(t.output)}</td><td>${fmt(t.cacheRead)}</td><td>${t.steps}</td></tr>`;
  return `<table class="usage-table"><tr><th>Desk</th><th>Total</th><th>Written</th><th>From cache</th><th>Steps</th></tr>${Object.entries(byAgent)
    .map(([k, t]) => row(NAMES[k] ?? k, t!))
    .join('')}${row('All desks', total)}</table>`;
}
/** status -> friendly label + colour group */
const STATUS: Record<string, [string, string]> = {
  new: ['New', ''], planned: ['Planned', ''], voiced: ['Voiced', 'wait'], building: ['Building', 'work'],
  ready_to_render: ['Ready to render', 'wait'], rendering: ['Rendering', 'work'], render_failed: ['Render failed', 'bad'],
  in_review: ['In review', 'wait'], reviewing: ['Reviewing', 'work'], changes_requested: ['Changes requested', 'bad'],
  approved: ['Approved', 'good'], ready_to_publish: ['Ready to publish', 'good'], queued_buffer: ['Scheduled', 'good'],
  draft_in_buffer: ['Draft in Buffer', 'wait'], uploaded_scheduled: ['Scheduled', 'good'], uploaded_private: ['Private on YouTube', 'wait'],
  published: ['Published', 'good'], published_manual: ['Posted by you', 'good'], publish_failed: ['Publish failed', 'bad'], delivered: ['Delivered', 'wait'],
};
const statusLabel = (s: string) => STATUS[s]?.[0] ?? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
function setPill(el: HTMLElement, status: string) {
  el.className = `pill ${STATUS[status]?.[1] ?? ''}${el.classList.contains('sm') ? ' sm' : ''}`;
  el.textContent = statusLabel(status);
  el.hidden = !status;
}
function renderReviewList() {
  const ul = $('#reviewList');
  ul.innerHTML = '';
  for (const r of boardRows) {
    const li = document.createElement('li');
    li.className = r.id === reviewing ? 'on' : '';
    li.innerHTML = `<span class="id"></span><span class="pill sm"></span><span class="t"></span>`;
    li.querySelector('.id')!.textContent = `${r.id} · v${r.version}`;
    setPill(li.querySelector('.pill') as HTMLElement, r.status);
    li.querySelector('.t')!.textContent = r.title;
    li.title = r.tokens ? `${fmt(r.tokens)} tokens` : '';
    li.onclick = () => void showReview(r.id);
    ul.appendChild(li);
  }
  if (!boardRows.length) ul.innerHTML = '<li class="none">No Shorts yet.</li>';
}
// tabs on the review screen
let rvTab = 'review';
function showTab(t: string) {
  rvTab = t;
  document.querySelectorAll<HTMLButtonElement>('#rvTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll<HTMLElement>('.rv-body [data-pane]').forEach((p) => (p.hidden = p.dataset.pane !== t));
}
document.querySelectorAll<HTMLButtonElement>('#rvTabs button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab!)));
async function showReview(id: string) {
  reviewing = id;
  renderReviewList();
  const info = await api.getReview(active, id);
  const row = boardRows.find((r) => r.id === id);
  $('#rvId').textContent = `${id}${row ? ` · v${row.version}` : ''}${teams.length > 1 ? ` · ${teamName(active)}` : ''}`;
  $('#rvTitle').textContent = row?.title ?? id;
  setPill($('#rvStatus'), info.status);
  const v = $('#reviewVideo') as HTMLVideoElement;
  v.hidden = !info.videoUrl;
  $('#noVideo').hidden = !!info.videoUrl;
  if (info.videoUrl && v.dataset.src !== info.videoUrl) {
    v.src = info.videoUrl;
    v.dataset.src = info.videoUrl;
  }
  const w = $('#reviewWaiting');
  w.hidden = !info.waiting;
  w.querySelector('span')!.textContent = info.waiting;
  ($('#sendOnBtn') as HTMLButtonElement).hidden = !/Waiting|Next in line|Rendered before/.test(info.waiting);
  const pb = $('#publishBox');
  pb.hidden = !info.publish && !info.inBuffer;
  $('#noPublish').hidden = !pb.hidden;
  const up = $('#uploadBtn') as HTMLButtonElement;
  const via = (await api.getSettings()).publishVia;
  up.hidden = via === 'manual' || !/^(ready_to_publish|publish_failed)$/.test(info.status);
  up.textContent = info.status === 'publish_failed' ? 'Try again' : 'Publish now';
  ($('#bufferLink') as HTMLAnchorElement).hidden = !info.inBuffer;
  const yl = $('#studioLink') as HTMLAnchorElement;
  yl.hidden = !info.youtubeId;
  if (info.youtubeId) yl.href = `https://studio.youtube.com/video/${info.youtubeId}/edit`;
  const posted = info.status === 'published_manual';
  ($('#markPosted') as HTMLButtonElement).hidden = posted;
  ($('#postedAt') as HTMLInputElement).hidden = posted;
  ($('#unmarkPosted') as HTMLButtonElement).hidden = !posted;
  ($('#postedBox').querySelector('span') as HTMLElement).textContent = posted ? 'You posted this one.' : 'Uploaded it?';
  const decided = /approved|ready_to_publish|queued|uploaded|published|draft_in_buffer/.test(info.status);
  ($('#approveBtn') as HTMLButtonElement).textContent = decided ? 'Approved' : 'Approve';
  ($('#approveBtn') as HTMLButtonElement).disabled = decided;
  const plan = info.plan;
  $('#planBox').hidden = !plan;
  if (plan) {
    $('#planWhen').textContent = `Week ${plan.week} · ${fmtDay(plan.day)}${plan.posted ? ' · posted' : ''}`;
    $('#planWhere').textContent = plan.video ?? '';
    ($('#planOpen') as HTMLButtonElement).onclick = () => void api.openWeek(plan.week);
  }
  const pa = $('#postedAt') as HTMLInputElement;
  const d = info.publishAt ? new Date(info.publishAt) : new Date();
  pa.value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  // drop the review's own "# RS-0003 v1 review — APPROVED" heading: the header above already says it
  $('#reviewText').innerHTML = info.review ? renderMarkdown(info.review.replace(/^#\s+[^\n]*\n+/, '')) : '<p class="muted">Hawk hasn\'t reviewed this one yet.</p>';
  $('#publishText').innerHTML = info.publish ? renderMarkdown(info.publish.replace(/^#\s+[^\n]*\n+/, '')) : '';
  $('#reviewUsage').innerHTML = info.usage ? usageTable(info.usage.byAgent, info.usage.total) : '<p class="muted">No token data for this Short yet.</p>';
  $('#reviewMsg').textContent = '';
}
async function openReview() {
  $('#review').hidden = false;
  office.inputEnabled = false;
  boardRows = await api.listShorts(active);
  $('#reviewTitle').textContent = teams.length > 1 ? teamName(active) : 'Review';
  renderReviewList();
  const first = boardRows.find((r) => r.file) ?? boardRows[0];
  if (first) await showReview(reviewing && boardRows.some((r) => r.id === reviewing) ? reviewing : first.id);
}
function closeReview() {
  $('#review').hidden = true;
  ($('#reviewVideo') as HTMLVideoElement).pause();
  office.inputEnabled = !open;
}
office.onScreen = (team) => { setActive(team); void openReview(); };
$('#reviewBtn').addEventListener('click', () => void openReview());
$('#closeReview').addEventListener('click', closeReview);
$('#review').addEventListener('click', (e) => { if (e.target === $('#review')) closeReview(); });
async function decide(approve: boolean) {
  if (!reviewing) return;
  const notes = ($('#reviewNotes') as HTMLTextAreaElement).value;
  $('#reviewMsg').textContent = 'Saving…';
  const r = await api.decideReview(active, reviewing, approve, notes);
  $('#reviewMsg').textContent = r.message;
  if (r.ok) ($('#reviewNotes') as HTMLTextAreaElement).value = '';
  await loadBoard();
  await showReview(reviewing);
}
$('#markPosted').addEventListener('click', async () => {
  if (!reviewing) return;
  const v = ($('#postedAt') as HTMLInputElement).value;
  $('#reviewMsg').textContent = await api.markPosted(active, reviewing, v ? new Date(v).toISOString() : null);
  await loadBoard();
  await showReview(reviewing);
});
$('#unmarkPosted').addEventListener('click', async () => {
  if (!reviewing) return;
  $('#reviewMsg').textContent = await api.unmarkPosted(active, reviewing);
  await loadBoard();
  await showReview(reviewing);
});
$('#uploadBtn').addEventListener('click', async () => {
  if (!reviewing) return;
  const r = await api.uploadNow(active, reviewing);
  $('#reviewMsg').textContent = r.message;
  await showReview(reviewing);
});
$('#sendOnBtn').addEventListener('click', async () => {
  if (!reviewing) return;
  $('#reviewMsg').textContent = await api.sendOn(active, reviewing);
  await showReview(reviewing);
});
let blockedMsg: string | null = null;
const blocked = new Map<TeamId, string>();
api.onPipelineBlocked(({ team, message }) => {
  if (message) blocked.set(team, message); else blocked.delete(team);
  const first = [...blocked.entries()][0];
  blockedMsg = first ? `${teams.length > 1 ? `${teamName(first[0])}: ` : ''}${first[1]}` : null;
  void updateBanner();
});
$('#approveBtn').addEventListener('click', () => void decide(true));
$('#changesBtn').addEventListener('click', () => void decide(false));

// ---------------- start
(async () => {
  // brand fonts must be ready before the office paints its signs and boards
  try { await Promise.all(['800 40px "Bricolage Grotesque"', '700 40px "Bricolage Grotesque"', '400 20px "DM Sans"', '600 20px "DM Sans"', '700 20px "DM Sans"'].map((f) => document.fonts.load(f))); } catch { /* fall back to system fonts */ }
  await applyTeams(await api.listTeams());
  showMode('topdown'); // always start in the Sims-style view
  showAutopilot((await api.getSettings()).autopilot);
  $('#appVersion').textContent = 'v' + (await api.appVersion());
  await loadBoard();
  setInterval(() => void loadBoard(), 20000);
  void updateBanner();
})();

// ---------------- thinking effort per desk
function renderEffort(e: Record<AgentId, string> | undefined) {
  const defaults: Record<AgentId, string> = { 'script-writer': 'high', editor: 'high', reviewer: 'medium', publisher: 'low' };
  for (const sel of document.querySelectorAll<HTMLSelectElement>('select[data-effort]')) {
    const id = sel.dataset.effort as AgentId;
    sel.innerHTML = '';
    for (const [v, t] of [['low', 'Low (fewest tokens)'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max (most tokens)']]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = t;
      sel.appendChild(o);
    }
    sel.value = e?.[id] ?? defaults[id];
    sel.onchange = async () => {
      const cur = (await api.getSettings()).effort ?? defaults;
      await api.saveSettings({ effort: { ...cur, [id]: sel.value } as typeof cur });
    };
  }
}

// ---------------- teams
function setActive(team: TeamId) {
  if (!teams.some((t) => t.id === team)) team = MAIN_TEAM;
  const changed = team !== active;
  active = team;
  const i = Math.max(0, teams.findIndex((t) => t.id === team));
  const chip = $('#teamBtn');
  chip.hidden = false;
  chip.querySelector('b')!.textContent = teamName(team);
  chip.style.setProperty('--team', TEAM_ACCENTS[i % TEAM_ACCENTS.length]);
  const sw = teamAgents(team).find((a) => a.id === 'script-writer');
  ($('#runToday') as HTMLButtonElement).disabled = !!sw && (sw.status === 'working' || sw.status === 'needs-you');
  ($('#runToday') as HTMLButtonElement).title = `Scripty${teams.length > 1 ? ` (${teamName(team)})` : ''} makes today's Short from start to finish`;
  if (changed) {
    reviewing = null;
    void api.listShorts(team).then((r) => (boardRows = r));
    showUsage(usageBy.get(teamProfileOf(team)));
    void updateBanner();
  }
}
async function applyTeams(list: TeamConfig[]) {
  teams = list;
  office.setTeams(teams.map((t) => ({ id: t.id, name: t.name })));
  for (const t of teams) {
    const a = await api.getAgents(t.id);
    agentsBy.set(t.id, a);
    a.forEach((x) => refreshAgent(t.id, x));
  }
  for (const k of [...agentsBy.keys()]) if (!teams.some((t) => t.id === k)) agentsBy.delete(k);
  if (open && !teams.some((t) => t.id === open!.team)) closeChat();
  setActive(teams.some((t) => t.id === active) ? active : MAIN_TEAM);
  renderTeams();
  void loadBoard();
}
api.onTeams((t) => void applyTeams(t));

function teamStatus(t: TeamId): string {
  const ts = toolkitState.get(t);
  if (ts?.busy) return ts.message;
  if (ts && ts.ok === false) return ts.message;
  const a = teamAgents(t);
  const working = a.filter((x) => x.status === 'working' || x.status === 'needs-you').map((x) => x.name);
  return working.length ? `Working: ${working.join(', ')}` : 'All four desks idle';
}
function renderTeams() {
  const box = $('#teamList');
  if (!box) return;
  box.innerHTML = '';
  teams.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'team-row' + (t.id === active ? ' on' : '');
    row.style.setProperty('--team', TEAM_ACCENTS[i % TEAM_ACCENTS.length]);
    row.innerHTML = `<span class="swatch"></span><div class="team-fields"><input class="tname" aria-label="Team name" /><div class="field"><input class="trepo" aria-label="Toolkit repo" placeholder="owner/repo" /><select class="tprof" aria-label="Claude account" title="Claude account this team runs on"></select></div><div class="muted small tstat"></div></div><div class="team-btns"><button class="ghost go">Go there</button><button class="ghost rm">Remove</button></div>`;
    const prof = row.querySelector('.tprof') as HTMLSelectElement;
    for (const p of profiles) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = `${p.id ? p.name : 'Default login'}${p.account.signedIn ? '' : ' (not signed in)'}`;
      prof.appendChild(o);
    }
    prof.value = t.profile ?? '';
    prof.onchange = async () => void applyTeams(await api.setTeamProfile(t.id, prof.value));
    const name = row.querySelector('.tname') as HTMLInputElement;
    name.value = t.name;
    name.onchange = async () => void applyTeams(await api.renameTeam(t.id, name.value));
    const repo = row.querySelector('.trepo') as HTMLInputElement;
    repo.value = t.toolkitRepo;
    repo.onchange = async () => { teams = await api.setTeamRepo(t.id, repo.value); await api.cloneToolkit(t.id); };
    const sharing = teams.filter((o) => o.id !== t.id && o.toolkitPath.toLowerCase() === t.toolkitPath.toLowerCase()).map((o) => o.name);
    row.querySelector('.tstat')!.textContent = `${guard.get(t.id) ? `Paused: ${guard.get(t.id)}` : teamStatus(t.id)} · ${sharing.length ? `same toolkit as ${sharing.join(', ')}` : t.toolkitPath}`;
    repo.placeholder = 'empty = the main team\'s toolkit';
    (row.querySelector('.go') as HTMLButtonElement).onclick = () => { setActive(t.id); office.focusTeam(t.id); closeTeams(); };
    const rm = row.querySelector('.rm') as HTMLButtonElement;
    rm.hidden = t.id === MAIN_TEAM;
    rm.onclick = async () => {
      if (!confirm(`Remove ${t.name}? Their desks stop and leave the studio. Their toolkit folder and Shorts stay on this PC and on GitHub.`)) return;
      const r = await api.removeTeam(t.id);
      teamMsg(r);
    };
    box.appendChild(row);
  });
  ($('#addTeamBtn') as HTMLButtonElement).disabled = teams.length >= 4;
  $('#teamCount').textContent = `${teams.length} of 4`;
}
const teamMsg = (r: { ok: boolean; message: string }) => {
  const m = $('#teamMsg');
  m.textContent = r.message;
  m.className = `muted small ${r.ok ? 'ok-text' : 'bad-text'}`;
};
function openTeams() {
  renderTeams();
  $('#teams').hidden = false;
  office.inputEnabled = false;
}
function closeTeams() {
  $('#teams').hidden = true;
  office.inputEnabled = !open;
}
$('#teamBtn').addEventListener('click', openTeams);
$('#closeTeams').addEventListener('click', closeTeams);
$('#teams').addEventListener('click', (e) => { if (e.target === $('#teams')) closeTeams(); });
$('#addTeamBtn').addEventListener('click', async () => {
  const n = $('#newTeamName') as HTMLInputElement, r = $('#newTeamRepo') as HTMLInputElement;
  const res = await api.addTeam(n.value, r.value);
  teamMsg(res);
  if (res.ok) { n.value = ''; r.value = ''; }
});

// ---------------- toasts (celebrations and quick messages)
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(title: string, text: string, tone: 'good' | 'info' = 'info') {
  const t = $('#toast');
  t.querySelector('b')!.textContent = title;
  t.querySelector('span')!.textContent = text;
  t.className = tone;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 7000);
}
$('#toast').addEventListener('click', () => ($('#toast').hidden = true));

const fmtDay = (day: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00Z`));
const fmtRange = (a: string, b: string) => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  return `${f.format(new Date(`${a}T12:00:00Z`))} – ${f.format(new Date(`${b}T12:00:00Z`))}`;
};

// ---------------- weekly quota: upload days
type Day = Settings['postingDays'][number];
const WEEK: Day[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const RANK: Day[] = ['fri', 'thu', 'tue', 'sat', 'wed', 'mon', 'sun'];
function renderDays(box: HTMLElement, on: Day[]) {
  box.innerHTML = '';
  for (const d of WEEK) {
    const b = document.createElement('button');
    b.className = 'day' + (on.includes(d) ? ' on' : '');
    b.textContent = d[0].toUpperCase() + d.slice(1);
    b.setAttribute('aria-pressed', String(on.includes(d)));
    b.onclick = async () => {
      const cur = (await api.getSettings()).postingDays;
      const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
      if (!next.length) return toast('At least one day', 'Keep at least one upload day.');
      await setDays(next);
    };
    box.appendChild(b);
  }
}
async function setDays(days: Day[]) {
  const p = await api.setPostingDays(WEEK.filter((d) => days.includes(d)));
  const s = await api.getSettings();
  renderDays($('#setDays'), s.postingDays);
  renderDays($('#weekDays'), s.postingDays);
  showPlan(p);
}
$('#quotaPreset').addEventListener('change', async (e) => {
  const n = Number((e.target as HTMLSelectElement).value);
  (e.target as HTMLSelectElement).value = '';
  if (n) await setDays(RANK.slice(0, n));
});

// ---------------- the weekly plan: top bar chip + Upload weeks panel
let plan: PlanState | null = null;
function showPlan(p: PlanState) {
  plan = p;
  const chip = $('#weekBtn');
  const cur = p.weeks.find((w) => w.week === p.current);
  chip.hidden = false;
  chip.querySelector('span')!.textContent = `Week ${p.current}`;
  const filed = cur?.entries.length ?? 0;
  const posted = cur?.entries.filter((e) => e.posted).length ?? 0;
  chip.querySelector('b')!.textContent = `${filed}/${p.quota}`;
  chip.classList.toggle('full', filed >= p.quota);
  chip.title = `Week ${p.current}: ${filed} of ${p.quota} Shorts filed, ${posted} posted · ${p.inProduction} being made`;
  $('#quotaState').textContent = `${p.quota} a week`;
  if (!$('#weeks').hidden) renderWeeks();
}
api.onPlan(showPlan);
function renderWeeks() {
  if (!plan) return;
  $('#quotaLabel').textContent = `${plan.quota} Short${plan.quota === 1 ? '' : 's'} a week · ${plan.inProduction} being made now`;
  $('#weeksPath').textContent = plan.weeksDir;
  const box = $('#weekList');
  box.innerHTML = '';
  if (!plan.weeks.length) {
    box.innerHTML = '<p class="empty-note">No Shorts filed yet. The first one that\'s approved and has its upload details starts Week 1.</p>';
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const w of [...plan.weeks].reverse()) {
    const sec = document.createElement('section');
    sec.className = 'week' + (w.week === plan.current ? ' current' : '');
    const posted = w.entries.filter((e) => e.posted).length;
    sec.innerHTML = `<header><h3></h3><span class="muted small range"></span><span class="meter"><i></i></span><span class="small count"></span><button class="btn ghost sm open">Open</button></header><ol></ol>`;
    sec.querySelector('h3')!.textContent = `Week ${String(w.week).padStart(2, '0')}${w.week === plan.current ? ' · this week' : ''}`;
    sec.querySelector('.range')!.textContent = fmtRange(w.start, w.end);
    (sec.querySelector('.meter i') as HTMLElement).style.width = `${Math.min(100, (w.entries.length / w.quota) * 100)}%`;
    sec.querySelector('.count')!.textContent = `${w.entries.length}/${w.quota} filed · ${posted} posted`;
    (sec.querySelector('.open') as HTMLButtonElement).onclick = () => void api.openWeek(w.week);
    const ol = sec.querySelector('ol')!;
    for (const e of w.entries) {
      const li = document.createElement('li');
      const late = !e.posted && e.day < today;
      li.className = e.posted ? 'posted' : late ? 'late' : '';
      li.innerHTML = `<span class="d"></span><span class="id"></span><span class="t"></span><span class="pill sm"></span>`;
      li.querySelector('.d')!.textContent = fmtDay(e.day);
      li.querySelector('.id')!.textContent = e.id;
      li.querySelector('.t')!.textContent = e.title;
      const pill = li.querySelector('.pill') as HTMLElement;
      pill.textContent = e.posted ? 'Posted' : late ? 'Not posted yet' : e.day === today ? 'Upload today' : 'Ready';
      pill.classList.add(e.posted ? 'good' : late ? 'bad' : e.day === today ? 'wait' : 'good');
      li.onclick = () => { closeWeeks(); setActive(e.team); void openReview().then(() => showReview(e.id)); };
      ol.appendChild(li);
    }
    const open = w.quota - w.entries.length;
    if (open > 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.innerHTML = '<span class="t"></span>';
      li.querySelector('.t')!.textContent = `${open} open upload day${open === 1 ? '' : 's'}: filled as the next Shorts are approved`;
      ol.appendChild(li);
    }
    box.appendChild(sec);
  }
}
async function openWeeks() {
  showPlan(await api.getPlan());
  renderDays($('#weekDays'), (await api.getSettings()).postingDays);
  renderWeeks();
  $('#weeks').hidden = false;
  office.inputEnabled = false;
}
function closeWeeks() {
  $('#weeks').hidden = true;
  office.inputEnabled = !open;
}
$('#weekBtn').addEventListener('click', () => void openWeeks());
$('#closeWeeks').addEventListener('click', closeWeeks);
$('#weeks').addEventListener('click', (e) => { if (e.target === $('#weeks')) closeWeeks(); });
$('#openWeeksRoot').addEventListener('click', () => void api.openWeek(null));

// ---------------- folders
const folderMsg = (id: string, r: { ok: boolean; message: string }) => {
  const m = $(id);
  m.textContent = r.message;
  m.className = `msg ${r.ok ? 'ok-text' : 'bad-text'}`;
};
async function chooseFolder(kind: 'render' | 'weeks', reset: boolean) {
  const r = reset ? await api.resetFolder(kind) : await api.pickFolder(kind);
  folderMsg(kind === 'render' ? '#renderDirMsg' : '#weeksDirMsg', r);
  const f = await api.folders();
  ($('#renderDir') as HTMLInputElement).value = f.render;
  ($('#weeksDir') as HTMLInputElement).value = f.weeks;
  if (r.ok) void loadBoard();
}
$('#pickRender').addEventListener('click', () => void chooseFolder('render', false));
$('#resetRender').addEventListener('click', () => void chooseFolder('render', true));
$('#pickWeeks').addEventListener('click', () => void chooseFolder('weeks', false));
$('#resetWeeks').addEventListener('click', () => void chooseFolder('weeks', true));

// ---------------- simple settings
$('#budgetGuard').addEventListener('change', (e) => api.saveSettings({ budgetGuard: Number((e.target as HTMLSelectElement).value) }));
$('#backlogAuto').addEventListener('change', (e) => api.saveSettings({ backlogAuto: (e.target as HTMLInputElement).checked }));
$('#notifyDesktop').addEventListener('change', (e) => api.saveSettings({ notifyDesktop: (e.target as HTMLInputElement).checked }));
$('#ntfyTopic').addEventListener('change', (e) => api.saveSettings({ ntfyTopic: (e.target as HTMLInputElement).value.trim() }));
$('#remindMinutes').addEventListener('change', (e) => api.saveSettings({ remindMinutes: Number((e.target as HTMLSelectElement).value) }));
$('#dayNight').addEventListener('change', async (e) => {
  const on = (e.target as HTMLInputElement).checked;
  office.setDayNight(on);
  await api.saveSettings({ dayNight: on });
});
$('#testNotify').addEventListener('click', async () => {
  await api.saveSettings({ ntfyTopic: ($('#ntfyTopic') as HTMLInputElement).value.trim() });
  folderMsg('#notifyMsg', { ok: true, message: 'Sending…' });
  folderMsg('#notifyMsg', await api.testNotify());
});

// ---------------- Hall of Fame (Settings → Studio)
function renderFame() {
  const n = [...postedBy.values()].reduce((a, b) => a + b, 0);
  const ul = $('#fameList');
  ul.innerHTML = '';
  for (const m of MILESTONES) {
    const li = document.createElement('li');
    li.className = n >= m.at ? 'on' : '';
    li.innerHTML = `<b></b><span></span><em></em>`;
    li.querySelector('b')!.textContent = String(m.at);
    li.querySelector('span')!.textContent = m.name;
    li.querySelector('em')!.textContent = n >= m.at ? 'unlocked' : `${m.at - n} to go`;
    ul.appendChild(li);
  }
}

// ---------------- story backlog (click the corkboard by Scripty's desk)
let cards: BacklogCard[] = [];
function renderCards(list: BacklogCard[]) {
  cards = list;
  const box = $('#cardList');
  box.innerHTML = '';
  const ready = cards.filter((c) => c.status === 'ready');
  const done = cards.filter((c) => c.status !== 'ready');
  if (!ready.length) box.innerHTML = '<p class="empty-note">No stories waiting. Press <b>Research more stories</b>, or let autopilot fill it.</p>';
  ready.forEach((c, i) => {
    const el = document.createElement('article');
    el.className = 'card' + (i === 0 ? ' first' : '');
    el.innerHTML = `<div class="num"></div><div class="body"><h4></h4><p class="hook"></p><p class="muted small meta"></p><details><summary>Facts and sources</summary><p class="sum"></p><ul class="src"></ul></details></div><div class="acts"><button class="btn ghost sm up" title="Move up">Up</button><button class="btn ghost sm dn" title="Move down">Down</button><button class="btn ghost sm top">Make next</button><button class="btn primary sm make">Make it now</button><button class="btn ghost sm veto">Not this one</button></div>`;
    el.querySelector('.num')!.textContent = i === 0 ? 'Next' : `#${i + 1}`;
    el.querySelector('h4')!.textContent = c.title;
    el.querySelector('.hook')!.textContent = c.hook;
    el.querySelector('.meta')!.textContent = [c.id, c.when, `${c.sources?.length ?? 0} source${c.sources?.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    el.querySelector('.sum')!.textContent = c.summary ?? '';
    const src = el.querySelector('.src')!;
    for (const x of c.sources ?? []) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      if (/^https?:\/\//.test(x.url)) a.href = x.url;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.textContent = x.title || x.url;
      li.appendChild(a);
      src.appendChild(li);
    }
    const move = (to: number) => { const r = [...ready]; r.splice(i, 1); r.splice(Math.max(0, Math.min(r.length, to)), 0, c); void saveCards([...r, ...done]); };
    (el.querySelector('.up') as HTMLButtonElement).disabled = i === 0;
    (el.querySelector('.top') as HTMLButtonElement).disabled = i === 0;
    (el.querySelector('.dn') as HTMLButtonElement).disabled = i === ready.length - 1;
    (el.querySelector('.up') as HTMLButtonElement).onclick = () => move(i - 1);
    (el.querySelector('.dn') as HTMLButtonElement).onclick = () => move(i + 1);
    (el.querySelector('.top') as HTMLButtonElement).onclick = () => move(0);
    (el.querySelector('.veto') as HTMLButtonElement).onclick = () => void saveCards(cards.map((x) => (x.id === c.id ? { ...x, status: 'vetoed' as const } : x)));
    (el.querySelector('.make') as HTMLButtonElement).onclick = async () => {
      const r = await api.makeFromCard(active, c.id);
      $('#backlogMsg').textContent = r.message;
      if (r.ok) toast('Scripty is on it', c.title);
    };
    box.appendChild(el);
  });
  if (done.length) {
    const d = document.createElement('details');
    d.className = 'done';
    d.innerHTML = `<summary>Used and set aside (${done.length})</summary><ul></ul>`;
    for (const c of done) {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><button class="btn ghost sm">Put back</button>';
      li.querySelector('span')!.textContent = `${c.id} · ${c.title} · ${c.status === 'used' ? `made as ${c.short ?? 'a Short'}` : 'set aside'}`;
      const back = li.querySelector('button') as HTMLButtonElement;
      back.hidden = c.status === 'used';
      back.onclick = () => void saveCards(cards.map((x) => (x.id === c.id ? { ...x, status: 'ready' as const } : x)));
      d.querySelector('ul')!.appendChild(li);
    }
    box.appendChild(d);
  }
}
async function saveCards(next: BacklogCard[]) {
  renderCards(next);
  office.setCork(active, next);
  const r = await api.saveBacklog(active, next);
  $('#backlogMsg').textContent = r.message;
}
async function openBacklog(team: TeamId) {
  setActive(team);
  $('#backlogTitle').textContent = teams.length > 1 ? `Story backlog · ${teamName(team)}` : 'Story backlog';
  $('#backlogMsg').textContent = '';
  renderCards(await api.getBacklog(team));
  $('#backlog').hidden = false;
  office.inputEnabled = false;
}
function closeBacklog() {
  $('#backlog').hidden = true;
  office.inputEnabled = !open;
}
office.onBacklog = (team) => void openBacklog(team);
$('#closeBacklog').addEventListener('click', closeBacklog);
$('#backlog').addEventListener('click', (e) => { if (e.target === $('#backlog')) closeBacklog(); });
$('#refillBtn').addEventListener('click', async () => {
  const r = await api.refillBacklog(active);
  $('#backlogMsg').textContent = r.message;
});
api.onBacklog((team) => void api.getBacklog(team).then((c) => { office.setCork(team, c); if (team === active && !$('#backlog').hidden) renderCards(c); }));

// ---------------- Claude accounts (Settings → Account) and per team (Teams)
let profiles: ProfileState[] = [];
function renderProfiles(list: ProfileState[]) {
  profiles = list;
  const box = $('#profileList');
  box.innerHTML = '';
  for (const p of list.filter((x) => x.id)) {
    const row = document.createElement('div');
    row.className = 'profile-row';
    row.innerHTML = `<div><b></b><span class="muted small st"></span></div><div class="btns"><button class="btn ghost sm in">Sign in</button><button class="btn ghost sm chk">Check</button><button class="btn ghost sm rm">Remove</button></div>`;
    row.querySelector('b')!.textContent = p.name;
    const a = p.account;
    const used = teams.filter((t) => (t.profile ?? '') === p.id).map((t) => t.name);
    row.querySelector('.st')!.textContent = `${!a.checked ? 'not checked yet' : a.signedIn ? `${a.email ?? 'signed in'}${a.plan ? ` · ${a.plan}` : ''}` : 'not signed in'}${used.length ? ` · ${used.join(', ')}` : ''}${p.usage?.utilization !== undefined ? ` · ${Math.round(p.usage.utilization * 100)}% used` : ''}`;
    (row.querySelector('.in') as HTMLButtonElement).onclick = async () => folderMsg('#profileMsg', await api.loginProfile(p.id));
    (row.querySelector('.chk') as HTMLButtonElement).onclick = async () => { folderMsg('#profileMsg', { ok: true, message: 'Checking…' }); renderProfiles(await api.recheckProfile(p.id)); folderMsg('#profileMsg', { ok: true, message: '' }); };
    (row.querySelector('.rm') as HTMLButtonElement).onclick = async () => folderMsg('#profileMsg', await api.removeProfile(p.id));
    box.appendChild(row);
  }
  if (!$('#teams').hidden) renderTeams();
}
api.onProfiles(renderProfiles);
$('#addProfile').addEventListener('click', async () => {
  const i = $('#newProfile') as HTMLInputElement;
  const r = await api.addProfile(i.value);
  folderMsg('#profileMsg', r);
  if (r.ok) i.value = '';
});

// ---------------- budget guard: which teams are waiting
const guard = new Map<TeamId, string>();
function showGuard(list: GuardState[]) {
  guard.clear();
  for (const g of list) if (g.paused) guard.set(g.team, g.paused);
  if (!$('#teams').hidden) renderTeams();
  void updateBanner();
}
api.onGuard(showGuard);

// ---------------- celebrations
api.onCelebrate((c: CelebrateEvent) => {
  office.celebrate(c.kind === 'week' || c.kind === 'milestone' ? null : c.team);
  const title = c.kind === 'posted' ? 'Out in the world' : c.kind === 'published' ? 'Live on YouTube' : c.kind === 'week' ? 'Week complete' : 'Studio upgrade';
  toast(title, c.text, 'good');
  void loadBoard();
});

// ---------------- the tray: pause the 3D office while hidden
api.onVisible((v) => office.setPaused(!v));
api.onSettingsChanged(async () => showAutopilot((await api.getSettings()).autopilot));
for (const id of ['trayOnMinimize', 'closeToTray', 'startWithWindows'] as const) {
  $(`#${id}`).addEventListener('change', (e) => api.saveSettings({ [id]: (e.target as HTMLInputElement).checked }));
}

// ---------------- start-up for the new parts
void (async () => {
  const s = await api.getSettings();
  office.setDayNight(s.dayNight);
  showPlan(await api.getPlan());
  showGuard(await api.getGuard());
  profiles = await api.listProfiles();
  const def = profiles.find((p) => p.id === teamProfileOf(active));
  if (def?.usage) showUsage(def.usage);
})();
