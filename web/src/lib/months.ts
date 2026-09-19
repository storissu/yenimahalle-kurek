// Calendar months in CLUB time (Europe/Istanbul). A month is identified by a key "YYYY-MM".
// The leaderboard "resets" because statistics are bucketed by these months, not by a job.
import { instantToWallTime, todayInClubZone } from './time';

export type MonthKey = string;

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isMonthKey = (value: string): value is MonthKey => MONTH_RE.test(value);

/** The month that contains `now` in club time. */
export const currentMonthKey = (now: Date = new Date()): MonthKey => todayInClubZone(now).slice(0, 7);

/** The month a moment belongs to in club time (a session at 23:30 on the 31st is still that month). */
export const monthKeyOf = (instant: Date | string): MonthKey => instantToWallTime(instant).date.slice(0, 7);

/** "2026-09" + 1 → "2026-10"; crosses year boundaries. */
export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const match = MONTH_RE.exec(key);
  if (!match) throw new Error(`Invalid month key: ${key}`);
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta;
  const year = Math.floor(index / 12);
  return `${year}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The date sent to the database ("2026-09-01"); the SQL functions turn it into the club-time month. */
export const monthStartDate = (key: MonthKey): string => `${key}-01`;

const labelFmt = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "Eylül 2026" */
export function monthLabel(key: MonthKey): string {
  const match = MONTH_RE.exec(key);
  if (!match) return key;
  return labelFmt.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
}

/** Month keys compare correctly as strings. */
export const isFutureMonth = (key: MonthKey, now: Date = new Date()): boolean => key > currentMonthKey(now);
