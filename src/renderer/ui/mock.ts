// A stand-in for the Electron bridge so the office can be opened in a plain browser for previews/tests.
import type { AgentEvent, AgentId, AgentInfo, ChatItem, Settings, StudioApi } from '../../shared/types';

export function mockApi(): StudioApi {
  const listeners: ((e: AgentEvent) => void)[] = [];
  const hist: Record<string, ChatItem[]> = { 'script-writer': [] };
  let settings: Settings = { toolkitRepo: 'clarkekoko11/roblox-shorts-toolkit', toolkitPath: 'C:\\Users\\you\\roblox-shorts-toolkit', scriptWriterModel: 'sonnet', editorModel: 'sonnet', reviewerModel: 'sonnet', pythonCommand: 'python', hasGeminiKey: true, cameraMode: 'topdown', autopilot: true, dailyTime: '09:00', lastDailyRun: '', renderReady: false, publisherModel: 'sonnet', youtubeAutoUpload: true, youtubeMode: 'private', youtubeHour: 18 };
  const agents: AgentInfo[] = [
    { id: 'script-writer', name: 'Scripty', role: 'Script Writer', phase: 1, status: 'idle' },
    { id: 'editor', name: 'Cutter', role: 'Editor', phase: 2, status: 'working', activity: 'RS-0003 · rendering frames 42%' },
    { id: 'reviewer', name: 'Hawk', role: 'Reviewer', phase: 3, status: 'working', activity: 'RS-0003 · checking captions' },
    { id: 'publisher', name: 'Pip', role: 'Publisher', phase: 4, status: 'idle' },
  ];
  const emit = (e: AgentEvent) => listeners.forEach((l) => l(e));
  const uid = () => Math.random().toString(36).slice(2);
  const put = (agent: AgentId, item: ChatItem) => {
    const h = (hist[agent] ??= []);
    const i = h.findIndex((x) => x.id === item.id);
    if (i >= 0) h[i] = item; else h.push(item);
    emit({ agent, type: 'upsert', item });
  };
  return {
    getAgents: async () => agents,
    sendOn: async () => 'Next in line for Cutter.',
    onPipelineBlocked: () => () => {},
    uploadNow: async () => ({ ok: true, message: 'Next in line for upload.' }),
    youtubeStatus: async () => ({ hasClientSecret: true, signedIn: true, workerAutoUpload: false }),
    chooseClientSecret: async () => ({ ok: true, message: 'saved' }),
    signInYouTube: async () => ({ ok: true, message: 'YouTube connected.' }),
    onYouTubeLog: () => () => {},
    getReview: async (id) => ({ id, status: 'uploaded_private', youtubeId: 'dQw4w9WgXcQ', publish: '# RS-0003 upload details\n\n**Title:** A Plane Ran Out of Fuel Because of ONE Math Mistake ✈️\n\n**Alternatives:** …\n\n**Tags:** Gimli Glider, Air Canada 143, Roblox story, true story', waiting: 'Uploaded to YouTube as private: publish it in YouTube Studio when you like.', review: `# ${id} v1 review — APPROVED\n\n## Checks\n- Technical: 1080x1920, 30 fps, audio, 58.2 s\n- Picture: clean, no clipping\n- Captions: in sync\n- Sound: max -1.2 dB\n\n## Notes\n- Shot at 41 s is a bit dark.`, videoUrl: null, usage: null }),
    decideReview: async () => ({ ok: true, message: 'Approved (preview).' }),
    getUsage: async () => ({ 'RS-0003': { total: { input: 41000, output: 52000, cacheRead: 1830000, cacheWrite: 210000, steps: 141, jobs: 3 }, byAgent: { 'script-writer': { input: 9000, output: 8000, cacheRead: 310000, cacheWrite: 40000, steps: 24, jobs: 1 }, editor: { input: 30000, output: 41000, cacheRead: 1400000, cacheWrite: 150000, steps: 104, jobs: 1 }, reviewer: { input: 2000, output: 3000, cacheRead: 120000, cacheWrite: 20000, steps: 13, jobs: 1 } } } }),
    appVersion: async () => 'preview',
    runDaily: async () => {},
    getHistory: async (a) => (a === 'script-writer' ? hist[a] : [{ kind: 'notice', id: 'x', at: 0, text: 'Starts work in a later phase.' }]),
    async send(agent, text) {
      put(agent, { kind: 'user', id: uid(), text, at: Date.now() });
      emit({ agent, type: 'status', status: 'working', activity: 'Searching the web…' });
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
      emit({ agent, type: 'status', status: 'needs-you', activity: 'waiting for your OK' });
    },
    stop: async () => {},
    newChat: async (a) => { hist[a] = []; emit({ agent: a, type: 'reset' }); },
    answerPermission: async (a, id, allow) => {
      const it = hist[a].find((h) => h.id === id);
      if (it && it.kind === 'permission') put(a, { ...it, state: allow ? 'allowed' : 'denied' });
      emit({ agent: a, type: 'status', status: 'idle' });
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
  };
}
