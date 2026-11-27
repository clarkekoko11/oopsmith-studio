// Types shared by the main process, the preload bridge and the renderer.

export type AgentId = 'script-writer' | 'editor' | 'reviewer' | 'publisher';

/** A team is one full production line (all four desks) working on its own toolkit repo. 'main' always exists. */
export type TeamId = string;
export const MAIN_TEAM: TeamId = 'main';

export interface TeamConfig {
  id: TeamId;
  name: string;
  /** GitHub repo this team's toolkit is cloned from (main team: Settings.toolkitRepo) */
  toolkitRepo: string;
  /** local clone (main team: Settings.toolkitPath) */
  toolkitPath: string;
  /** Claude account this team runs on ('' = this PC's default Claude Code login; main team: Settings.mainProfile) */
  profile?: string;
}

/** An extra Claude account (its own Claude Code login folder on this PC). */
export interface ProfileConfig { id: string; name: string }
export interface ProfileState extends ProfileConfig { account: AccountState; usage?: UsageState }

/** A story Scripty researched ahead of time (shorts/backlog.json in the team's toolkit). */
export interface BacklogCard {
  id: string;
  title: string;
  hook: string;
  /** e.g. "1983 · Canada" */
  when?: string;
  summary?: string;
  sources?: { title: string; url: string }[];
  status: 'ready' | 'used' | 'vetoed';
  /** the Short made from it */
  short?: string;
  added?: string;
}

/** One planned upload day: which Short goes out when, and where its files are in the weekly folders. */
export interface PlanEntry {
  team: TeamId;
  id: string;
  title: string;
  /** YYYY-MM-DD in the audience's time zone */
  day: string;
  /** exact posting time (ISO) */
  at: string;
  week: number;
  version: number;
  /** absolute path of the filed video */
  video?: string;
  /** absolute path of the details text file */
  details?: string;
  /** the render's own file name (registry "file"), which the filed video was moved from */
  source?: string;
  posted?: boolean;
  reminded?: boolean;
}

export interface WeekSummary {
  week: number;
  /** YYYY-MM-DD, first day of the week */
  start: string;
  end: string;
  folder: string;
  quota: number;
  entries: PlanEntry[];
}

export interface PlanState {
  quota: number;
  weekOneStart: string;
  weeksDir: string;
  /** the week that holds today */
  current: number;
  weeks: WeekSummary[];
  /** Shorts still being made (not yet filed) across all teams */
  inProduction: number;
}

/** Why a team's desks aren't starting new jobs right now (null = running). */
export interface GuardState { team: TeamId; paused: string | null }

export interface CelebrateEvent { team: TeamId; id: string; title: string; kind: 'posted' | 'published' | 'week' | 'milestone'; text: string }

/** How hard each agent thinks (Opus adaptive thinking). Lower = fewer tokens. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

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
  team: TeamId;
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
  /** which Claude account this is for ('' = default login) */
  profile?: string;
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
  publisherModel: string;
  /** upload approved Shorts by themselves (otherwise wait for your Upload click) */
  youtubeAutoUpload: boolean;
  /** private: you publish in YouTube Studio; scheduled: goes public at youtubeHour the next day */
  youtubeMode: 'private' | 'scheduled';
  youtubeHour: number;
  /** how approved Shorts get posted; switch any time */
  publishVia: 'youtube' | 'buffer' | 'manual';
  /** Buffer channel (your YouTube channel inside Buffer) */
  bufferChannelId: string;
  bufferChannelName: string;
  /** YouTube category id sent with each post (24 Entertainment, 27 Education) */
  youtubeCategory: string;
  /** where videos are put online for Buffer to fetch */
  mediaHost: 'cloudinary' | 'r2';
  cloudinaryCloud: string;
  cloudinaryKey: string;
  r2Account: string;
  r2Bucket: string;
  r2KeyId: string;
  r2PublicBase: string;
  /** IANA time zone of the main audience; posting times are in this zone */
  audienceTimezone: string;
  /** best posting time per weekday (HH:MM in audienceTimezone); one Short per day */
  postingTimes: Record<'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat', string>;
  /** thinking effort per desk */
  effort: Record<AgentId, Effort>;
  /** name of the main team (its repo and folder are toolkitRepo / toolkitPath above) */
  mainTeamName: string;
  /** extra teams; each runs its own line of four agents in parallel */
  teams: TeamConfig[];

  /** bumped by one-time migrations */
  settingsVersion: number;
  /** weekdays that get a Short; how many = the weekly quota */
  postingDays: ('sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat')[];
  /** Monday (YYYY-MM-DD) that starts Week 1; '' = the week of the first filed Short */
  weekOneStart: string;
  /** where finished videos are rendered ('' = the render worker's default, ~/Videos/RobloxShorts) */
  renderDir: string;
  /** where the Week 01, Week 02… folders go ('' = "Oopsmith weeks" next to the render folder) */
  weeksDir: string;
  /** pause the extra teams on an account above this share of its Claude plan window (0 = never) */
  budgetGuard: number;
  /** Windows notifications */
  notifyDesktop: boolean;
  /** ntfy.sh topic (or full ntfy URL) for phone notifications; '' = off */
  ntfyTopic: string;
  /** remind you on upload days this many minutes before the posting time (0 = off) */
  remindMinutes: number;
  /** keep each team's story backlog topped up (one research job a day at most) */
  backlogAuto: boolean;
  /** extra Claude accounts */
  profiles: ProfileConfig[];
  /** Claude account of the main team ('' = default login) */
  mainProfile: string;
  /** light the studio by the real time of day */
  dayNight: boolean;
  /** highest studio milestone already announced */
  milestoneSeen: number;
  /** minimizing hides the window to the system tray (by the clock) instead of the taskbar */
  trayOnMinimize: boolean;
  /** closing the window keeps the studio running in the tray (Quit from the tray icon to stop it) */
  closeToTray: boolean;
  /** start with Windows, straight into the tray */
  startWithWindows: boolean;
  /** "Make today's Short" starts every team (false = only the team you're looking at) */
  runAllTeams: boolean;
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
  /** publish.md text (upload details) */
  publish: string | null;
  /** true once the post exists in Buffer (scheduled, draft or published) */
  inBuffer: boolean;
  youtubeId: string | null;
  publishAt: string | null;
  /** what the Short is waiting for right now */
  waiting: string;
  status: string;
  review: string | null;
  videoUrl: string | null;
  usage: ShortUsage | null;
  /** its upload day and weekly folder, once filed */
  plan: PlanEntry | null;
}

export interface StudioApi {
  getAgents(team: TeamId): Promise<AgentInfo[]>;
  listTeams(): Promise<TeamConfig[]>;
  addTeam(name: string, repo: string): Promise<{ ok: boolean; message: string; team?: TeamConfig }>;
  renameTeam(team: TeamId, name: string): Promise<TeamConfig[]>;
  setTeamRepo(team: TeamId, repo: string): Promise<TeamConfig[]>;
  removeTeam(team: TeamId): Promise<{ ok: boolean; message: string }>;
  onTeams(cb: (t: TeamConfig[]) => void): () => void;
  getUsage(team: TeamId): Promise<Record<string, ShortUsage>>;
  getReview(team: TeamId, id: string): Promise<ReviewInfo>;
  decideReview(team: TeamId, id: string, approve: boolean, notes: string): Promise<{ ok: boolean; message: string }>;
  sendOn(team: TeamId, id: string): Promise<string>;
  uploadNow(team: TeamId, id: string): Promise<{ ok: boolean; message: string }>;
  publishingStatus(team: TeamId): Promise<{ hasBufferKey: boolean; channel: string; hostReady: boolean; missing: string | null; workerAutoUpload: boolean }>;
  setSecret(name: 'buffer' | 'cloudinarySecret' | 'r2Secret', value: string): Promise<{ ok: boolean; message: string }>;
  bufferChannels(): Promise<{ ok: boolean; message: string; channels: { id: string; name: string; service: string }[] }>;
  youtubeStatus(team: TeamId): Promise<{ hasClientSecret: boolean; signedIn: boolean }>;
  chooseClientSecret(team: TeamId): Promise<{ ok: boolean; message: string }>;
  signInYouTube(team: TeamId): Promise<{ ok: boolean; message: string }>;
  onYouTubeLog(cb: (line: string) => void): () => void;
  markPosted(team: TeamId, id: string, whenIso: string | null): Promise<string>;
  unmarkPosted(team: TeamId, id: string): Promise<string>;
  onPipelineBlocked(cb: (p: { team: TeamId; message: string }) => void): () => void;
  appVersion(): Promise<string>;
  /** 'started', 'busy', 'quota' or why not */
  runDaily(team: TeamId): Promise<string>;
  /** every team makes a Short (teams sharing a toolkit take turns choosing their story); returns a summary line */
  runDailyAll(): Promise<string>;
  getHistory(team: TeamId, agent: AgentId): Promise<ChatItem[]>;
  send(team: TeamId, agent: AgentId, text: string): Promise<void>;
  stop(team: TeamId, agent: AgentId): Promise<void>;
  newChat(team: TeamId, agent: AgentId): Promise<void>;
  answerPermission(team: TeamId, agent: AgentId, id: string, allow: boolean): Promise<void>;
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
  pickToolkitFolder(team: TeamId): Promise<string | null>;
  cloneToolkit(team: TeamId): Promise<{ ok: boolean; message: string }>;
  syncToolkit(team: TeamId): Promise<{ ok: boolean; message: string }>;
  onToolkit(cb: (s: { team: TeamId; busy: boolean; ok?: boolean; message: string }) => void): () => void;

  listShorts(team: TeamId): Promise<ShortRow[]>;
  fileUrl(team: TeamId, path: string, source?: 'toolkit' | 'video'): Promise<string | null>;
  setupRendering(): Promise<{ ok: boolean; message: string }>;
  onSetup(cb: (p: { busy: boolean; ok?: boolean; activity: string; line: string }) => void): () => void;
  openOutputFolder(team: TeamId): Promise<string>;
  openSetupLog(): Promise<string>;
  onBoardChanged(cb: (team: TeamId) => void): () => void;
  checkUpdate(): Promise<UpdateInfo>;
  applyUpdate(): Promise<{ ok: boolean; message: string }>;
  onUpdate(cb: (u: UpdateInfo) => void): () => void;

  // weekly plan + folders
  getPlan(): Promise<PlanState>;
  onPlan(cb: (p: PlanState) => void): () => void;
  openWeek(week: number | null): Promise<string>;
  /** set the weekdays that get a Short (their count is the weekly quota) */
  setPostingDays(days: Settings['postingDays']): Promise<PlanState>;
  pickFolder(kind: 'render' | 'weeks'): Promise<{ ok: boolean; message: string; path?: string }>;
  resetFolder(kind: 'render' | 'weeks'): Promise<{ ok: boolean; message: string; path?: string }>;
  folders(): Promise<{ render: string; weeks: string }>;

  // story backlog
  getBacklog(team: TeamId): Promise<BacklogCard[]>;
  saveBacklog(team: TeamId, cards: BacklogCard[]): Promise<{ ok: boolean; message: string }>;
  refillBacklog(team: TeamId): Promise<{ ok: boolean; message: string }>;
  makeFromCard(team: TeamId, card: string): Promise<{ ok: boolean; message: string }>;
  onBacklog(cb: (team: TeamId) => void): () => void;

  // notifications
  testNotify(): Promise<{ ok: boolean; message: string }>;

  // Claude accounts per team
  listProfiles(): Promise<ProfileState[]>;
  addProfile(name: string): Promise<{ ok: boolean; message: string; profile?: ProfileConfig }>;
  removeProfile(id: string): Promise<{ ok: boolean; message: string }>;
  loginProfile(id: string): Promise<{ ok: boolean; message: string }>;
  recheckProfile(id: string): Promise<ProfileState[]>;
  setTeamProfile(team: TeamId, profile: string): Promise<TeamConfig[]>;
  onProfiles(cb: (p: ProfileState[]) => void): () => void;

  // budget guard, celebrations
  onGuard(cb: (g: GuardState[]) => void): () => void;
  getGuard(): Promise<GuardState[]>;
  onCelebrate(cb: (c: CelebrateEvent) => void): () => void;
  /** the window was hidden to the tray (false) or shown again (true) */
  onVisible(cb: (v: boolean) => void): () => void;
  /** settings changed outside the window (e.g. Autopilot from the tray menu) */
  onSettingsChanged(cb: () => void): () => void;
}
