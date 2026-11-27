// A stand-in for the Electron bridge so the office can be opened in a plain browser for previews/tests.
import { crewNames, type AgentEvent, type AgentId, type AgentInfo, type BacklogCard, type ChatItem, type PlanEntry, type PlanState, type Settings, type StudioApi, type TeamConfig, type TeamId } from '../../shared/types';

export function mockApi(): StudioApi {
  const listeners: ((e: AgentEvent) => void)[] = [];
  const hist: Record<string, ChatItem[]> = { 'script-writer': [] };
  let settings: Settings = { toolkitRepo: 'clarkekoko11/roblox-shorts-toolkit', publishVia: 'youtube', toolkitPath: 'C:\\Users\\you\\roblox-shorts-toolkit', scriptWriterModel: 'sonnet', editorModel: 'sonnet', reviewerModel: 'sonnet', pythonCommand: 'python', hasGeminiKey: true, cameraMode: 'topdown', autopilot: true, dailyTime: '09:00', lastDailyRun: '', renderReady: false, publisherModel: 'sonnet', youtubeAutoUpload: true, youtubeMode: 'scheduled', youtubeHour: 18, bufferChannelId: 'c1', bufferChannelName: 'Oopsmith (YouTube)', youtubeCategory: '24', mediaHost: 'cloudinary', cloudinaryCloud: 'oopsmith', cloudinaryKey: '1234', r2Account: '', r2Bucket: '', r2KeyId: '', r2PublicBase: '', audienceTimezone: 'America/New_York', postingTimes: { mon: '18:00', tue: '19:00', wed: '18:00', thu: '19:00', fri: '16:00', sat: '18:00', sun: '17:00' }, mainTeamName: 'Team Oopsmith', teams: [], effort: { 'script-writer': 'high', editor: 'high', reviewer: 'medium', publisher: 'low' },
    settingsVersion: 2, postingDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], weekOneStart: '2026-11-23', renderDir: '', weeksDir: '', budgetGuard: 0.8, notifyDesktop: true, ntfyTopic: '', remindMinutes: 120, backlogAuto: true, profiles: [{ id: 'second', name: 'second@example.com' }], mainProfile: '', dayNight: true, milestoneSeen: 1, trayOnMinimize: true, closeToTray: true, startWithWindows: false, runAllTeams: true };
  settings.publishVia = 'manual';
  settings.scriptWriterModel = settings.editorModel = settings.reviewerModel = settings.publisherModel = 'opus';
  const entry = (id: string, title: string, day: string, week: number, posted = false): PlanEntry => ({ team: 'main', id, title, day, at: `${day}T23:00:00Z`, week, version: 1, video: `C:\\Users\\you\\Videos\\Oopsmith weeks\\Week 0${week}\\${day} - ${id}.mp4`, posted });
  const plan: PlanState = {
    quota: 7, weekOneStart: '2026-11-23', weeksDir: 'C:\\Users\\you\\Videos\\Oopsmith weeks', current: 1, inProduction: 2,
    weeks: [
      { week: 1, start: '2026-11-23', end: '2026-11-29', folder: '', quota: 7, entries: [entry('RS-0003', 'Why This Jet Ran Out of Fuel at 41,000 Feet', '2026-11-27', 1, true), entry('RS-0004', 'The Comma That Cost a Dairy $5 Million', '2026-11-28', 1), entry('RS-0005', 'How a Typo Sank a Spacecraft', '2026-11-29', 1)] },
      { week: 2, start: '2026-11-30', end: '2026-12-06', folder: '', quota: 7, entries: [entry('RS-0006', 'The Lake That Swallowed an Oil Rig', '2026-11-30', 2)] },
    ],
  };
  let backlog: BacklogCard[] = [
    { id: 'B-004', title: 'The Vasa sinks 1,300 m out', hook: 'A warship too proud to float', when: '1628 · Stockholm', summary: 'Sweden’s mightiest warship capsized on its maiden voyage after builders stacked a second gun deck on a hull designed for one.', sources: [{ title: 'Vasa Museum', url: 'https://www.vasamuseet.se' }], status: 'ready' },
    { id: 'B-005', title: 'The Hyatt walkway rod change', hook: 'One rod became two, and two walkways fell', when: '1981 · Kansas City', status: 'ready', sources: [] },
    { id: 'B-006', title: 'Mars Climate Orbiter', hook: 'Pounds vs newtons, $125 million gone', when: '1999 · Mars', status: 'ready', sources: [] },
    { id: 'B-002', title: 'The Great Molasses Flood', hook: 'A tank nobody tested', when: '1919 · Boston', status: 'used', short: 'RS-0005' },
  ];
  // ?teams=2 previews a studio with more teams
  const extra = Number(new URLSearchParams(location.search).get('teams') ?? '1') - 1;
  for (let i = 0; i < extra; i++) settings.teams.push({ id: `team-${i + 2}`, name: ['Team Two', 'Team Three', 'Team Four'][i], crew: i + 1, toolkitRepo: settings.toolkitRepo, toolkitPath: settings.toolkitPath });
  const teamsCbs: ((t: TeamConfig[]) => void)[] = [];
  const teamList = (): TeamConfig[] => [{ id: 'main', name: settings.mainTeamName, toolkitRepo: settings.toolkitRepo, toolkitPath: settings.toolkitPath }, ...settings.teams];
  const agentsOf = (team: TeamId): AgentInfo[] => {
    if (team === 'main') return agents;
    const names = crewNames(settings.teams.find((t) => t.id === team)?.crew ?? 1);
    return agents.map((a, i) => ({ ...a, name: names[a.id], status: i === 0 ? 'working' : 'idle', activity: i === 0 ? 'RS-0012 · writing script' : undefined }));
  };
  const agents: AgentInfo[] = [
    { id: 'script-writer', name: 'Scripty', role: 'Script Writer', phase: 1, status: 'idle' },
    { id: 'editor', name: 'Cutter', role: 'Editor', phase: 2, status: 'working', activity: 'RS-0003 · rendering frames 42%' },
    { id: 'reviewer', name: 'Hawk', role: 'Reviewer', phase: 3, status: 'idle' },
    { id: 'publisher', name: 'Pip', role: 'Publisher', phase: 4, status: 'idle' },
  ];
  const emit = (e: AgentEvent) => listeners.forEach((l) => l(e));
  const uid = () => Math.random().toString(36).slice(2);
  const put = (agent: AgentId, item: ChatItem) => {
    const h = (hist[agent] ??= []);
    const i = h.findIndex((x) => x.id === item.id);
    if (i >= 0) h[i] = item; else h.push(item);
    emit({ team: 'main', agent, type: 'upsert', item });
  };
  return {
    getAgents: async (t) => agentsOf(t),
    listTeams: async () => teamList(),
    addTeam: async (name, repo) => {
      if (teamList().length >= 4) return { ok: false, message: 'Up to 4 teams fit in the studio.' };
      const team = { id: `t${Date.now()}`, name, toolkitRepo: repo, toolkitPath: `C:\\Users\\you\\OopsmithStudio\\teams\\${name}` };
      settings.teams.push(team);
      teamsCbs.forEach((c) => c(teamList()));
      return { ok: true, message: `${name} joined the studio.`, team };
    },
    renameTeam: async (id, name) => { if (id === 'main') settings.mainTeamName = name; else settings.teams = settings.teams.map((t) => (t.id === id ? { ...t, name } : t)); return teamList(); },
    setTeamRepo: async (id, repo) => { if (id === 'main') settings.toolkitRepo = repo; else settings.teams = settings.teams.map((t) => (t.id === id ? { ...t, toolkitRepo: repo } : t)); return teamList(); },
    removeTeam: async (id) => { settings.teams = settings.teams.filter((t) => t.id !== id); teamsCbs.forEach((c) => c(teamList())); return { ok: true, message: 'Team removed.' }; },
    onTeams: (cb) => { teamsCbs.push(cb); return () => {}; },
    sendOn: async () => 'Next in line for Cutter.',
    onPipelineBlocked: () => () => {},
    uploadNow: async () => ({ ok: true, message: 'Next in line for upload.' }),
    publishingStatus: async () => ({ hasBufferKey: true, channel: 'Oopsmith (YouTube)', hostReady: true, missing: null, workerAutoUpload: false }),
    setSecret: async () => ({ ok: true, message: 'Saved (encrypted on this PC).' }),
    youtubeStatus: async () => ({ hasClientSecret: true, signedIn: true }),
    chooseClientSecret: async () => ({ ok: true, message: 'saved' }),
    signInYouTube: async () => ({ ok: true, message: 'YouTube connected.' }),
    onYouTubeLog: () => () => {},
    markPosted: async () => 'You posted this yourself. That day counts as this Short\'s day in the schedule.',
    unmarkPosted: async () => 'Next in line to upload to YouTube.',
    bufferChannels: async () => ({ ok: true, message: '', channels: [{ id: 'c1', name: 'Oopsmith', service: 'youtube' }, { id: 'c2', name: 'oopsmith.shorts', service: 'tiktok' }] }),
    getReview: async (_t, id) => ({ id, plan: plan.weeks[0].entries[1], status: 'ready_to_publish', inBuffer: false, youtubeId: null, publishAt: null, publish: '# RS-0003 upload details\n\n**Title:** Why This Jet Ran Out of Fuel at 41,000 Feet\n\n**Alternatives:** …\n\n**Tags:** Gimli Glider, Air Canada 143, Roblox story, true story', waiting: 'Next in line to upload to YouTube.', review: `# ${id} v1 review — APPROVED\n\n## Checks\n- Technical: 1080x1920, 30 fps, audio, 58.2 s\n- Picture: clean, no clipping\n- Captions: in sync\n- Sound: max -1.2 dB\n\n## Notes\n- Shot at 41 s is a bit dark.`, videoUrl: null, usage: null }),
    decideReview: async () => ({ ok: true, message: 'Approved (preview).' }),
    getUsage: async () => ({ 'RS-0003': { total: { input: 41000, output: 52000, cacheRead: 1830000, cacheWrite: 210000, steps: 141, jobs: 3 }, byAgent: { 'script-writer': { input: 9000, output: 8000, cacheRead: 310000, cacheWrite: 40000, steps: 24, jobs: 1 }, editor: { input: 30000, output: 41000, cacheRead: 1400000, cacheWrite: 150000, steps: 104, jobs: 1 }, reviewer: { input: 2000, output: 3000, cacheRead: 120000, cacheWrite: 20000, steps: 13, jobs: 1 } } } }),
    appVersion: async () => 'preview',
    runDaily: async () => 'started',
    runDailyAll: async () => 'Team Oopsmith started. Team Two starts as soon as Team Oopsmith has picked its story.',
    getHistory: async (_t, a) => (a === 'script-writer' ? hist[a] : [{ kind: 'notice', id: 'x', at: 0, text: 'Starts work in a later phase.' }]),
    async send(_team, agent, text) {
      put(agent, { kind: 'user', id: uid(), text, at: Date.now() });
      emit({ team: 'main', agent, type: 'status', status: 'working', activity: 'Searching the web…' });
      put(agent, { kind: 'tool', id: uid(), text: 'Searching the web: little-known aviation mistakes', at: Date.now() });
      const id = uid();
      const reply = "Here are three pitches:\n\n1. **The Gimli Glider (1983)** — a jet ran out of fuel mid-air because of a pounds-vs-kilograms mix-up.\n2. **Mars Climate Orbiter (1999)** — lost because one team used imperial units.\n3. **The Vasa (1628)** — a warship sank 1,300 m into its maiden voyage.\n\nWhich one should I write?";
      let acc = '';
      for (const w of reply.split(/(\s+)/)) {
        acc += w;
        put(agent, { kind: 'agent', id, text: acc, at: Date.now(), streaming: true });
        await new Promise((r) => setTimeout(r, 12));
      }
      put(agent, { kind: 'agent', id, text: acc, at: Date.now() });
      put(agent, { kind: 'permission', id: uid(), text: 'Run a command: git push', detail: 'Running: git push origin main', at: Date.now(), state: 'pending' });
      emit({ team: 'main', agent, type: 'status', status: 'needs-you', activity: 'waiting for your OK' });
    },
    stop: async () => {},
    newChat: async (_t, a) => { hist[a] = []; emit({ team: 'main', agent: a, type: 'reset' }); },
    answerPermission: async (_t, a, id, allow) => {
      const it = hist[a].find((h) => h.id === id);
      if (it && it.kind === 'permission') put(a, { ...it, state: allow ? 'allowed' : 'denied' });
      emit({ team: 'main', agent: a, type: 'status', status: 'idle' });
    },
    onEvent: (cb) => { listeners.push(cb); return () => {}; },
    getAccount: async () => ({ checked: true, signedIn: true, email: 'you@example.com', plan: 'pro', source: 'oauth', apiKeyInEnv: false }),
    recheckAccount: async () => ({ checked: true, signedIn: true, email: 'you@example.com', plan: 'pro', source: 'oauth', apiKeyInEnv: false }),
    onAccount: () => () => {},
    openLogin: async () => ({ ok: true, message: 'A terminal opened (preview).' }),
    onUsage: (cb) => { setTimeout(() => cb({ status: 'allowed', utilization: 0.34, window: 'five_hour' }), 500); return () => {}; },
    getSettings: async () => settings,
    saveSettings: async (p) => (settings = { ...settings, ...p }),
    setGeminiKey: async () => ({ ok: true, message: 'Gemini key saved.' }),
    testGeminiKey: async () => ({ ok: true, message: 'Key works (preview).' }),
    pickToolkitFolder: async () => null,
    cloneToolkit: async () => ({ ok: true, message: 'Cloned (preview).' }),
    syncToolkit: async () => ({ ok: true, message: 'Toolkit is up to date.' }),
    onToolkit: () => () => {},
    listShorts: async () => [{ id: 'RS-0003', title: 'The Gimli Glider', status: 'approved', version: 1, tokens: 2133000, file: 'RS-0003_gimli_v1.mp4' }, { id: 'RS-0001', title: 'This 10-Foot Lake Swallowed a 15-Story Oil Rig', status: 'delivered', version: 2 }],
    fileUrl: async () => null,
    setupRendering: async () => ({ ok: true, message: 'Rendering is set up (preview).' }),
    onSetup: () => () => {},
    openOutputFolder: async () => '~/Videos/RobloxShorts',
    openSetupLog: async () => '',
    onBoardChanged: () => () => {},
    checkUpdate: async () => ({ available: true, behind: 2, changes: ['Phase 3: Reviewer desk', 'Fix board colours'], current: 'abc1234' }),
    applyUpdate: async () => ({ ok: true, message: 'Updated (preview).' }),
    onUpdate: (cb) => { setTimeout(() => cb({ available: true, behind: 2, changes: ['Phase 3: Reviewer desk', 'Fix board colours'], current: 'abc1234' }), 800); return () => {}; },

    getPlan: async () => plan,
    onPlan: () => () => {},
    openWeek: async () => plan.weeksDir,
    setPostingDays: async (d) => { settings.postingDays = d; plan.quota = d.length; plan.weeks.forEach((w) => (w.quota = d.length)); return plan; },
    pickFolder: async () => ({ ok: false, message: 'No folder chosen (preview).' }),
    resetFolder: async (k) => ({ ok: true, message: 'Back to the default (preview).', path: k === 'render' ? 'C:\\Users\\you\\Videos\\RobloxShorts' : plan.weeksDir }),
    folders: async () => ({ render: 'C:\\Users\\you\\Videos\\RobloxShorts', weeks: plan.weeksDir }),
    getBacklog: async () => backlog,
    saveBacklog: async (_t, c) => { backlog = c; return { ok: true, message: 'Saved (preview).' }; },
    refillBacklog: async () => ({ ok: true, message: 'Scripty is researching 3 stories (preview).' }),
    makeFromCard: async () => ({ ok: true, message: 'Scripty is making a Short from this story now (preview).' }),
    onBacklog: () => () => {},
    testNotify: async () => ({ ok: true, message: 'Sent to this PC (preview).' }),
    listProfiles: async () => [
      { id: '', name: 'This PC’s Claude login', account: { checked: true, signedIn: true, email: 'you@example.com', plan: 'pro', apiKeyInEnv: false }, usage: { status: 'allowed', utilization: 0.34 } },
      { id: 'second', name: 'second@example.com', account: { checked: true, signedIn: false, apiKeyInEnv: false } },
    ],
    addProfile: async (name) => ({ ok: true, message: `Added ${name} (preview).`, profile: { id: 'x', name } }),
    removeProfile: async () => ({ ok: true, message: 'Removed (preview).' }),
    loginProfile: async () => ({ ok: true, message: 'A terminal opened (preview).' }),
    recheckProfile: async () => [],
    setTeamProfile: async (id, p) => { if (id === 'main') settings.mainProfile = p; else settings.teams = settings.teams.map((t) => (t.id === id ? { ...t, profile: p } : t)); return teamList(); },
    onProfiles: () => () => {},
    onGuard: (cb) => { if (extra > 0) setTimeout(() => cb([{ team: 'main', paused: null }, { team: 'team-2', paused: 'the Claude plan is at 84%, so Team Oopsmith gets to finish first. This team carries on at 3:40 PM.' }]), 700); return () => {}; },
    getGuard: async () => [],
    onVisible: () => () => {},
    onSettingsChanged: () => () => {},
    onCelebrate: (cb) => { if (new URLSearchParams(location.search).has('celebrate')) setTimeout(() => cb({ team: 'main', id: 'RS-0004', title: 'The Comma That Cost a Dairy $5 Million', kind: 'posted', text: 'RS-0004 is out: The Comma That Cost a Dairy $5 Million' }), 1500); return () => {}; },
  };
}
