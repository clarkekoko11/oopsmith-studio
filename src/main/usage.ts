// Token counts per Short and per desk, saved in the app's data folder (usage.json).
import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentId, ShortUsage, TokenCount } from '../shared/types';

const file = () => join(app.getPath('userData'), 'usage.json');
type Store = Record<string, ShortUsage>; // key: RS-0003, or "other" for work not tied to a Short

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
export function recordTurn(short: string | undefined, agent: AgentId, u: TurnUsage, steps: number): TokenCount {
  const s = load();
  const key = short ?? 'other';
  const entry = (s[key] ??= { total: empty(), byAgent: {} });
  const turn: TokenCount = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    steps,
    jobs: 1,
  };
  const add = (t: TokenCount) => {
    t.input += turn.input;
    t.output += turn.output;
    t.cacheRead += turn.cacheRead;
    t.cacheWrite += turn.cacheWrite;
    t.steps += turn.steps;
    t.jobs += 1;
  };
  add(entry.total);
  add((entry.byAgent[agent] ??= empty()));
  entry.updated = Date.now();
  writeFileSync(file(), JSON.stringify(s, null, 2));
  return turn;
}

export function allUsage(): Store {
  return load();
}

export const totalTokens = (t: TokenCount) => t.input + t.output + t.cacheRead + t.cacheWrite;

/** "1.42M tokens (38k out · 1.21M cached)" */
export function describe(t: TokenCount): string {
  const f = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
  return `${f(totalTokens(t))} tokens (${f(t.output)} written · ${f(t.cacheRead)} re-read from cache · ${t.steps} steps)`;
}
