// The weekly plan for uploading Shorts yourself: every Short that's ready to post gets the next free upload day
// (one a day, only on your posting days; how many days = the weekly quota) and is moved into that week's folder:
//
//   Oopsmith weeks/
//     Week 01 (Nov 30 - Dec 6)/
//       2026-12-01 Tue - RS-0012 - Why This Jet Ran Out of Fuel.mp4
//       2026-12-01 Tue - RS-0012 - Why This Jet Ran Out of Fuel.txt   <- title, description, tags, when to post
//
// Posted Shorts get " (posted)" added to their names, so the folder shows at a glance what's left to upload.
import { app } from 'electron';
import { copyFile, rename, unlink } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { PlanEntry, PlanState, Settings, TeamId, WeekSummary } from '../shared/types';
import { outputDir } from './render';
import { addDays, dayKey, daysBetween, describeSlot, mondayOf, nextSlot, weekdayOf } from './schedule';
import { loadSettings, saveSettings } from './settings';

interface Store { entries: Record<string, PlanEntry> }
const file = () => join(app.getPath('userData'), 'plan.json');
const keyOf = (team: TeamId, id: string) => `${team}:${id}`;

function load(): Store {
  try { return JSON.parse(readFileSync(file(), 'utf8')) as Store; } catch { return { entries: {} }; }
}
function save(s: Store) {
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(s, null, 1));
}

export const planEntry = (team: TeamId, id: string): PlanEntry | null => load().entries[keyOf(team, id)] ?? null;
export const allEntries = (): PlanEntry[] => Object.values(load().entries);

/** Where finished videos are rendered (the main team's worker folder, which the app keeps in step with Settings). */
export function renderRoot(s: Settings = loadSettings()): string {
  return s.renderDir || outputDir(s.toolkitPath);
}
/** Where the Week folders go. */
export function weeksRoot(s: Settings = loadSettings()): string {
  if (s.weeksDir) return s.weeksDir.replace(/^~(?=$|[\\/])/, homedir());
  return join(dirname(renderRoot(s)), 'Oopsmith weeks');
}

const pad = (n: number) => String(n).padStart(2, '0');
const md = (day: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));
const ddd = (day: string) => weekdayOf(day)[0].toUpperCase() + weekdayOf(day).slice(1);
/** Windows-safe file name part */
const safe = (t: string) => t.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 70) || 'Short';

export function weekStart(s: Settings, week: number) { return addDays(s.weekOneStart, (week - 1) * 7); }
export function weekOf(s: Settings, day: string) { return Math.floor(daysBetween(s.weekOneStart, day) / 7) + 1; }
export function weekFolder(s: Settings, week: number) {
  const a = weekStart(s, week);
  return join(weeksRoot(s), `Week ${pad(week)} (${md(a)} - ${md(addDays(a, 6))})`);
}
const baseName = (e: Pick<PlanEntry, 'day' | 'id' | 'title' | 'posted'>) => `${e.day} ${ddd(e.day)} - ${e.id} - ${safe(e.title)}${e.posted ? ' (posted)' : ''}`;

/** Move a file, across drives too. A file that can't be removed afterwards (e.g. still open) stays behind. */
async function move(from: string, to: string) {
  if (from === to) return;
  try {
    await rename(from, to);
  } catch {
    await copyFile(from, to);
    try { await unlink(from); } catch { /* still in use: it's only a leftover copy */ }
  }
}

function detailsText(e: PlanEntry, s: Settings, meta: { title?: string; alt_titles?: string[]; description?: string; tags?: string[] } | null): string {
  const lines = [
    meta?.title || e.title,
    '',
    `Post on: ${describeSlot(Date.parse(e.at), s.audienceTimezone)}`,
    `Short: ${e.id} v${e.version}  ·  Week ${e.week}`,
    '',
  ];
  if (meta?.alt_titles?.length) lines.push('Other titles:', ...meta.alt_titles.map((t) => `- ${t}`), '');
  if (meta?.description) lines.push('Description:', meta.description.replace(/\\n/g, '\n'), '');
  if (meta?.tags?.length) lines.push('Tags (YouTube Studio > Show more > Tags):', meta.tags.join(', '), '');
  lines.push('When it is up, press "Mark as posted" for this Short on the review screen in Oopsmith Studio.');
  return lines.join('\r\n');
}

/**
 * File a Short that's ready to post: give it an upload day (keeps the one it has) and move its render into that
 * week's folder with a details file. `takenDays` are days already used by Shorts posted another way.
 */
export async function fileShort(
  team: TeamId,
  r: { id: string; title: string; version: number; file: string; toolkit: string },
  takenDays: Set<string>,
): Promise<{ ok: boolean; message: string; entry?: PlanEntry; fresh?: boolean }> {
  let s = loadSettings();
  const store = load();
  const k = keyOf(team, r.id);
  const prev = store.entries[k];
  const src = join(outputDir(r.toolkit), r.file);
  if (prev && prev.version === r.version && prev.video && existsSync(prev.video)) return { ok: true, message: 'already filed', entry: prev };
  if (!existsSync(src)) {
    if (prev?.video && existsSync(prev.video)) return { ok: true, message: 'already filed', entry: prev };
    return { ok: false, message: `${r.id}'s video (${r.file}) isn't in the render folder.` };
  }
  let day = prev?.day, at = prev?.at;
  if (!day || !at) {
    const taken = new Set([...takenDays, ...Object.values(store.entries).map((e) => e.day)]);
    const t = nextSlot(s.audienceTimezone, s.postingTimes, taken, Date.now(), 0, s.postingDays);
    day = dayKey(t, s.audienceTimezone);
    at = new Date(t).toISOString();
  }
  if (!s.weekOneStart) s = saveSettings({ weekOneStart: mondayOf(day) });
  const week = weekOf(s, day);
  const entry: PlanEntry = { ...(prev ?? {}), team, id: r.id, title: r.title, day, at, week, version: r.version, source: r.file, posted: prev?.posted ?? false };
  const folder = weekFolder(s, week);
  mkdirSync(folder, { recursive: true });
  const base = join(folder, baseName(entry));
  // an older version filed before (changes were made after): replace it
  if (prev?.video && prev.video !== `${base}.mp4` && existsSync(prev.video)) { try { await unlink(prev.video); } catch { /* in use */ } }
  if (prev?.details && prev.details !== `${base}.txt` && existsSync(prev.details)) { try { await unlink(prev.details); } catch { /* in use */ } }
  await move(src, `${base}.mp4`);
  let meta = null;
  try { meta = JSON.parse(readFileSync(join(r.toolkit, 'shorts', r.id, 'publish.json'), 'utf8')); } catch { /* none yet */ }
  writeFileSync(`${base}.txt`, detailsText(entry, s, meta));
  entry.video = `${base}.mp4`;
  entry.details = `${base}.txt`;
  store.entries[k] = entry;
  save(store);
  return { ok: true, message: `Filed in Week ${week} for ${describeSlot(Date.parse(at), s.audienceTimezone)}.`, entry, fresh: !prev };
}

/** Posted (or not after all): rename its files so the week folder shows what's left. */
export async function setPosted(team: TeamId, id: string, posted: boolean): Promise<PlanEntry | null> {
  const store = load();
  const e = store.entries[keyOf(team, id)];
  if (!e || e.posted === posted) return e ?? null;
  e.posted = posted;
  const s = loadSettings();
  const base = join(weekFolder(s, e.week), baseName(e));
  try {
    if (e.video && existsSync(e.video)) { await move(e.video, `${base}.mp4`); e.video = `${base}.mp4`; }
    if (e.details && existsSync(e.details)) { await move(e.details, `${base}.txt`); e.details = `${base}.txt`; }
  } catch { /* renamed next time */ }
  save(store);
  return e;
}

/** A Short that left the plan (e.g. removed): forget it, files stay. */
export function forget(team: TeamId, id: string) {
  const store = load();
  delete store.entries[keyOf(team, id)];
  save(store);
}

/** The filed video for a render file name, for the review screen and the office TVs. */
export function filedVideo(team: TeamId, renderFile: string): string | null {
  const name = basename(renderFile);
  const e = Object.values(load().entries).find((x) => x.team === team && x.source === name);
  return e?.video && existsSync(e.video) ? e.video : null;
}

/** Upload-day reminders that are due now (each only once). */
export function dueReminders(now = Date.now()): PlanEntry[] {
  const s = loadSettings();
  if (!s.remindMinutes) return [];
  const store = load();
  const due = Object.values(store.entries).filter((e) => !e.posted && !e.reminded && Date.parse(e.at) - s.remindMinutes * 60_000 <= now && now < Date.parse(e.at) + 6 * 3600_000);
  for (const e of due) e.reminded = true;
  if (due.length) save(store);
  return due;
}

/** Days already taken in the plan (for other publishing modes, so the two never double-book a day). */
export const plannedDays = () => new Set(Object.values(load().entries).map((e) => e.day));

/** The weeks from the first filed one to the one after today. */
export function planState(inProduction: number): PlanState {
  const s = loadSettings();
  const quota = s.postingDays.length;
  const entries = Object.values(load().entries).sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  const today = dayKey(Date.now(), s.audienceTimezone);
  if (!s.weekOneStart) return { quota, weekOneStart: '', weeksDir: weeksRoot(s), current: 1, weeks: [], inProduction };
  const current = Math.max(1, weekOf(s, today));
  const last = Math.max(current, ...entries.map((e) => weekOf(s, e.day)));
  const first = Math.max(1, Math.min(current, ...entries.map((e) => weekOf(s, e.day))));
  const weeks: WeekSummary[] = [];
  for (let w = first; w <= last; w++) {
    const start = weekStart(s, w);
    weeks.push({ week: w, start, end: addDays(start, 6), folder: weekFolder(s, w), quota, entries: entries.filter((e) => weekOf(s, e.day) === w).map((e) => ({ ...e, week: w })) });
  }
  return { quota, weekOneStart: s.weekOneStart, weeksDir: weeksRoot(s), current, weeks, inProduction };
}
