// Teams: each team is one full line of four desks (Scripty, Cutter, Hawk, Pip). By default every team works in the
// SAME toolkit as the main team, each on its own Shorts (the registry records which team a Short belongs to), so more
// teams = more Shorts in parallel. A team can still be given its own toolkit repo.
// The main team uses the original settings (toolkitRepo / toolkitPath), so existing installs keep working unchanged.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MAIN_TEAM, type Settings, type TeamConfig, type TeamId } from '../shared/types';
import { loadSettings, saveSettings } from './settings';

export const MAX_TEAMS = 4;

export function listTeams(s: Settings = loadSettings()): TeamConfig[] {
  // every extra team gets its own crew (names + outfits); teams from before crews existed get the next free one
  const used = new Set<number>([0]);
  const extra = (s.teams ?? []).map((t) => {
    let crew = t.crew && t.crew > 0 && !used.has(t.crew) ? t.crew : 0;
    if (!crew) { crew = 1; while (used.has(crew)) crew++; }
    used.add(crew);
    return { ...t, crew };
  });
  return [
    { id: MAIN_TEAM, name: s.mainTeamName || 'Team Oopsmith', toolkitRepo: s.toolkitRepo, toolkitPath: s.toolkitPath, profile: s.mainProfile ?? '', crew: 0 },
    ...extra,
  ];
}
/** The crew (names + outfits) of a team. */
export const crewOf = (team: TeamId) => getTeam(team)?.crew ?? 0;

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

const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
/** Teams working in this toolkit folder, in studio order (the first one owns Shorts nobody claimed). */
export function teamsOnToolkit(path: string, all: TeamConfig[] = listTeams()): TeamConfig[] {
  return all.filter((t) => norm(t.toolkitPath) === norm(path));
}
/** Does this team share its toolkit with another team? */
export const sharesToolkit = (team: TeamId) => { const t = getTeam(team); return !!t && teamsOnToolkit(t.toolkitPath).length > 1; };
/** One team per toolkit folder (for jobs that should run once per toolkit: pulling it, reading its registry). */
export function uniqueToolkits(all: TeamConfig[] = listTeams()): TeamConfig[] {
  const seen = new Set<string>();
  return all.filter((t) => { const k = norm(t.toolkitPath); if (seen.has(k)) return false; seen.add(k); return true; });
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'team';

export function addTeam(name: string, repo: string): { ok: boolean; message: string; team?: TeamConfig } {
  const s = loadSettings();
  const teams = s.teams ?? [];
  const n = name.trim();
  // blank = the main team's toolkit (the usual case: every team works in the same toolkit, on different Shorts)
  const r = (repo.trim() || s.toolkitRepo).replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  if (!n) return { ok: false, message: 'Give the team a name.' };
  if (teams.length + 1 >= MAX_TEAMS) return { ok: false, message: `Up to ${MAX_TEAMS} teams fit in the studio.` };
  let id = slug(n);
  while (id === MAIN_TEAM || teams.some((t) => t.id === id)) id = `${id}-${Math.floor(Math.random() * 90 + 10)}`;
  // a repo another team already uses: work in that same folder
  const same = listTeams(s).find((t) => t.toolkitRepo.toLowerCase() === r.toLowerCase());
  const usedCrews = new Set(listTeams(s).map((t) => t.crew ?? 0));
  let crew = 1;
  while (usedCrews.has(crew)) crew++;
  const team: TeamConfig = { id, name: n, crew, toolkitRepo: same?.toolkitRepo ?? r, toolkitPath: same?.toolkitPath ?? join(homedir(), 'OopsmithStudio', 'teams', id, r.split('/').pop() || 'toolkit') };
  saveSettings({ teams: [...teams, team] });
  return { ok: true, message: same ? `${n} joined the studio, working in the same toolkit as ${same.name} on its own Shorts.` : `${n} joined the studio.`, team };
}

export function renameTeam(id: TeamId, name: string): TeamConfig[] {
  const n = name.trim();
  if (!n) return listTeams();
  if (id === MAIN_TEAM) saveSettings({ mainTeamName: n });
  else saveSettings({ teams: (loadSettings().teams ?? []).map((t) => (t.id === id ? { ...t, name: n } : t)) });
  return listTeams();
}

export function setTeamRepo(id: TeamId, repo: string): TeamConfig[] {
  const s = loadSettings();
  // blank on an extra team = back to the main team's toolkit
  const r = (repo.trim() || (id === MAIN_TEAM ? '' : s.toolkitRepo)).replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
  if (!r) return listTeams();
  if (id === MAIN_TEAM) { saveSettings({ toolkitRepo: r }); return listTeams(); }
  const same = listTeams(s).find((t) => t.id !== id && t.toolkitRepo.toLowerCase() === r.toLowerCase());
  saveSettings({
    teams: (s.teams ?? []).map((t) => {
      if (t.id !== id) return t;
      if (same) return { ...t, toolkitRepo: same.toolkitRepo, toolkitPath: same.toolkitPath };   // share that folder
      const own = norm(t.toolkitPath) === norm(s.toolkitPath) || listTeams(s).some((o) => o.id !== id && norm(o.toolkitPath) === norm(t.toolkitPath));
      return { ...t, toolkitRepo: r, toolkitPath: own ? join(homedir(), 'OopsmithStudio', 'teams', id, r.split('/').pop() || 'toolkit') : t.toolkitPath };
    }),
  });
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
