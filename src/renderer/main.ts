// Wires the 3D office to the chat drawer, top bar and settings.
import type { AccountState, AgentEvent, AgentId, AgentInfo, ChatItem, StudioApi, UpdateInfo, UsageState } from '../shared/types';
import { Office, type CameraMode } from './office/game';
import { renderMarkdown } from './ui/markdown';
import { mockApi } from './ui/mock';

declare global {
  interface Window { studio?: StudioApi; __office?: Office }
}
const api: StudioApi = window.studio ?? mockApi();
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const COLORS: Record<AgentId, string> = { 'script-writer': '#ffb84d', editor: '#5ec8ff', reviewer: '#ff6b8b', publisher: '#7be07b' };
const STARTERS: Partial<Record<AgentId, string[]>> = {
  'script-writer': [
    'Pitch me 3 little-known true stories about tiny mistakes.',
    'Write a script about the Gimli Glider.',
    'Which Shorts have we made so far?',
  ],
  editor: ['What are you working on?', 'Build the latest voiced Short.', 'Why did the last render fail?'],
};
const BLURB: Partial<Record<AgentId, string>> = {
  'script-writer': 'finds true stories, checks the facts, writes your script and makes the voiceover.',
  editor: 'builds the cast, sets, story, sound and captions, checks the stills, and renders on your graphics card.',
};

let agents: AgentInfo[] = [];
let open: AgentId | null = null;
const histories = new Map<AgentId, ChatItem[]>();

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
office.onHint = (id) => {
  const h = $('#hint');
  const a = agents.find((x) => x.id === id);
  h.hidden = !a;
  if (a) h.innerHTML = `<kbd>E</kbd> Talk to ${a.name}`;
};

// ---------------- agents + chat
office.onTalk = (id) => openChat(id);

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
$('#runToday').addEventListener('click', () => void api.runDaily());

function refreshAgent(a: AgentInfo) {
  if (a.id === 'script-writer') ($('#runToday') as HTMLButtonElement).disabled = a.status === 'working' || a.status === 'needs-you';
  office.setAgentInfo(a.id, a.name, a.role, a.status, a.activity);
  if (open === a.id) {
    $('#chat .status').textContent = a.status === 'offline' ? 'not here yet' : a.activity && a.status !== 'idle' ? a.activity : a.status;
    $('#stopBtn').hidden = a.status !== 'working' && a.status !== 'needs-you';
  }
}

async function openChat(id: AgentId) {
  const a = agents.find((x) => x.id === id)!;
  open = id;
  office.setTalking(id);
  office.inputEnabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  const chat = $('#chat');
  chat.classList.add('open');
  chat.setAttribute('aria-hidden', 'false');
  const av = $('#chat .avatar');
  av.style.background = COLORS[id];
  av.textContent = a.name[0];
  $('#chat .name').textContent = a.name;
  $('#chat .role').textContent = a.role;
  const live = a.status !== 'offline';
  ($('#input') as HTMLTextAreaElement).disabled = !live;
  ($('#sendBtn') as HTMLButtonElement).disabled = !live;
  $('#newChat').hidden = !live;
  ($('#input') as HTMLTextAreaElement).placeholder = live ? `Ask ${a.name}…` : `${a.name} arrives in Phase ${a.phase}`;
  histories.set(id, await api.getHistory(id));
  renderMessages();
  refreshAgent(a);
  if (live) setTimeout(() => $('#input').focus(), 250);
}

function closeChat() {
  if (open) office.setAgentSpeaking(open, false);
  open = null;
  office.setTalking(null);
  office.inputEnabled = true;
  $('#chat').classList.remove('open');
  $('#chat').setAttribute('aria-hidden', 'true');
  ($('#input') as HTMLTextAreaElement).blur();
}
$('#closeChat').addEventListener('click', closeChat);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && open && !document.pointerLockElement && $('#settings').hidden) closeChat();
});
$('#newChat').addEventListener('click', async () => {
  if (open && confirm('Start a new conversation? The current one will be cleared from this desk.')) await api.newChat(open);
});
$('#stopBtn').addEventListener('click', () => open && api.stop(open));

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
  void api.send(open, t);
}

const itemEls = new Map<string, HTMLElement>();
function renderMessages() {
  const box = $('#messages');
  box.innerHTML = '';
  itemEls.clear();
  const items = (open && histories.get(open)) || [];
  const a = agents.find((x) => x.id === open);
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
      const agent = open!;
      el.querySelector<HTMLButtonElement>('.allow')!.onclick = () => api.answerPermission(agent, it.id, true);
      el.querySelector<HTMLButtonElement>('.deny')!.onclick = () => api.answerPermission(agent, it.id, false);
      break;
    }
    case 'media': {
      if (!fresh) break;
      el.className = 'media';
      el.textContent = it.path;
      el.textContent = it.source === 'video' ? it.path.split(/[\\/]/).pop()! : it.path;
      void api.fileUrl(it.path, it.source).then((url) => {
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
  if (e.type === 'reset') {
    histories.set(e.agent, []);
    if (open === e.agent) renderMessages();
    return;
  }
  if (e.type === 'status') {
    const a = agents.find((x) => x.id === e.agent);
    if (!a) return;
    a.status = e.status!;
    a.activity = e.activity;
    refreshAgent(a);
    if (e.status !== 'working') office.setAgentSpeaking(e.agent, false);
    return;
  }
  if (e.item) {
    const h = histories.get(e.agent) ?? [];
    const i = h.findIndex((x) => x.id === e.item!.id);
    if (i >= 0) h[i] = e.item; else h.push(e.item);
    histories.set(e.agent, h);
    if (e.item.kind === 'agent') office.setAgentSpeaking(e.agent, !!e.item.streaming);
    if (open === e.agent) upsertEl(e.item);
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
  if (toolkitProblem) msgs.push(toolkitProblem);
  else if (!toolkitBusy && !s.hasGeminiKey) msgs.push('Add your Gemini API key so Scripty can make voiceovers.');
  else if (!toolkitBusy && !s.renderReady) msgs.push('Set up rendering once so Cutter can build and render (Settings → Rendering).');
  b.hidden = !msgs.length;
  if (msgs.length) {
    b.innerHTML = `<span>${msgs[0]}</span><button>Open settings</button>`;
    b.querySelector('button')!.onclick = openSettings;
  }
}
api.onAccount(showAccount);
void api.getAccount().then(showAccount);
api.onUsage((u: UsageState) => {
  const el = $('#usage');
  el.hidden = u.utilization === undefined && !u.status;
  const pct = Math.round((u.utilization ?? (u.status === 'rejected' ? 1 : 0)) * 100);
  (el.querySelector('.meter i') as HTMLElement).style.width = pct + '%';
  el.querySelector('.val')!.textContent = u.utilization !== undefined ? `${pct}%` : u.status === 'rejected' ? 'limit' : 'ok';
  el.classList.toggle('warn', u.status === 'allowed_warning');
  el.classList.toggle('full', u.status === 'rejected');
  el.title = `Claude plan usage (${u.window?.replace('_', '-') ?? 'current window'})${u.resetsAt ? ` · resets ${new Date(u.resetsAt * (u.resetsAt < 1e12 ? 1000 : 1)).toLocaleString()}` : ''}`;
});

// ---------------- settings
async function openSettings() {
  const s = await api.getSettings();
  ($('#toolkitPath') as HTMLInputElement).value = s.toolkitPath;
  ($('#toolkitRepo') as HTMLInputElement).value = s.toolkitRepo;
  ($('#model') as HTMLSelectElement).value = s.scriptWriterModel;
  ($('#editorModel') as HTMLSelectElement).value = s.editorModel;
  $('#renderState').textContent = s.renderReady ? '· set up ✓' : '· not set up yet';
  ($('#python') as HTMLInputElement).value = s.pythonCommand;
  ($('#dailyTime') as HTMLInputElement).value = s.dailyTime;
  showAutopilot(s.autopilot);
  ($('#geminiKey') as HTMLInputElement).value = '';
  ($('#geminiKey') as HTMLInputElement).placeholder = s.hasGeminiKey ? '•••••••• saved (paste a new one to replace)' : 'Paste key from Google AI Studio';
  $('#geminiMsg').textContent = '';
  $('#settings').hidden = false;
  office.inputEnabled = false;
}
function closeSettings() {
  $('#settings').hidden = true;
  office.inputEnabled = !open;
  void updateBanner();
}
$('#settingsBtn').addEventListener('click', openSettings);
$('#account').addEventListener('click', openSettings);
$('#closeSettings').addEventListener('click', closeSettings);
$('#settings').addEventListener('click', (e) => { if (e.target === $('#settings')) closeSettings(); });
$('#pickToolkit').addEventListener('click', async () => {
  const p = await api.pickToolkitFolder();
  if (p) {
    ($('#toolkitPath') as HTMLInputElement).value = p;
    void loadBoard();
  }
});
$('#toolkitRepo').addEventListener('change', (e) => api.saveSettings({ toolkitRepo: (e.target as HTMLInputElement).value.trim() }));
$('#cloneToolkit').addEventListener('click', async () => {
  await api.saveSettings({ toolkitRepo: ($('#toolkitRepo') as HTMLInputElement).value.trim() });
  await api.cloneToolkit();
});
let toolkitBusy = false;
let toolkitProblem: string | null = null;
api.onToolkit((t) => {
  toolkitBusy = t.busy;
  const m = $('#toolkitMsg');
  m.textContent = t.message;
  m.className = `muted small ${t.busy ? '' : t.ok ? 'ok-text' : 'bad-text'}`;
  toolkitProblem = !t.busy && t.ok === false ? t.message : null;
  if (!t.busy && t.ok) void loadBoard();
  void updateBanner(undefined, t.busy ? t.message : null);
});
$('#editorModel').addEventListener('change', (e) => api.saveSettings({ editorModel: (e.target as HTMLSelectElement).value }));
$('#setupRender').addEventListener('click', async () => {
  setupLines.length = 0;
  ($('#setupRender') as HTMLButtonElement).disabled = true;
  await api.setupRendering();
  ($('#setupRender') as HTMLButtonElement).disabled = false;
});
$('#openOutput').addEventListener('click', () => void api.openOutputFolder());
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
  if (!p.busy && p.ok) $('#renderState').textContent = '· set up ✓';
  void updateBanner(undefined, p.busy ? `Setting up rendering: ${p.activity}…` : null);
});
api.onBoardChanged(() => void loadBoard());

// ---------------- self-update from GitHub
function showUpdate(u: UpdateInfo) {
  const chip = $('#updateChip');
  const msg = $('#updateMsg');
  const btn = $('#applyUpdate') as HTMLButtonElement;
  chip.hidden = !(u.behind > 0 || u.busy);
  chip.textContent = u.busy ? `⬆ ${u.busy}…` : `⬆ Update ready (${u.behind})`;
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
async function loadBoard() {
  office.setBoard(await api.listShorts());
}

// ---------------- start
(async () => {
  agents = await api.getAgents();
  agents.forEach(refreshAgent);
  showMode('topdown'); // always start in the Sims-style view
  showAutopilot((await api.getSettings()).autopilot);
  $('#appVersion').textContent = 'v' + (await api.appVersion());
  await loadBoard();
  setInterval(loadBoard, 20000);
  void updateBanner();
})();
