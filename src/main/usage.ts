// Token counts per Short and per desk, saved in the app's data folder (usage.json).
import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAIN_TEAM, type AgentId, type ShortUsage, type TeamId, type TokenCount } from '../shared/types';

const file = () => join(app.getPath('userData'), 'usage.json');
type Store = Record<string, ShortUsage>; // key: RS-0003 (main team) or team:RS-0003, or "other" for work not tied to a Short

/** Teams each have their own toolkit, so their Short IDs can repeat: other teams' keys carry a prefix. */
const keyOf = (team: TeamId, short: string) => (team === MAIN_TEAM ? short : `${team}:${short}`);

function load(): Store {
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as Store;
  } catch {
    return {};
  }
}

const empty = (): TokenCount => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, steps: 0, jobs: 0 });

export interface TurnUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Add one finished turn's tokens to a Short; returns that turn's count. */
export function recordTurn(team: TeamId, short: string | undefined, agent: AgentId, u: TurnUsage, steps: number, ms = 0): TokenCount {
  const s = load();
  const key = keyOf(team, short ?? 'other');
  const entry = (s[key] ??= { total: empty(), byAgent: {} });
  entry.startedAt ??= Date.now() - ms;
  const turn: TokenCount = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    steps,
    jobs: 1,
    ms,
  };
  const add = (t: TokenCount) => {
    t.input += turn.input;
    t.output += turn.output;
    t.cacheRead += turn.cacheRead;
    t.cacheWrite += turn.cacheWrite;
    t.steps += turn.steps;
    t.jobs += 1;
    t.ms = (t.ms ?? 0) + ms;
  };
  add(entry.total);
  add((entry.byAgent[agent] ??= empty()));
  entry.updated = Date.now();
  writeFileSync(file(), JSON.stringify(s, null, 2));
  return turn;
}

/** Time the graphics card spent rendering a Short (added up over every version). */
export function recordRender(team: TeamId, short: string, ms: number) {
  const s = load();
  const entry = (s[keyOf(team, short)] ??= { total: empty(), byAgent: {} });
  entry.startedAt ??= Date.now() - ms;
  entry.renderMs = (entry.renderMs ?? 0) + ms;
  entry.updated = Date.now();
  writeFileSync(file(), JSON.stringify(s, null, 2));
}

/** Finished (ready to post) or back in the works (done = false): sets or clears the finish time. */
export function markDone(team: TeamId, short: string, done: boolean) {
  const s = load();
  const entry = s[keyOf(team, short)];
  if (!entry || Boolean(entry.doneAt) === done) return;
  if (done) entry.doneAt = Date.now(); else delete entry.doneAt;
  writeFileSync(file(), JSON.stringify(s, null, 2));
}

/** Start to finish (or to now, while it's still being made). */
export const madeMs = (u: ShortUsage | undefined): number | undefined => (u?.startedAt ? (u.doneAt ?? Date.now()) - u.startedAt : undefined);

/** "3 h 20 min", "12 min", "40 s" */
export function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return r ? `${h} h ${r} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d ${h % 24} h`;
}

/** Usage for one team's Shorts, keyed by Short ID. */
export function allUsage(team: TeamId = MAIN_TEAM): Store {
  const all = load();
  if (team === MAIN_TEAM) return Object.fromEntries(Object.entries(all).filter(([k]) => !k.includes(':')));
  const p = `${team}:`;
  return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(p)).map(([k, v]) => [k.slice(p.length), v]));
}

export const totalTokens = (t: TokenCount) => t.input + t.output + t.cacheRead + t.cacheWrite;

/** "1.42M tokens (38k out · 1.21M cached)" */
export function describe(t: TokenCount): string {
  const f = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  return `${f(totalTokens(t))} tokens (${f(t.output)} written · ${f(t.cacheRead)} re-read from cache · ${t.steps} steps)${t.ms ? ` · ${fmtDuration(t.ms)}` : ''}`;
}
