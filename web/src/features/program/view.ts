// Read side of a program: turns the database rows into the boat-by-boat schedule and picks out one member's own
// sessions. Pure, so the "which boat am I in, and when?" logic is easy to test.
import type { ProgramData } from './model';

export interface BoatSession {
  /** The session's number (`slot_index`). */
  slotIndex: number;
  /** ISO instants: THIS session's own start and end. */
  startsAt: string;
  endsAt: string;
  /** The rowers' ids in seat order: the order they sit in the boat (the first is the first seat). Never sorted by name. */
  crew: string[];
  /** The dümenci (coxswain) who steers — a member or a coach — or null. Not one of the rowers. */
  cox: string | null;
  notes: string | null;
}

export interface BoatSchedule {
  boatId: string;
  /** Only the sessions in which this boat is used, in time order. */
  sessions: BoatSession[];
}

const bySeat = (a: { seat: number | null; member_id: string }, b: { seat: number | null; member_id: string }) =>
  (a.seat ?? 0) - (b.seat ?? 0) || a.member_id.localeCompare(b.member_id);

/** The session's rowers in seat order and its dümenci, from the crew rows of one assignment. */
function splitCrew(rows: ProgramData['crew'], assignmentId: string): { crew: string[]; cox: string | null } {
  const own = rows.filter((c) => c.assignment_id === assignmentId);
  return { crew: own.filter((c) => !c.is_cox).sort(bySeat).map((c) => c.member_id), cox: own.find((c) => c.is_cox)?.member_id ?? null };
}

/**
 * The whole program grouped by boat — "Turuncu: 08:15–09:15 Ahmet – Gülden, 09:15–10:15 Öykü – Çiğdem …". Boats appear in
 * the club's boat order, each with its sessions in time order; boats that are not used at all are left out. Every boat
 * has its own schedule: nothing here compares one boat's times with another's.
 */
export function buildByBoat(data: ProgramData, boatOrder: ReadonlyMap<string, number> = new Map()): BoatSchedule[] {
  const boats = new Map<string, BoatSession[]>();
  for (const assignment of data.assignments) {
    const { crew, cox } = splitCrew(data.crew, assignment.id);
    if (crew.length === 0) continue;
    const sessions = boats.get(assignment.boat_id) ?? [];
    sessions.push({ slotIndex: assignment.slot_index, startsAt: assignment.starts_at, endsAt: assignment.ends_at, crew, cox, notes: assignment.notes });
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

/** True when this member takes part in the session: as a rower or as its dümenci. */
export const isMineSession = (session: Pick<BoatSession, 'crew' | 'cox'>, memberId: string | undefined): boolean =>
  memberId !== undefined && (session.crew.includes(memberId) || session.cox === memberId);

export interface MyAssignment {
  slotIndex: number;
  boatId: string;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  /** The other ROWERS in the same boat in that session, in seat order. */
  mates: string[];
  /** The session's dümenci, or null. */
  cox: string | null;
  /** The member is this session's dümenci (and rows in no seat). */
  iAmCox: boolean;
  /** The member's place among the rowers (1 = first), or null when they steer. */
  seat: number | null;
}

/** Every session in which this member rows or steers, in time order, with the boat, its own times, the crew mates and the dümenci. */
export function myAssignments(data: ProgramData, memberId: string): MyAssignment[] {
  const mine: MyAssignment[] = [];
  for (const assignment of data.assignments) {
    const { crew, cox } = splitCrew(data.crew, assignment.id);
    const iAmCox = cox === memberId;
    if (!iAmCox && !crew.includes(memberId)) continue;
    mine.push({
      slotIndex: assignment.slot_index,
      boatId: assignment.boat_id,
      startsAt: assignment.starts_at,
      endsAt: assignment.ends_at,
      notes: assignment.notes,
      mates: crew.filter((id) => id !== memberId),
      cox,
      iAmCox,
      seat: iAmCox ? null : crew.indexOf(memberId) + 1,
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
