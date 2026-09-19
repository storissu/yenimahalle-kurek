// Presentation rules for the monthly leaderboard. The database ranks (ties share a place); this
// only orders equal ranks the Turkish way and describes a member's own position in words.
import type { MonthRow, MyMonthStatsRow } from '@/types/database';

/** Best first; members with the same rank are ordered by name using Turkish collation. */
export function sortBoard<T extends Pick<MonthRow, 'rank' | 'full_name' | 'sessions'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || b.sessions - a.sessions || a.full_name.localeCompare(b.full_name, 'tr'));
}

/** True when another member shares this member's rank (shown as "3. (eşit)"). */
export function isTied(rows: Array<Pick<MonthRow, 'rank'>>, rank: number | null): boolean {
  return rank !== null && rows.filter((r) => r.rank === rank).length > 1;
}

/** "3. sıra · 12 kişi arasında", or an encouraging line when there is nothing yet. */
export function myPositionText(stats: MyMonthStatsRow | undefined): string {
  if (!stats || stats.rank === null) return 'Bu ay henüz seansınız yok';
  return `${stats.rank}. sıra · ${stats.participants} kişi arasında`;
}
