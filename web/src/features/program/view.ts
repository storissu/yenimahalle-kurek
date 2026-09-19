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
