// The coach's editable program, as plain data + pure functions (no React, no network).
// Every rule the database enforces (capacity, one boat per member per hour, one use of a boat per
// hour) is mirrored here so the editor can refuse a bad move immediately instead of after a save.
import type { Boat, Json, ProgramAssignment, ProgramCrew, TrainingProgram } from '@/types/database';
import { MAX_SLOTS } from '../trainings/schedule';

export interface BoatEntry {
  boatId: string;
  /** Member ids in seat order. */
  crew: string[];
  notes: string;
}

export interface ProgramDraft {
  weatherNote: string;
  trainingNotes: string;
  /** slots[i] = the boats on the water in hour i (only boats that have a crew). */
  slots: BoatEntry[][];
}

/** What the database holds for a training's program (coach sees drafts too; members only published). */
export interface ProgramData {
  program: TrainingProgram | null;
  assignments: ProgramAssignment[];
  crew: ProgramCrew[];
}

export const emptyDraft = (slotCount: number): ProgramDraft => ({
  weatherNote: '',
  trainingNotes: '',
  slots: Array.from({ length: slotCount }, () => []),
});

/** Turns what was loaded from the database into an editable draft. */
export function draftFromProgram(data: ProgramData, slotCount: number): ProgramDraft {
  const draft = emptyDraft(slotCount);
  draft.weatherNote = data.program?.weather_note ?? '';
  draft.trainingNotes = data.program?.training_notes ?? '';
  for (const assignment of data.assignments) {
    if (assignment.slot_index < 0 || assignment.slot_index >= slotCount) continue;
    const crew = data.crew
      .filter((c) => c.assignment_id === assignment.id)
      .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0) || a.member_id.localeCompare(b.member_id))
      .map((c) => c.member_id);
    if (crew.length === 0) continue;
    draft.slots[assignment.slot_index]?.push({ boatId: assignment.boat_id, crew, notes: assignment.notes ?? '' });
  }
  return normalize(draft);
}

/** Canonical form: empty boats dropped, boats in a stable order, text trimmed. Used for comparing and saving. */
export function normalize(draft: ProgramDraft): ProgramDraft {
  return {
    weatherNote: draft.weatherNote.trim(),
    trainingNotes: draft.trainingNotes.trim(),
    slots: draft.slots.map((entries) =>
      entries
        .filter((e) => e.crew.length > 0)
        .map((e) => ({ boatId: e.boatId, crew: [...e.crew], notes: e.notes.trim() }))
        .sort((a, b) => a.boatId.localeCompare(b.boatId)),
    ),
  };
}

/** Sessions after the last one that has a crew are not part of the program (the training simply ends earlier). */
export function trimTrailingEmpty(draft: ProgramDraft): ProgramDraft {
  const slots = normalize(draft).slots;
  let end = slots.length;
  while (end > 0 && (slots[end - 1]?.length ?? 0) === 0) end--;
  return { ...normalize(draft), slots: slots.slice(0, end) };
}

/** Two drafts are the same program when they only differ by empty sessions at the end. */
export function isSameDraft(a: ProgramDraft, b: ProgramDraft): boolean {
  return JSON.stringify(trimTrailingEmpty(a)) === JSON.stringify(trimTrailingEmpty(b));
}

/**
 * How many sessions the editor starts with: whatever the program already uses, whatever the training was planned
 * with (older trainings had a fixed count), and at least one.
 */
export function initialSessionCount(data: Pick<ProgramData, 'assignments'>, trainingSlotCount: number): number {
  const used = data.assignments.reduce((max, a) => Math.max(max, a.slot_index + 1), 0);
  return Math.max(1, trainingSlotCount, used);
}

export const canAddSession = (draft: ProgramDraft): boolean => draft.slots.length < MAX_SLOTS;

/** One more (empty) session at the end. Refuses beyond the maximum, like the database does. */
export function addSession(draft: ProgramDraft): ProgramDraft {
  return canAddSession(draft) ? { ...draft, slots: [...draft.slots, []] } : draft;
}

export const canRemoveSession = (draft: ProgramDraft): boolean => draft.slots.length > 1;

/** Drops the last session together with its crews. There is always at least one session. */
export function removeLastSession(draft: ProgramDraft): ProgramDraft {
  return canRemoveSession(draft) ? { ...draft, slots: draft.slots.slice(0, -1) } : draft;
}

// --- boats that must be full (C4X) ---------------------------------------------------------------

export interface FullCrewProblem {
  slot: number;
  boatId: string;
  count: number;
  capacity: number;
}

/**
 * Boats with `requires_full_crew` (C4X = exactly 4) that have a crew of the wrong size. A boat with nobody in it is
 * simply not used and is fine. Publishing (and updating a published program) must be blocked while this is non-empty;
 * drafts may be incomplete. The database refuses the same thing.
 */
export function fullCrewProblems(draft: ProgramDraft, boats: ReadonlyArray<Pick<Boat, 'id' | 'capacity' | 'requires_full_crew'>>): FullCrewProblem[] {
  const byId = new Map(boats.map((b) => [b.id, b]));
  const problems: FullCrewProblem[] = [];
  draft.slots.forEach((entries, slot) => {
    for (const entry of entries) {
      const boat = byId.get(entry.boatId);
      if (boat?.requires_full_crew && entry.crew.length > 0 && entry.crew.length !== boat.capacity) {
        problems.push({ slot, boatId: entry.boatId, count: entry.crew.length, capacity: boat.capacity });
      }
    }
  });
  return problems;
}

export interface SavePayload {
  weather_note: string | null;
  training_notes: string | null;
  assignments: Array<{ slot_index: number; boat_id: string; notes: string | null; crew: string[] }>;
}

/** The argument of save_program(). Boats without a crew are left out. */
export function toPayload(draft: ProgramDraft): SavePayload {
  const n = normalize(draft);
  return {
    weather_note: n.weatherNote || null,
    training_notes: n.trainingNotes || null,
    assignments: n.slots.flatMap((entries, slot) =>
      entries.map((e) => ({ slot_index: slot, boat_id: e.boatId, notes: e.notes || null, crew: e.crew })),
    ),
  };
}

export const payloadAsJson = (payload: SavePayload): Json => payload as unknown as Json;

// --- reading -----------------------------------------------------------------------------------

export function entryOf(draft: ProgramDraft, slot: number, boatId: string): BoatEntry | undefined {
  return draft.slots[slot]?.find((e) => e.boatId === boatId);
}

export const crewOf = (draft: ProgramDraft, slot: number, boatId: string): string[] => entryOf(draft, slot, boatId)?.crew ?? [];

/** member id → the boat they are in during this hour. */
export function assignedInSlot(draft: ProgramDraft, slot: number): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of draft.slots[slot] ?? []) for (const id of entry.crew) map.set(id, entry.boatId);
  return map;
}

/** Hours (0-based) in which a member rows, with the boat. */
export function memberSlots(draft: ProgramDraft, memberId: string): Array<{ slot: number; boatId: string }> {
  const result: Array<{ slot: number; boatId: string }> = [];
  draft.slots.forEach((entries, slot) => {
    const entry = entries.find((e) => e.crew.includes(memberId));
    if (entry) result.push({ slot, boatId: entry.boatId });
  });
  return result;
}

export const slotHasCrew = (draft: ProgramDraft, slot: number): boolean => (draft.slots[slot] ?? []).some((e) => e.crew.length > 0);
export const hasAnyCrew = (draft: ProgramDraft): boolean => draft.slots.some((_, i) => slotHasCrew(draft, i));

// --- editing (all return a NEW draft; the input is never mutated) ------------------------------

const withSlot = (draft: ProgramDraft, slot: number, entries: BoatEntry[]): ProgramDraft => ({
  ...draft,
  slots: draft.slots.map((existing, i) => (i === slot ? entries : existing)),
});

export type ToggleError = 'full' | 'elsewhere';
export interface ToggleResult {
  draft: ProgramDraft;
  error?: ToggleError;
}

/**
 * Adds the member to the boat for this hour, or removes them if they are already in it.
 * Refuses (and returns the draft unchanged) when the boat is full or the member is already in
 * ANOTHER boat during the same hour.
 */
export function toggleMember(draft: ProgramDraft, slot: number, boatId: string, memberId: string, capacity: number): ToggleResult {
  const entries = draft.slots[slot];
  if (!entries) return { draft };
  const entry = entries.find((e) => e.boatId === boatId);

  if (entry?.crew.includes(memberId)) {
    const crew = entry.crew.filter((id) => id !== memberId);
    const next = crew.length === 0 ? entries.filter((e) => e !== entry) : entries.map((e) => (e === entry ? { ...e, crew } : e));
    return { draft: withSlot(draft, slot, next) };
  }

  const elsewhere = assignedInSlot(draft, slot).get(memberId);
  if (elsewhere && elsewhere !== boatId) return { draft, error: 'elsewhere' };
  if ((entry?.crew.length ?? 0) >= capacity) return { draft, error: 'full' };

  const next = entry
    ? entries.map((e) => (e === entry ? { ...e, crew: [...e.crew, memberId] } : e))
    : [...entries, { boatId, crew: [memberId], notes: '' }];
  return { draft: withSlot(draft, slot, next) };
}

export function removeMember(draft: ProgramDraft, slot: number, boatId: string, memberId: string): ProgramDraft {
  const entry = entryOf(draft, slot, boatId);
  if (!entry?.crew.includes(memberId)) return draft;
  // toggling a member who is in the boat removes them; capacity is irrelevant for removal
  return toggleMember(draft, slot, boatId, memberId, Number.MAX_SAFE_INTEGER).draft;
}

export function clearBoat(draft: ProgramDraft, slot: number, boatId: string): ProgramDraft {
  return withSlot(draft, slot, (draft.slots[slot] ?? []).filter((e) => e.boatId !== boatId));
}

export function clearSlot(draft: ProgramDraft, slot: number): ProgramDraft {
  return withSlot(draft, slot, []);
}

export function setBoatNotes(draft: ProgramDraft, slot: number, boatId: string, notes: string): ProgramDraft {
  return withSlot(
    draft,
    slot,
    (draft.slots[slot] ?? []).map((e) => (e.boatId === boatId ? { ...e, notes } : e)),
  );
}

/**
 * Copies every boat + crew of hour `from` into hour `to`, replacing what `to` had.
 * `isBoatUsable` lets the caller skip boats that were taken out of use (the server would refuse them).
 */
export function copySlot(draft: ProgramDraft, from: number, to: number, isBoatUsable: (boatId: string) => boolean = () => true): ProgramDraft {
  if (from === to) return draft;
  const source = (draft.slots[from] ?? []).filter((e) => e.crew.length > 0 && isBoatUsable(e.boatId));
  return withSlot(draft, to, source.map((e) => ({ boatId: e.boatId, crew: [...e.crew], notes: e.notes })));
}

export const setWeatherNote = (draft: ProgramDraft, weatherNote: string): ProgramDraft => ({ ...draft, weatherNote });
export const setTrainingNotes = (draft: ProgramDraft, trainingNotes: string): ProgramDraft => ({ ...draft, trainingNotes });

// --- checks shown to the coach before publishing -----------------------------------------------

export interface RosterEntry {
  id: string;
  name: string;
  answer?: 'attending' | 'not_attending' | undefined;
}

export interface Analysis {
  /** Said "attending" but rows in no hour at all. */
  unassignedAttending: string[];
  /** Placed in a boat although they said "not attending". */
  assignedNotAttending: string[];
  /** Placed in a boat without having answered. */
  assignedNoAnswer: string[];
  /** How many different people row at least once. */
  peopleAssigned: number;
  /** Hours without any crew. */
  emptySlots: number[];
}

export function analyzeDraft(draft: ProgramDraft, roster: RosterEntry[]): Analysis {
  const inProgram = new Set<string>();
  draft.slots.forEach((entries) => entries.forEach((e) => e.crew.forEach((id) => inProgram.add(id))));
  const byId = new Map(roster.map((r) => [r.id, r]));

  const unassignedAttending = roster.filter((r) => r.answer === 'attending' && !inProgram.has(r.id)).map((r) => r.id);
  const assignedNotAttending: string[] = [];
  const assignedNoAnswer: string[] = [];
  for (const id of inProgram) {
    const member = byId.get(id);
    if (member?.answer === 'not_attending') assignedNotAttending.push(id);
    else if (member && !member.answer) assignedNoAnswer.push(id);
  }
  return {
    unassignedAttending,
    assignedNotAttending,
    assignedNoAnswer,
    peopleAssigned: inProgram.size,
    emptySlots: draft.slots.map((_, i) => i).filter((i) => !slotHasCrew(draft, i)),
  };
}
