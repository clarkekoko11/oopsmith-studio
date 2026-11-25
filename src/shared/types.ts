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
  | { kind: 'media'; id: string; path: string; at: number };

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
  toolkitPath: string;
  scriptWriterModel: string; // '' = account default
  pythonCommand: string; // 'python' on Windows, 'python3' elsewhere
  hasGeminiKey: boolean;
  cameraMode: 'topdown' | 'firstperson';
}

export interface ShortRow {
  id: string;
  title: string;
  status: string;
  version: number;
}

export interface StudioApi {
  getAgents(): Promise<AgentInfo[]>;
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

  listShorts(): Promise<ShortRow[]>;
  fileUrl(relPath: string): Promise<string | null>;
}
