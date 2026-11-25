// A stand-in for the Electron bridge so the office can be opened in a plain browser for previews/tests.
import type { AgentEvent, AgentId, AgentInfo, ChatItem, Settings, StudioApi } from '../../shared/types';

export function mockApi(): StudioApi {
  const listeners: ((e: AgentEvent) => void)[] = [];
  const hist: Record<string, ChatItem[]> = { 'script-writer': [] };
  let settings: Settings = { toolkitRepo: 'clarkekoko11/roblox-shorts-toolkit', toolkitPath: 'C:\\Users\\you\\roblox-shorts-toolkit', scriptWriterModel: '', pythonCommand: 'python', hasGeminiKey: true, cameraMode: 'topdown', autopilot: true, dailyTime: '09:00', lastDailyRun: '' };
  const agents: AgentInfo[] = [
    { id: 'script-writer', name: 'Scripty', role: 'Script Writer', phase: 1, status: 'idle' },
    { id: 'editor', name: 'Cutter', role: 'Editor', phase: 2, status: 'offline', activity: 'arrives in Phase 2' },
    { id: 'reviewer', name: 'Hawk', role: 'Reviewer', phase: 3, status: 'offline', activity: 'arrives in Phase 3' },
    { id: 'publisher', name: 'Pip', role: 'Publisher', phase: 4, status: 'offline', activity: 'arrives in Phase 4' },
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
    listShorts: async () => [{ id: 'RS-0001', title: 'This 10-Foot Lake Swallowed a 15-Story Oil Rig', status: 'delivered', version: 2 }],
    fileUrl: async () => null,
  };
}
