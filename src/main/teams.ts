// Teams: each team is one full line of four desks (Scripty, Cutter, Hawk, Pip) working on its own toolkit repo.
// The main team uses the original settings (toolkitRepo / toolkitPath), so existing installs keep working unchanged.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MAIN_TEAM, type Settings, type TeamConfig, type TeamId } from '../shared/types';
import { loadSettings, saveSettings } from './settings';

export const MAX_TEAMS = 4;

export function listTeams(s: Settings = loadSettings()): TeamConfig[] {
  return [
    { id: MAIN_TEAM, name: s.mainTeamName || 'Team Oopsmith', toolkitRepo: s.toolkitRepo, toolkitPath: s.toolkitPath, profile: s.mainProfile ?? '' },
    ...(s.teams ?? []),
  ];
}

export function getTeam(id: TeamId): TeamConfig | undefined {
  return listTeams().find((t) => t.id === id);
}

/** The app settings as one team sees them: same everything, but that team's toolkit. */
export function settingsFor(team: TeamId): Settings {
  const s = loadSettings();
  if (team === MAIN_TEAM) return s;
  const t = (s.teams ?? []).find((x) => x.id === team);
  return t ? { ...s, toolkitRepo: t.toolkitRepo, toolkitPath: t.toolkitPath } : s;
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'team';

export function addTeam(name: string, repo: string): { ok: boolean; message: string; team?: TeamConfig } {
  const s = loadSettings();
  const teams = s.teams ?? [];
  const n = name.trim();
  const r = repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  if (!n) return { ok: false, message: 'Give the team a name.' };
  if (!r) return { ok: false, message: 'Which GitHub toolkit repo should this team work in? (owner/repo)' };
  if (teams.length + 1 >= MAX_TEAMS) return { ok: false, message: `Up to ${MAX_TEAMS} teams fit in the studio.` };
  const repos = listTeams(s).map((t) => t.toolkitRepo.toLowerCase());
  if (repos.includes(r.toLowerCase())) {
    return { ok: false, message: `Another team already works in ${r}. Each team needs its own toolkit repo so their Shorts never collide.` };
  }
  let id = slug(n);
  while (id === MAIN_TEAM || teams.some((t) => t.id === id)) id = `${id}-${Math.floor(Math.random() * 90 + 10)}`;
  const team: TeamConfig = { id, name: n, toolkitRepo: r, toolkitPath: join(homedir(), 'OopsmithStudio', 'teams', id, r.split('/').pop() || 'toolkit') };
  saveSettings({ teams: [...teams, team] });
  return { ok: true, message: `${n} joined the studio.`, team };
}

export function renameTeam(id: TeamId, name: string): TeamConfig[] {
  const n = name.trim();
  if (!n) return listTeams();
  if (id === MAIN_TEAM) saveSettings({ mainTeamName: n });
  else saveSettings({ teams: (loadSettings().teams ?? []).map((t) => (t.id === id ? { ...t, name: n } : t)) });
  return listTeams();
}

export function setTeamRepo(id: TeamId, repo: string): TeamConfig[] {
  const r = repo.trim();
  if (!r) return listTeams();
  if (id === MAIN_TEAM) saveSettings({ toolkitRepo: r });
  else saveSettings({ teams: (loadSettings().teams ?? []).map((t) => (t.id === id ? { ...t, toolkitRepo: r } : t)) });
  return listTeams();
}

export function setTeamPath(id: TeamId, path: string) {
  if (id === MAIN_TEAM) saveSettings({ toolkitPath: path });
  else saveSettings({ teams: (loadSettings().teams ?? []).map((t) => (t.id === id ? { ...t, toolkitPath: path } : t)) });
}

/** Removes a team from the studio. Its toolkit clone and chats stay on disk. */
export function removeTeam(id: TeamId): { ok: boolean; message: string } {
  if (id === MAIN_TEAM) return { ok: false, message: 'The main team always stays. Remove the other teams to get back to one.' };
  const s = loadSettings();
  const t = (s.teams ?? []).find((x) => x.id === id);
  if (!t) return { ok: false, message: 'That team is already gone.' };
  saveSettings({ teams: s.teams.filter((x) => x.id !== id) });
  return { ok: true, message: `${t.name} left the studio. Their toolkit folder (${t.toolkitPath}) is still on this PC.` };
}
