// Runs each agent as a long-lived Claude Agent SDK session and turns its messages into chat items.
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SDKUserMessage, SDKMessage, Query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, AgentId, AgentInfo, AgentStatus, ChatItem, UsageState } from '../shared/types';
import { AGENTS, agentMeta, instructions } from './agentDefs';
import { decide, describeTool, inside } from './permissions';
import { agentEnv, claudeExecutable, loadSdk } from './sdk';
import { getGeminiKey, loadSettings } from './settings';

type Emit = (e: AgentEvent) => void;
type UsageEmit = (u: UsageState) => void;

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

  private get sessionId(): string | undefined {
    try {
      return JSON.parse(readFileSync(store('sessions.json'), 'utf8'))[this.id];
    } catch {
      return undefined;
    }
  }
  private set sessionId(v: string | undefined) {
    let all: Record<string, string> = {};
    try { all = JSON.parse(readFileSync(store('sessions.json'), 'utf8')); } catch { /* none */ }
    if (v) all[this.id] = v; else delete all[this.id];
    writeFileSync(store('sessions.json'), JSON.stringify(all, null, 2));
  }

  private put(item: ChatItem) {
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
  private setStatus(status: AgentStatus, activity?: string) {
    this.status = status;
    this.activity = activity;
    this.emit({ agent: this.id, type: 'status', status, activity });
  }
  notice(text: string, tone: 'info' | 'warn' | 'error' = 'info') {
    this.put({ kind: 'notice', id: uid(), text, tone, at: Date.now() });
  }

  async send(text: string) {
    const settings = loadSettings();
    if (!settings.toolkitPath || !existsSync(settings.toolkitPath)) {
      this.notice("The toolkit isn't on this PC yet. Open Settings → Toolkit → Clone / update.", 'warn');
      return;
    }
    this.put({ kind: 'user', id: uid(), text, at: Date.now() });
    this.setStatus('working', 'thinking…');
    if (!this.inbox) await this.start();
    this.inbox!.push(text);
  }

  private async start() {
    const settings = loadSettings();
    const root = resolve(settings.toolkitPath);
    const { query } = await loadSdk();
    this.inbox = new Inbox();
    const resourcesDir = join(app.getAppPath(), 'resources');
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
        model: settings.scriptWriterModel || undefined,
        systemPrompt: { type: 'preset', preset: 'claude_code', append },
        settingSources: [],
        includePartialMessages: true,
        permissionMode: 'default',
        disallowedTools: ['AskUserQuestion', 'Agent', 'Task'],
        pathToClaudeCodeExecutable: claudeExecutable(),
        env: agentEnv({ GEMINI_API_KEY: getGeminiKey(), PYTHONIOENCODING: 'utf-8' }),
        canUseTool: async (tool, input) => {
          const d = decide(tool, input, root);
          if (d.kind === 'allow') return { behavior: 'allow', updatedInput: input };
          if (d.kind === 'deny') {
            this.notice(`Blocked: ${d.why}`, 'warn');
            return { behavior: 'deny', message: d.why };
          }
          const allowed = await this.askPermission(d.why, describeTool(tool, input, root));
          return allowed
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: 'The user said no. Do something else or ask them.' };
        },
      },
    });
    this.consume(this.q, root).catch((e) => {
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
    for await (const m of q as AsyncIterable<SDKMessage>) this.handle(m, root);
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
          this.notice(`That turn ended early (${m.subtype})${errs?.length ? `: ${errs.join('; ')}` : ''}.`, 'warn');
        }
        this.setStatus('idle');
        return;
      }
      default:
        return;
    }
  }

  /** Turn toolkit audio/video paths the agent mentions into players in the chat. */
  private findMedia(text: string, root: string) {
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
    for (const a of AGENTS) if (a.phase === 1) this.sessions.set(a.id, new AgentSession(a.id, emit, usage));
  }
  list(): AgentInfo[] {
    return AGENTS.map((a) => {
      const s = this.sessions.get(a.id);
      return { ...a, status: s ? s.status : 'offline', activity: s ? s.activity : `arrives in Phase ${a.phase}` };
    });
  }
  history(id: AgentId): ChatItem[] {
    const s = this.sessions.get(id);
    if (s) return s.history;
    const m = agentMeta(id);
    return [{ kind: 'notice', id: 'offline', at: 0, text: `${m.name} the ${m.role} starts work in Phase ${m.phase}. Talk to Scripty at the Script Writer desk for now.` }];
  }
  send(id: AgentId, text: string) { return this.sessions.get(id)?.send(text); }
  stop(id: AgentId) { return this.sessions.get(id)?.stop(); }
  newChat(id: AgentId) { this.sessions.get(id)?.newChat(); }
  answer(id: AgentId, permId: string, allow: boolean) { this.sessions.get(id)?.answerPermission(permId, allow); }
  closeAll() { for (const s of this.sessions.values()) s.reset(); }
}
