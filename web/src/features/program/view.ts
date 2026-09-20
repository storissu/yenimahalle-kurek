// Read side of a program: turns the database rows into the boat-by-boat schedule and picks out one member's own
// sessions. Pure, so the "which boat am I in, and when?" logic is easy to test.
import type { ProgramData } from './model';

export interface BoatSession {
  /** The session's number (`slot_index`). */
  slotIndex: number;
  /** ISO instants: THIS session's own start and end. */
  startsAt: string;
  endsAt: string;
  /** Member ids in seat order. */
  crew: string[];
  notes: string | null;
}

export interface BoatSchedule {
  boatId: string;
  /** Only the sessions in which this boat is used, in time order. */
  sessions: BoatSession[];
}

const bySeat = (a: { seat: number | null; member_id: string }, b: { seat: number | null; member_id: string }) =>
  (a.seat ?? 0) - (b.seat ?? 0) || a.member_id.localeCompare(b.member_id);

/**
 * The whole program grouped by boat — "Turuncu: 08:15–09:15 Ahmet – Gülden, 09:15–10:15 Öykü – Çiğdem …". Boats appear in
 * the club's boat order, each with its sessions in time order; boats that are not used at all are left out. Every boat
 * has its own schedule: nothing here compares one boat's times with another's.
 */
export function buildByBoat(data: ProgramData, boatOrder: ReadonlyMap<string, number> = new Map()): BoatSchedule[] {
  const boats = new Map<string, BoatSession[]>();
  for (const assignment of data.assignments) {
    const crew = data.crew
      .filter((c) => c.assignment_id === assignment.id)
      .sort(bySeat)
      .map((c) => c.member_id);
    if (crew.length === 0) continue;
    const sessions = boats.get(assignment.boat_id) ?? [];
    sessions.push({ slotIndex: assignment.slot_index, startsAt: assignment.starts_at, endsAt: assignment.ends_at, crew, notes: assignment.notes });
    boats.set(assignment.boat_id, sessions);
  }
  const rank = (boatId: string) => boatOrder.get(boatId) ?? Number.MAX_SAFE_INTEGER;
  return [...boats]
    .map(([boatId, sessions]) => ({ boatId, sessions: sessions.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.slotIndex - b.slotIndex) }))
    .sort((a, b) => rank(a.boatId) - rank(b.boatId) || a.boatId.localeCompare(b.boatId));
}

/** How big the program is, for a one-line summary: sessions with a crew, boats that carry one, and distinct people placed. */
export function summarizeProgram(data: ProgramData): { sessions: number; boats: number; people: number } {
  const withCrew = new Set(data.crew.map((c) => c.assignment_id));
  const used = data.assignments.filter((a) => withCrew.has(a.id));
  return { sessions: used.length, boats: new Set(used.map((a) => a.boat_id)).size, people: new Set(data.crew.map((c) => c.member_id)).size };
}

/** True when this member rows in the session. */
export const isMineSession = (session: Pick<BoatSession, 'crew'>, memberId: string | undefined): boolean =>
  memberId !== undefined && session.crew.includes(memberId);

export interface MyAssignment {
  slotIndex: number;
  boatId: string;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  /** The other people in the same boat in that session. */
  mates: string[];
}

/** Every session in which this member rows, in time order, with the boat, its own times and the crew mates. */
export function myAssignments(data: ProgramData, memberId: string): MyAssignment[] {
  const mine: MyAssignment[] = [];
  for (const assignment of data.assignments) {
    const crew = data.crew.filter((c) => c.assignment_id === assignment.id).sort(bySeat).map((c) => c.member_id);
    if (!crew.includes(memberId)) continue;
    mine.push({
      slotIndex: assignment.slot_index,
      boatId: assignment.boat_id,
      startsAt: assignment.starts_at,
      endsAt: assignment.ends_at,
      notes: assignment.notes,
      mates: crew.filter((id) => id !== memberId),
    });
  }
  return mine.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.slotIndex - b.slotIndex);
}

/** "Jamie ile", "Jamie ve Ali ile", "Jamie, Ali ve Becca ile", or "tek başına". Turkish list wording. */
export function matesLabel(names: string[]): string {
  if (names.length === 0) return 'tek başına';
  if (names.length === 1) return `${names[0]} ile`;
  return `${names.slice(0, -1).join(', ')} ve ${names[names.length - 1]} ile`;
}
