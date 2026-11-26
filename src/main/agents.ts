// Runs each agent as a long-lived Claude Agent SDK session and turns its messages into chat items.
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SDKUserMessage, SDKMessage, Query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, AgentId, AgentInfo, AgentStatus, ChatItem, UsageState } from '../shared/types';
import { AGENTS, AUTOPILOT_TAG, agentMeta, instructions, LIVE_PHASE, PROMPT_VERSION } from './agentDefs';
import { decide, describeTool, inside } from './permissions';
import { agentEnv, claudeExecutable, loadSdk } from './sdk';
import { getGeminiKey, loadSettings } from './settings';
import { describe, recordTurn } from './usage';

type Emit = (e: AgentEvent) => void;
type UsageEmit = (u: UsageState) => void;
type TurnEnd = (id: AgentId) => void;
type NewItem = ChatItem extends infer T ? (T extends ChatItem ? Omit<T, 'id' | 'at'> : never) : never;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const store = (...p: string[]) => join(app.getPath('userData'), ...p);

class Inbox {
  private items: SDKUserMessage[] = [];
  private wake?: () => void;
  private closed = false;
  push(text: string) {
    this.items.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      origin: { kind: 'human' },
    } as SDKUserMessage);
    this.wake?.();
  }
  close() {
    this.closed = true;
    this.wake?.();
  }
  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (!this.closed) {
      if (this.items.length) {
        yield this.items.shift()!;
        continue;
      }
      await new Promise<void>((r) => (this.wake = r));
      this.wake = undefined;
    }
  }
}

class AgentSession {
  status: AgentStatus = 'idle';
  activity?: string;
  history: ChatItem[] = [];
  private inbox?: Inbox;
  private q?: Query;
  private liveTextId?: string;
  private pendingPermissions = new Map<string, (allow: boolean) => void>();
  private saveTimer?: NodeJS.Timeout;

  onTurnEnd: TurnEnd = () => {};
  onUsage: (short: string | undefined) => void = () => {};
  /** the Short this conversation is working on (tokens are counted against it) */
  currentShort?: string;
  /** set while the app (not the agent) is busy for this desk, e.g. rendering */
  external?: string;

  constructor(readonly id: AgentId, private emit: Emit, private usage: UsageEmit) {
    try {
      this.history = JSON.parse(readFileSync(store('history', `${id}.json`), 'utf8'));
      // Anything that was streaming or waiting when the app closed is finished now.
      for (const h of this.history) {
        if (h.kind === 'agent') h.streaming = false;
        if (h.kind === 'permission' && h.state === 'pending') h.state = 'denied';
      }
    } catch { /* new */ }
  }

  private readSessions(): Record<string, string | number> {
    try { return JSON.parse(readFileSync(store('sessions.json'), 'utf8')); } catch { return {}; }
  }
  /** The saved session, only if it was made with the current instructions. */
  private get sessionId(): string | undefined {
    const all = this.readSessions();
    return all[`${this.id}:v`] === PROMPT_VERSION ? (all[this.id] as string | undefined) : undefined;
  }
  private get hasOutdatedSession(): boolean {
    const all = this.readSessions();
    return Boolean(all[this.id]) && all[`${this.id}:v`] !== PROMPT_VERSION;
  }
  private set sessionId(v: string | undefined) {
    const all = this.readSessions();
    if (v) { all[this.id] = v; all[`${this.id}:v`] = PROMPT_VERSION; } else { delete all[this.id]; delete all[`${this.id}:v`]; }
    writeFileSync(store('sessions.json'), JSON.stringify(all, null, 2));
  }

  put(item: ChatItem) {
    const i = this.history.findIndex((h) => h.id === item.id);
    if (i >= 0) this.history[i] = item; else this.history.push(item);
    this.emit({ agent: this.id, type: 'upsert', item });
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 400);
  }
  private save() {
    mkdirSync(store('history'), { recursive: true });
    writeFileSync(store('history', `${this.id}.json`), JSON.stringify(this.history.slice(-400)));
  }
  setStatus(status: AgentStatus, activity?: string) {
    if (this.external && status === 'idle') {
      status = 'working';
      activity = this.external;
    }
    this.status = status;
    this.activity = activity;
    this.emit({ agent: this.id, type: 'status', status, activity });
  }
  notice(text: string, tone: 'info' | 'warn' | 'error' = 'info') {
    this.put({ kind: 'notice', id: uid(), text, tone, at: Date.now() });
  }

  /**
   * display: what the chat shows (defaults to text). In autopilot the agent gets the autopilot tag.
   * fresh: start a new conversation (one per Short, so old Shorts don't get re-sent on every step).
   * short: the Short this work is for (tokens are counted against it).
   */
  async send(text: string, display?: string, opts: { fresh?: boolean; short?: string } = {}): Promise<boolean> {
    const settings = loadSettings();
    if (!settings.toolkitPath || !existsSync(settings.toolkitPath)) {
      this.notice("The toolkit isn't on this PC yet. Open Settings → Toolkit → Clone / update.", 'warn');
      return false;
    }
    if (opts.fresh) {
      this.reset();
      this.sessionId = undefined;
      this.currentShort = opts.short;
      this.notice(`New conversation${opts.short ? ` for ${opts.short}` : ''}.`);
    } else if (opts.short) {
      this.currentShort = opts.short;
    }
    const mentioned = /RS-\d{4}/.exec(text)?.[0];
    if (mentioned && !opts.short) this.currentShort = mentioned;
    const tagged = settings.autopilot && !text.startsWith(AUTOPILOT_TAG) ? `${AUTOPILOT_TAG} ${text}` : text;
    this.put({ kind: 'user', id: uid(), text: display ?? text.replace(AUTOPILOT_TAG, '').trim(), at: Date.now() });
    this.setStatus('working', 'thinking…');
    if (!this.inbox) await this.start();
    this.inbox!.push(tagged);
    return true;
  }

  private async start() {
    const settings = loadSettings();
    const root = resolve(settings.toolkitPath);
    const { query } = await loadSdk();
    this.inbox = new Inbox();
    const resourcesDir = join(app.getAppPath(), 'resources');
    if (this.hasOutdatedSession) {
      this.notice(`${agentMeta(this.id).name} has new instructions, so this is a fresh conversation (older messages stay above).`);
      this.sessionId = undefined;
    }
    const append = instructions(this.id, {
      toolkit: root,
      python: settings.pythonCommand,
      resourcesDir,
      today: new Date().toISOString().slice(0, 10),
    });
    this.q = query({
      prompt: this.inbox,
      options: {
        cwd: root,
        resume: this.sessionId,
        model: ({ editor: settings.editorModel, reviewer: settings.reviewerModel } as Partial<Record<AgentId, string>>)[this.id] ?? settings.scriptWriterModel,
        // a safety cap per job, so a stuck agent can't burn through the plan
        maxTurns: { 'script-writer': 80, editor: 160, reviewer: 50, publisher: 40 }[this.id],
        systemPrompt: { type: 'preset', preset: 'claude_code', append },
        settingSources: [],
        includePartialMessages: true,
        permissionMode: 'default',
        disallowedTools: ['AskUserQuestion', 'Agent', 'Task'],
        pathToClaudeCodeExecutable: claudeExecutable(),
        env: agentEnv({ GEMINI_API_KEY: this.id === 'script-writer' ? getGeminiKey() : undefined, PYTHONIOENCODING: 'utf-8' }),
        canUseTool: async (tool, input) => {
          const d = decide(tool, input, root, this.id);
          if (d.kind === 'allow') return { behavior: 'allow', updatedInput: input };
          if (d.kind === 'deny') {
            this.notice(`Blocked: ${d.why}`, 'warn');
            return { behavior: 'deny', message: d.why };
          }
          if (loadSettings().autopilot) {
            // hands-off: never stop to ask; anything outside the safe list is skipped
            this.notice(`Skipped (autopilot, ${tool} tool): ${d.why}`, 'warn');
            return { behavior: 'deny', message: 'Not allowed in autopilot. Find another way inside the toolkit, or skip this step and note it.' };
          }
          const allowed = await this.askPermission(d.why, describeTool(tool, input, root));
          return allowed
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: 'The user said no. Do something else or ask them.' };
        },
      },
    });
    const q = this.q;
    this.consume(q, root).catch((e) => {
      if (this.q !== q) return; // an old conversation closing after a fresh one started
      this.notice(`The agent stopped: ${(e as Error).message}`, 'error');
      this.reset();
      this.setStatus('error');
    });
  }

  private askPermission(why: string, detail: string): Promise<boolean> {
    const id = uid();
    this.put({ kind: 'permission', id, text: why, detail, at: Date.now(), state: 'pending' });
    this.setStatus('needs-you', 'waiting for your OK');
    return new Promise((res) => {
      this.pendingPermissions.set(id, (allow) => {
        const item = this.history.find((h) => h.id === id);
        if (item && item.kind === 'permission') this.put({ ...item, state: allow ? 'allowed' : 'denied' });
        this.setStatus('working', allow ? 'working…' : 'adjusting…');
        res(allow);
      });
    });
  }

  answerPermission(id: string, allow: boolean) {
    this.pendingPermissions.get(id)?.(allow);
    this.pendingPermissions.delete(id);
  }

  private async consume(q: Query, root: string) {
    for await (const m of q as AsyncIterable<SDKMessage>) {
      if (this.q !== q) return; // replaced by a fresh conversation: ignore the old one
      this.handle(m, root);
    }
    if (this.q !== q) return;
    this.reset();
    if (this.status === 'working') this.setStatus('idle');
  }

  private handle(m: SDKMessage, root: string) {
    switch (m.type) {
      case 'system':
        if ((m as { subtype?: string }).subtype === 'init') this.sessionId = m.session_id;
        return;
      case 'stream_event': {
        const ev = m.event as { type: string; delta?: { type: string; text?: string } };
        if (m.parent_tool_use_id) return;
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
          if (!this.liveTextId) {
            this.liveTextId = uid();
            this.put({ kind: 'agent', id: this.liveTextId, text: '', at: Date.now(), streaming: true });
          }
          const it = this.history.find((h) => h.id === this.liveTextId) as Extract<ChatItem, { kind: 'agent' }>;
          this.put({ ...it, text: it.text + ev.delta.text });
          if (this.status === 'working') this.setStatus('working', 'writing…');
        }
        if (ev.type === 'content_block_stop' && this.liveTextId) {
          const it = this.history.find((h) => h.id === this.liveTextId) as Extract<ChatItem, { kind: 'agent' }>;
          this.put({ ...it, streaming: false });
          this.findMedia(it.text, root);
          this.liveTextId = undefined;
        }
        return;
      }
      case 'assistant': {
        if (m.parent_tool_use_id) return;
        if (m.error === 'rate_limit') {
          this.notice('Your Claude plan limit was reached. The agent will pause until it resets.', 'warn');
        } else if (m.error === 'authentication_failed') {
          this.notice('Claude sign-in failed. Open Settings → Claude account to check your login.', 'error');
        }
        for (const block of m.message.content as { type: string; text?: string; name?: string; input?: Record<string, unknown> }[]) {
          if (block.type === 'tool_use' && block.name) {
            const line = describeTool(block.name, block.input ?? {}, root);
            const short = /RS-\d{4}/.exec(JSON.stringify(block.input ?? {}))?.[0];
            if (short) this.currentShort = short;
            this.put({ kind: 'tool', id: uid(), text: line, at: Date.now() });
            if (this.status === 'working') this.setStatus('working', line.length > 40 ? line.slice(0, 39) + '…' : line);
          } else if (block.type === 'text' && block.text && !this.liveTextId) {
            // Only when streaming was unavailable: the text did not arrive as deltas.
            const already = this.history.slice(-3).some((h) => h.kind === 'agent' && h.text === block.text);
            if (!already) {
              this.put({ kind: 'agent', id: uid(), text: block.text, at: Date.now() });
              this.findMedia(block.text, root);
            }
          }
        }
        return;
      }
      case 'rate_limit_event': {
        const r = m.rate_limit_info;
        this.usage({ status: r.status, utilization: r.utilization, window: r.rateLimitType, resetsAt: r.resetsAt });
        if (r.status === 'rejected') {
          const when = r.resetsAt ? new Date(r.resetsAt * (r.resetsAt < 1e12 ? 1000 : 1)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'later';
          this.notice(`Claude plan limit reached — resets at ${when}.`, 'warn');
        }
        return;
      }
      case 'result': {
        if (m.subtype !== 'success') {
          const errs = (m as { errors?: string[] }).errors;
          const why = m.subtype === 'error_max_turns' ? 'it hit the step limit for one job' : m.subtype;
          this.notice(`That job ended early (${why})${errs?.length ? `: ${errs.join('; ')}` : ''}.`, 'warn');
        }
        if (m.usage) {
          const turn = recordTurn(this.currentShort, this.id, m.usage, m.num_turns ?? 0);
          this.notice(`${this.currentShort ?? 'This job'} · ${describe(turn)}`);
          this.onUsage(this.currentShort);
        }
        this.setStatus('idle');
        setTimeout(() => this.onTurnEnd(this.id), 0);
        return;
      }
      default:
        return;
    }
  }

  /** Turn toolkit audio/video paths the agent mentions into players in the chat. */
  findMedia(text: string, root: string) {
    const seen = new Set(this.history.filter((h) => h.kind === 'media').map((h) => (h as { path: string }).path));
    for (const match of text.matchAll(/[\w./\\-]+\.(mp3|wav|mp4)\b/g)) {
      const rel = match[0].replace(/^\.?[\\/]/, '');
      const full = resolve(root, rel);
      if (inside(root, full) && existsSync(full) && !seen.has(rel)) {
        seen.add(rel);
        this.put({ kind: 'media', id: uid(), path: rel, at: Date.now() });
      }
    }
  }

  async stop() {
    for (const [id] of this.pendingPermissions) this.answerPermission(id, false);
    try { await this.q?.interrupt(); } catch { /* not running */ }
    if (this.status !== 'idle') this.setStatus('idle');
  }

  reset() {
    this.inbox?.close();
    try { this.q?.close(); } catch { /* already closed */ }
    this.inbox = undefined;
    this.q = undefined;
    this.liveTextId = undefined;
  }

  newChat() {
    this.reset();
    this.sessionId = undefined;
    this.history = [];
    this.save();
    this.emit({ agent: this.id, type: 'reset' });
    this.setStatus('idle');
  }
}

export class AgentManager {
  private sessions = new Map<AgentId, AgentSession>();
  constructor(private emit: Emit, private usage: UsageEmit) {
    mkdirSync(store('history'), { recursive: true });
    for (const a of AGENTS) if (a.phase <= LIVE_PHASE) this.sessions.set(a.id, new AgentSession(a.id, emit, usage));
  }
  list(): AgentInfo[] {
    return AGENTS.map((a) => {
      const s = this.sessions.get(a.id);
      if (s?.external && s.status === 'idle') return { ...a, status: 'working' as const, activity: s.external };
      return { ...a, status: s ? s.status : 'offline', activity: s ? s.activity : `arrives in Phase ${a.phase}` };
    });
  }
  history(id: AgentId): ChatItem[] {
    const s = this.sessions.get(id);
    if (s) return s.history;
    const m = agentMeta(id);
    return [{ kind: 'notice', id: 'offline', at: 0, text: `${m.name} the ${m.role} starts work in Phase ${m.phase}. Talk to Scripty at the Script Writer desk for now.` }];
  }
  send(id: AgentId, text: string, display?: string, opts?: { fresh?: boolean; short?: string }) { return this.sessions.get(id)?.send(text, display, opts); }
  isIdle(id: AgentId) { const s = this.sessions.get(id); return !!s && !s.external && (s.status === 'idle' || s.status === 'error'); }
  onTurnEnd(cb: TurnEnd) { for (const s of this.sessions.values()) s.onTurnEnd = cb; }
  onUsage(cb: (short: string | undefined) => void) { for (const s of this.sessions.values()) s.onUsage = cb; }
  /** Post something from the app itself into a desk's chat. */
  post(id: AgentId, item: NewItem) {
    this.sessions.get(id)?.put({ id: uid(), at: Date.now(), ...item } as ChatItem);
  }
  /** Mark a desk busy with app work (rendering); undefined clears it. */
  setExternal(id: AgentId, activity: string | undefined) {
    const s = this.sessions.get(id);
    if (!s) return;
    s.external = activity;
    if (activity) s.setStatus('working', activity);
    else s.setStatus('idle');
  }
  stop(id: AgentId) { return this.sessions.get(id)?.stop(); }
  newChat(id: AgentId) { this.sessions.get(id)?.newChat(); }
  answer(id: AgentId, permId: string, allow: boolean) { this.sessions.get(id)?.answerPermission(permId, allow); }
  closeAll() { for (const s of this.sessions.values()) s.reset(); }
}
