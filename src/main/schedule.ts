// One Short per day, each at the best time for that weekday in the audience's time zone.
// Default times blend Buffer's 2026 study of 1.8M videos and SocialPilot's 2026 study of 301k videos
// (Shorts do best in the late afternoon/evening; Friday strongest; avoid 3-7 AM and late Sunday).

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Day = (typeof DAYS)[number];

export const RESEARCHED_TIMES: Record<Day, string> = {
  mon: '18:00',
  tue: '19:00',
  wed: '18:00',
  thu: '19:00',
  fri: '16:00',
  sat: '18:00',
  sun: '17:00',
};

function parts(t: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(t))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, wd: p.weekday.toLowerCase().slice(0, 3) as Day };
}

/** Milliseconds the zone is ahead of UTC at instant t. */
function offset(t: number, tz: string) {
  const p = parts(t, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(t / 1000) * 1000;
}

/** The instant when it is y-m-d hh:mm in that zone (handles daylight saving). */
export function zoned(y: number, m: number, d: number, h: number, min: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - offset(guess, tz);
  t = guess - offset(t, tz);
  return t;
}

/** "2026-11-27" for an instant, in that zone. */
export function dayKey(t: number, tz: string) {
  const p = parts(t, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/**
 * The next free daily slot: the earliest day (today included, if its time is at least `leadMinutes` away)
 * that has no other Short scheduled, at that weekday's time.
 */
export function nextSlot(tz: string, times: Partial<Record<Day, string>>, takenDays: Set<string>, now = Date.now(), leadMinutes = 90): number {
  const today = parts(now, tz);
  for (let k = 0; k < 60; k++) {
    // noon of day k, to step calendar days safely across DST changes
    const noon = zoned(today.y, today.m, today.d + k, 12, 0, tz);
    const p = parts(noon, tz);
    const [hh, mm] = (times[p.wd] ?? RESEARCHED_TIMES[p.wd]).split(':').map(Number);
    const at = zoned(p.y, p.m, p.d, hh, mm || 0, tz);
    if (at < now + leadMinutes * 60_000) continue;
    if (takenDays.has(dayKey(at, tz))) continue;
    return at;
  }
  throw new Error('No free day in the next 60 days');
}

/** "Fri 27 Nov, 4:00 PM (New York) · Sat 5:00 AM your time" */
export function describeSlot(t: number, tz: string): string {
  const there = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  const here = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  const city = tz.split('/').pop()!.replace(/_/g, ' ');
  return `${there} (${city} time) · ${here} your time`;
}
