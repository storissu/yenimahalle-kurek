// Presentation rules for "birlikte kürek çektiğiniz seanslar" (the shared_boat_history rows of another member).
// Pure on purpose: no Supabase import, so unit tests can load it.
import type { SharedHistoryRow } from '@/types/database';

/** The server never returns more than this many rows (its own limit); the page says so when it is reached. */
export const HISTORY_LIMIT = 200;

export interface HistoryDay {
  trainingId: string;
  startsAt: string;
  /** Trainings need not have a title. */
  title: string | null;
  /** This training's shared sessions, in time order. */
  sessions: Array<{ slotIndex: number; boatId: string; boatName: string }>;
}

export interface HistorySummary {
  sessions: number;
  days: number;
  /** How often you shared each boat, most first (ties alphabetical, Turkish collation). */
  boats: Array<{ name: string; count: number }>;
}

/** One entry per training (newest first, the order the server sends), with its shared sessions in time order. */
export function groupByTraining(rows: SharedHistoryRow[]): HistoryDay[] {
  const days = new Map<string, HistoryDay>();
  for (const row of rows) {
    let day = days.get(row.training_id);
    if (!day) {
      day = { trainingId: row.training_id, startsAt: row.starts_at, title: row.title, sessions: [] };
      days.set(row.training_id, day);
    }
    day.sessions.push({ slotIndex: row.slot_index, boatId: row.boat_id, boatName: row.boat_name });
  }
  for (const day of days.values()) day.sessions.sort((a, b) => a.slotIndex - b.slotIndex);
  return [...days.values()];
}

export function summarizeHistory(rows: SharedHistoryRow[]): HistorySummary {
  const perBoat = new Map<string, number>();
  for (const row of rows) perBoat.set(row.boat_name, (perBoat.get(row.boat_name) ?? 0) + 1);
  return {
    sessions: rows.length,
    days: new Set(rows.map((r) => r.training_id)).size,
    boats: [...perBoat].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'tr')),
  };
}
