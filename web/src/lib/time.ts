// The club lives in Turkey: every date/time shown or bucketed (deadlines, months, leaderboard)
// uses this zone, never the device's own zone. Instants are stored as UTC timestamptz.
export const CLUB_TIME_ZONE = 'Europe/Istanbul';
export const CLUB_LOCALE = 'tr-TR';

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(CLUB_LOCALE, { timeZone: CLUB_TIME_ZONE, ...options });
}

const dateFmt = formatter({ day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
const shortDateFmt = formatter({ day: 'numeric', month: 'short' });
const dayMonthFmt = formatter({ day: 'numeric', month: 'long', weekday: 'long' });
const timeFmt = formatter({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const formatDate = (d: Date | string): string => dateFmt.format(new Date(d));
export const formatShortDate = (d: Date | string): string => shortDateFmt.format(new Date(d));
/** "19 Eylül Cumartesi" — the year is omitted for compact lists. */
export const formatDayMonth = (d: Date | string): string => dayMonthFmt.format(new Date(d));
export const formatTime = (d: Date | string): string => timeFmt.format(new Date(d));
export const formatDateTime = (d: Date | string): string => `${formatDate(d)} ${formatTime(d)}`;

export const HOUR_MS = 60 * 60 * 1000;

// --- wall-clock <-> instant conversion (club zone) --------------------------------------------
// Form inputs give "2026-09-19" + "08:00" meaning *Istanbul* wall time; the database wants an
// instant. Done with Intl only (no date library), and correct even if the zone had DST.

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: CLUB_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function wallParts(at: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const p: Record<string, number> = {};
  for (const part of partsFmt.formatToParts(at)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { year: p.year ?? 0, month: p.month ?? 0, day: p.day ?? 0, hour: p.hour ?? 0, minute: p.minute ?? 0, second: p.second ?? 0 };
}

/** Offset of the club zone from UTC at a given instant, in minutes (Istanbul: +180). */
function zoneOffsetMinutes(at: Date): number {
  const w = wallParts(at);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

/** "2026-09-19" + "08:00" (club wall time) → the UTC instant. Returns an Invalid Date for bad input. */
export function wallTimeToInstant(date: string, time: string): Date {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) return new Date(NaN);
  const [year, month, day, hour, minute] = [d[1], d[2], d[3], t[1], t[2]].map(Number) as [number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return new Date(NaN);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(guess).getUTCDate() !== day) return new Date(NaN); // e.g. 31 February
  const first = guess - zoneOffsetMinutes(new Date(guess)) * 60_000;
  const second = guess - zoneOffsetMinutes(new Date(first)) * 60_000; // settles across a DST change
  return new Date(second);
}

/** A UTC instant → club wall-clock parts as form-input strings. */
export function instantToWallTime(instant: Date | string): { date: string; time: string } {
  const w = wallParts(new Date(instant));
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${w.year}-${pad(w.month)}-${pad(w.day)}`, time: `${pad(w.hour)}:${pad(w.minute)}` };
}

/** The calendar day before a "YYYY-MM-DD" date ("2026-03-01" → "2026-02-28"); empty string for bad input. */
export function previousCalendarDay(date: string): string {
  if (Number.isNaN(wallTimeToInstant(date, '00:00').getTime())) return '';
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const prev = new Date(Date.UTC(year, month - 1, day - 1));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${prev.getUTCFullYear()}-${pad(prev.getUTCMonth() + 1)}-${pad(prev.getUTCDate())}`;
}

/** Today's date in the club zone as "YYYY-MM-DD" (for <input type="date" min>). */
export const todayInClubZone = (now: Date = new Date()): string => instantToWallTime(now).date;
