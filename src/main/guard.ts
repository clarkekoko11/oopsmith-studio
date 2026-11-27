// The budget guard: keeps the Claude plan from running dry in the middle of a Short.
// - Above the guard level (default 80% of an account's current window) only the first team on that account starts new
//   jobs, so it can finish; the other teams on it wait (renders and filing go on, they don't use Claude).
// - When the limit is reached, every team on that account waits until the reset time, then picks up again by itself.
import { app } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TeamConfig, TeamId, UsageState } from '../shared/types';
import { profileName, teamProfile } from './profiles';
import { loadSettings } from './settings';

interface P { utilization?: number; status?: UsageState['status']; resetsAt?: number; seen: number; window?: string }
const file = () => join(app.getPath('userData'), 'guard.json');
let loaded: Record<string, P> | null = null;
const st = (): Record<string, P> => {
  if (!loaded) { try { loaded = JSON.parse(readFileSync(file(), 'utf8')); } catch { loaded = {}; } }
  return loaded!;
};
const persist = () => { try { writeFileSync(file(), JSON.stringify(st())); } catch { /* best effort */ } };

/** resetsAt arrives in seconds or milliseconds */
export const resetMs = (r?: number) => (r ? (r < 1e12 ? r * 1000 : r) : undefined);
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function recordUsage(u: UsageState) {
  const k = u.profile ?? '';
  st()[k] = { utilization: u.utilization, status: u.status, resetsAt: resetMs(u.resetsAt), seen: Date.now(), window: u.window };
  persist();
}

/** Usage that's still meaningful (a window that has reset, or an old reading, no longer counts). */
function current(profile: string): P | null {
  const p = st()[profile];
  if (!p) return null;
  const now = Date.now();
  if (p.resetsAt && now > p.resetsAt) return null;
  if (!p.resetsAt && now - p.seen > 60 * 60_000) return null;
  return p;
}

export function lastUsage(profile: string): UsageState | null {
  const p = current(profile);
  return p ? { profile, status: p.status, utilization: p.utilization, resetsAt: p.resetsAt, window: p.window } : null;
}

/** null = this team may start new Claude jobs. */
export function pausedReason(team: TeamId, teams: TeamConfig[]): string | null {
  const prof = teamProfile(team);
  const p = current(prof);
  if (!p) return null;
  const who = prof ? ` (${profileName(prof)})` : '';
  const resume = p.resetsAt ? `at ${clock(p.resetsAt)}` : 'when it resets';
  if (p.status === 'rejected') return `the Claude plan limit was reached${who}. Work picks up by itself ${resume}.`;
  const guard = loadSettings().budgetGuard;
  if (!guard || p.utilization === undefined || p.utilization < guard) return null;
  const same = teams.filter((t) => teamProfile(t.id) === prof);
  if (same[0]?.id === team) return null;
  return `the Claude plan is at ${Math.round(p.utilization * 100)}%${who}, so ${same[0]?.name ?? 'the first team'} gets to finish first. This team carries on ${resume}.`;
}

/** Accounts whose limit resets later: [profile, ms]. */
export function pendingResets(): [string, number][] {
  return Object.entries(st()).filter(([, p]) => p.resetsAt && p.resetsAt > Date.now() && (p.status === 'rejected' || (p.utilization ?? 0) >= (loadSettings().budgetGuard || 2))).map(([k, p]) => [k, p.resetsAt!]);
}
