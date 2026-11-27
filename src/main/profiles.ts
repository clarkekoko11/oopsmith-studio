// Extra Claude accounts. Each one is its own Claude Code login folder on this PC (CLAUDE_CONFIG_DIR), so a team can
// run on a different Claude plan than the others: every account has its own usage limit. '' is the PC's normal login.
import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MAIN_TEAM, type ProfileConfig, type TeamId } from '../shared/types';
import { loadSettings, saveSettings } from './settings';

export const DEFAULT_PROFILE = '';

export function profileDir(id: string): string | undefined {
  if (!id) return undefined;
  const d = join(app.getPath('userData'), 'claude-accounts', id);
  mkdirSync(d, { recursive: true });
  return d;
}

/** Extra environment for Claude Code processes on this account. */
export function profileEnv(id: string): Record<string, string | undefined> {
  const d = profileDir(id);
  return d ? { CLAUDE_CONFIG_DIR: d } : {};
}

export function listProfiles(): ProfileConfig[] {
  return [{ id: DEFAULT_PROFILE, name: 'This PC’s Claude login' }, ...(loadSettings().profiles ?? [])];
}

export function profileName(id: string) {
  return listProfiles().find((p) => p.id === id)?.name ?? 'Claude account';
}

/** Which account a team runs on (an account that was removed falls back to the default). */
export function teamProfile(team: TeamId): string {
  const s = loadSettings();
  const id = team === MAIN_TEAM ? s.mainProfile : (s.teams ?? []).find((t) => t.id === team)?.profile ?? '';
  return id && (s.profiles ?? []).some((p) => p.id === id) ? id : DEFAULT_PROFILE;
}

export function addProfile(name: string): { ok: boolean; message: string; profile?: ProfileConfig } {
  const n = name.trim();
  if (!n) return { ok: false, message: 'Give the account a name (e.g. its email).' };
  const s = loadSettings();
  if ((s.profiles ?? []).length >= 4) return { ok: false, message: 'Up to 4 extra accounts.' };
  let id = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'account';
  while ((s.profiles ?? []).some((p) => p.id === id)) id = `${id}-${Math.floor(Math.random() * 90 + 10)}`;
  const profile = { id, name: n };
  saveSettings({ profiles: [...(s.profiles ?? []), profile] });
  return { ok: true, message: `Added ${n}. Press Sign in next to it and type /login in the terminal.`, profile };
}

export function removeProfile(id: string): { ok: boolean; message: string } {
  const s = loadSettings();
  if (!id) return { ok: false, message: "This PC's login always stays." };
  const users = [...(s.mainProfile === id ? [s.mainTeamName] : []), ...(s.teams ?? []).filter((t) => t.profile === id).map((t) => t.name)];
  if (users.length) return { ok: false, message: `${users.join(', ')} still ${users.length === 1 ? 'runs' : 'run'} on this account. Switch ${users.length === 1 ? 'it' : 'them'} first (Teams).` };
  saveSettings({ profiles: (s.profiles ?? []).filter((p) => p.id !== id) });
  return { ok: true, message: 'Removed. Its login folder stays on this PC until you delete it.' };
}

export function setTeamProfile(team: TeamId, profile: string) {
  if (team === MAIN_TEAM) saveSettings({ mainProfile: profile });
  else saveSettings({ teams: (loadSettings().teams ?? []).map((t) => (t.id === team ? { ...t, profile } : t)) });
}
