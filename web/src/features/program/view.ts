// Read side of a program: turns the database rows into an hour-by-hour timeline and picks out one
// member's own part of it. Pure, so the "which boat am I in?" logic is easy to test.
import type { ProgramData } from './model';

export interface TimelineBoat {
  boatId: string;
  notes: string | null;
  /** Member ids in seat order. */
  crew: string[];
}

export interface TimelineSlot {
  slotIndex: number;
  boats: TimelineBoat[];
}

/** One entry per hour of the training (hours without any boat have an empty `boats`). */
export function buildTimeline(data: ProgramData, slotCount: number, boatOrder: ReadonlyMap<string, number> = new Map()): TimelineSlot[] {
  const slots: TimelineSlot[] = Array.from({ length: slotCount }, (_, slotIndex) => ({ slotIndex, boats: [] }));
  for (const assignment of data.assignments) {
    const slot = slots[assignment.slot_index];
    if (!slot) continue;
    const crew = data.crew
      .filter((c) => c.assignment_id === assignment.id)
      .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0) || a.member_id.localeCompare(b.member_id))
      .map((c) => c.member_id);
    if (crew.length === 0) continue;
    slot.boats.push({ boatId: assignment.boat_id, notes: assignment.notes, crew });
  }
  const rank = (boatId: string) => boatOrder.get(boatId) ?? Number.MAX_SAFE_INTEGER;
  for (const slot of slots) slot.boats.sort((a, b) => rank(a.boatId) - rank(b.boatId) || a.boatId.localeCompare(b.boatId));
  return slots;
}

// --- grouped by boat ------------------------------------------------------------------------------

export interface BoatSession {
  slotIndex: number;
  /** Member ids in seat order. */
  crew: string[];
  notes: string | null;
}

export interface BoatSchedule {
  boatId: string;
  /** Only the sessions in which this boat is used, in time order. */
  sessions: BoatSession[];
}

/**
 * The whole program grouped by boat — "Turuncu: 08:00 Ahmet – Gülden, 09:00 Öykü – Çiğdem …". Boats appear in the
 * club's boat order, each with its sessions in time order; boats that are not used at all are left out.
 */
export function buildByBoat(data: ProgramData, boatOrder: ReadonlyMap<string, number> = new Map()): BoatSchedule[] {
  const bySeat = (a: { seat: number | null; member_id: string }, b: { seat: number | null; member_id: string }) =>
    (a.seat ?? 0) - (b.seat ?? 0) || a.member_id.localeCompare(b.member_id);
  const boats = new Map<string, BoatSession[]>();
  for (const assignment of data.assignments) {
    const crew = data.crew
      .filter((c) => c.assignment_id === assignment.id)
      .sort(bySeat)
      .map((c) => c.member_id);
    if (crew.length === 0) continue;
    const sessions = boats.get(assignment.boat_id) ?? [];
    sessions.push({ slotIndex: assignment.slot_index, crew, notes: assignment.notes });
    boats.set(assignment.boat_id, sessions);
  }
  const rank = (boatId: string) => boatOrder.get(boatId) ?? Number.MAX_SAFE_INTEGER;
  return [...boats]
    .map(([boatId, sessions]) => ({ boatId, sessions: sessions.sort((a, b) => a.slotIndex - b.slotIndex) }))
    .sort((a, b) => rank(a.boatId) - rank(b.boatId) || a.boatId.localeCompare(b.boatId));
}

/** True when this member rows in the session. */
export const isMineSession = (session: Pick<BoatSession, 'crew'>, memberId: string | undefined): boolean =>
  memberId !== undefined && session.crew.includes(memberId);

export interface MyAssignment {
  slotIndex: number;
  boatId: string;
  notes: string | null;
  /** The other people in the same boat that hour. */
  mates: string[];
}

/** Every hour in which this member rows, in time order, with their boat and crew mates. */
export function myAssignments(timeline: TimelineSlot[], memberId: string): MyAssignment[] {
  const mine: MyAssignment[] = [];
  for (const slot of timeline) {
    const boat = slot.boats.find((b) => b.crew.includes(memberId));
    if (boat) mine.push({ slotIndex: slot.slotIndex, boatId: boat.boatId, notes: boat.notes, mates: boat.crew.filter((id) => id !== memberId) });
  }
  return mine;
}

/** "Jamie ile", "Jamie ve Ali ile", "Jamie, Ali ve Becca ile", or "tek başına". Turkish list wording. */
export function matesLabel(names: string[]): string {
  if (names.length === 0) return 'tek başına';
  if (names.length === 1) return `${names[0]} ile`;
  return `${names.slice(0, -1).join(', ')} ve ${names[names.length - 1]} ile`;
}
