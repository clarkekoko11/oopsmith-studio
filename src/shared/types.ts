// Types shared by the main process, the preload bridge and the renderer.

export type AgentId = 'script-writer' | 'editor' | 'reviewer' | 'publisher';

export type AgentStatus = 'idle' | 'working' | 'needs-you' | 'offline' | 'error';

export interface AgentInfo {
  id: AgentId;
  name: string;
  role: string;
  /** Phase in which this agent comes online. Only phase-1 agents can be talked to now. */
  phase: number;
  status: AgentStatus;
  /** Short line under the status bubble, e.g. "RS-0002 · writing script". */
  activity?: string;
}

export type ChatItem =
  | { kind: 'user'; id: string; text: string; at: number }
  | { kind: 'agent'; id: string; text: string; at: number; streaming?: boolean }
  | { kind: 'tool'; id: string; text: string; at: number }
  | { kind: 'permission'; id: string; text: string; detail: string; at: number; state: 'pending' | 'allowed' | 'denied' }
  | { kind: 'notice'; id: string; text: string; at: number; tone?: 'info' | 'warn' | 'error' }
  | { kind: 'media'; id: string; path: string; at: number; /** 'video' = file in the render output folder */ source?: 'toolkit' | 'video' };

export interface AgentEvent {
  agent: AgentId;
  /** 'upsert' adds or replaces the item with the same id. */
  type: 'upsert' | 'status' | 'reset';
  item?: ChatItem;
  status?: AgentStatus;
  activity?: string;
}

export interface AccountState {
  checked: boolean;
  signedIn: boolean;
  email?: string;
  plan?: string;
  /** Where the login comes from, e.g. "oauth" for a Claude plan, "ANTHROPIC_API_KEY" for an API key. */
  source?: string;
  apiKeyInEnv: boolean;
  error?: string;
}

export interface UsageState {
  status?: 'allowed' | 'allowed_warning' | 'rejected';
  /** 0..1 of the current window used, when reported. */
  utilization?: number;
  window?: string;
  resetsAt?: number;
}

export interface Settings {
  /** GitHub repo the toolkit is cloned from, e.g. clarkekoko11/roblox-shorts-toolkit */
  toolkitRepo: string;
  toolkitPath: string;
  scriptWriterModel: string; // '' = account default
  editorModel: string;
  reviewerModel: string;
  pythonCommand: string; // 'python' on Windows, 'python3' elsewhere
  hasGeminiKey: boolean;
  cameraMode: 'topdown' | 'firstperson';
  /** Agents never ask questions or wait for approval; they decide, log decisions, and keep going. */
  autopilot: boolean;
  /** Run "make today's Short" automatically once a day at this time (HH:MM, local). '' = off. */
  dailyTime: string;
  /** Date (YYYY-MM-DD) of the last automatic daily run. */
  lastDailyRun: string;
  /** render_worker.py --setup has finished on this PC */
  renderReady: boolean;
}

export interface UpdateInfo {
  available: boolean;
  behind: number;
  changes: string[];
  busy?: string;
  error?: string;
  current?: string;
}

export interface TokenCount {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** tool calls / model turns */
  steps: number;
  /** finished jobs (one per message the agent handled) */
  jobs: number;
}

export interface ShortUsage {
  total: TokenCount;
  byAgent: Partial<Record<AgentId, TokenCount>>;
  updated?: number;
}

export interface ShortRow {
  id: string;
  title: string;
  status: string;
  version: number;
  /** all tokens all desks used on this Short so far */
  tokens?: number;
  /** rendered video file name (in the render output folder) */
  file?: string;
}

export interface ReviewInfo {
  id: string;
  /** what the Short is waiting for right now */
  waiting: string;
  status: string;
  review: string | null;
  videoUrl: string | null;
  usage: ShortUsage | null;
}

export interface StudioApi {
  getAgents(): Promise<AgentInfo[]>;
  getUsage(): Promise<Record<string, ShortUsage>>;
  getReview(id: string): Promise<ReviewInfo>;
  decideReview(id: string, approve: boolean, notes: string): Promise<{ ok: boolean; message: string }>;
  sendOn(id: string): Promise<string>;
  onPipelineBlocked(cb: (message: string) => void): () => void;
  appVersion(): Promise<string>;
  runDaily(): Promise<void>;
  getHistory(agent: AgentId): Promise<ChatItem[]>;
  send(agent: AgentId, text: string): Promise<void>;
  stop(agent: AgentId): Promise<void>;
  newChat(agent: AgentId): Promise<void>;
  answerPermission(agent: AgentId, id: string, allow: boolean): Promise<void>;
  onEvent(cb: (e: AgentEvent) => void): () => void;

  getAccount(): Promise<AccountState>;
  recheckAccount(): Promise<AccountState>;
  openLogin(): Promise<{ ok: boolean; message: string }>;
  onAccount(cb: (a: AccountState) => void): () => void;
  onUsage(cb: (u: UsageState) => void): () => void;

  getSettings(): Promise<Settings>;
  saveSettings(s: Partial<Settings>): Promise<Settings>;
  setGeminiKey(key: string): Promise<{ ok: boolean; message: string }>;
  testGeminiKey(): Promise<{ ok: boolean; message: string }>;
  pickToolkitFolder(): Promise<string | null>;
  cloneToolkit(): Promise<{ ok: boolean; message: string }>;
  syncToolkit(): Promise<{ ok: boolean; message: string }>;
  onToolkit(cb: (s: { busy: boolean; ok?: boolean; message: string }) => void): () => void;

  listShorts(): Promise<ShortRow[]>;
  fileUrl(path: string, source?: 'toolkit' | 'video'): Promise<string | null>;
  setupRendering(): Promise<{ ok: boolean; message: string }>;
  onSetup(cb: (p: { busy: boolean; ok?: boolean; activity: string; line: string }) => void): () => void;
  openOutputFolder(): Promise<string>;
  openSetupLog(): Promise<string>;
  onBoardChanged(cb: () => void): () => void;
  checkUpdate(): Promise<UpdateInfo>;
  applyUpdate(): Promise<{ ok: boolean; message: string }>;
  onUpdate(cb: (u: UpdateInfo) => void): () => void;
}
