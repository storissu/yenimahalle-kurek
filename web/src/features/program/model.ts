// The coach's editable program, as plain data + pure functions (no React, no network).
//
// Every boat has its OWN sequence of sessions, each with its own start and end (club wall time, "HH:MM"):
//   Mavi    08:00–09:00 Ali + John   09:00–10:00 Ayşe + Mehmet
//   Turuncu 08:15–09:15 Elif + Can   09:15–10:15 Zeynep + Deniz
// Sessions of different boats never influence each other. A session lasts one hour unless the coach says otherwise.
// Every rule the database enforces (capacity, no overlapping sessions of one boat, nobody in two boats at once, full C4X,
// a dümenci on boats that have one) is mirrored here so the editor can refuse a bad move immediately instead of after a save.
//
// A session's crew is ORDERED: the first rower is the first seat of the boat, and that order is kept exactly as the coach
// left it (nothing here ever sorts it). The dümenci (coxswain) is a separate role next to the rowers, never a fifth seat.
import type { Boat, Json, ProgramAssignment, ProgramCrew, TrainingProgram } from '@/types/database';
import { instantToWallTime, wallTimeToInstant } from '@/lib/time';
import { MAX_SLOTS } from '../trainings/schedule';

export interface SessionDraft {
  /** The session's number in the database (`slot_index`): stable, unique within the training; new sessions get fresh ones. */
  id: number;
  boatId: string;
  /** "HH:MM", club time. */
  start: string;
  end: string;
  /** The ROWERS' ids in seat order (the order in the boat: the first is the first seat). The dümenci is not in here. */
  crew: string[];
  /** The dümenci (coxswain) of a boat that has one: a member or a coach. Not one of the rowers. */
  cox: string | null;
  notes: string;
}

/** Everybody in the session: the rowers in seat order, then the dümenci. */
export const peopleOf = (session: Pick<SessionDraft, 'crew' | 'cox'>): string[] => (session.cox ? [...session.crew, session.cox] : [...session.crew]);

/** True when the person is in the session as a rower or as its dümenci. */
export const isInSession = (session: Pick<SessionDraft, 'crew' | 'cox'>, memberId: string): boolean => session.crew.includes(memberId) || session.cox === memberId;

export interface ProgramDraft {
  weatherNote: string;
  trainingNotes: string;
  /** Every session of every boat (grouped by boat and ordered by time only when shown). */
  sessions: SessionDraft[];
}

/** What the database holds for a training's program (coach sees drafts too; members only published). */
export interface ProgramData {
  program: TrainingProgram | null;
  assignments: ProgramAssignment[];
  crew: ProgramCrew[];
}

// --- clock arithmetic ("HH:MM" <-> minutes) -----------------------------------------------------

export const DEFAULT_MINUTES = 60;
export const MAX_SESSION_MINUTES = 8 * 60;
const DAY_END = 23 * 60 + 59;

export function toMinutes(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function fromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(DAY_END, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export const isTime = (time: string): boolean => Number.isFinite(toMinutes(time)) && toMinutes(time) <= DAY_END;

/** "1 sa", "1 sa 15 dk", "45 dk". */
export function durationLabel(start: string, end: string): string {
  const minutes = toMinutes(end) - toMinutes(start);
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h} sa` : '', m > 0 ? `${m} dk` : ''].filter(Boolean).join(' ');
}

// --- loading -------------------------------------------------------------------------------------

export const emptyDraft = (): ProgramDraft => ({ weatherNote: '', trainingNotes: '', sessions: [] });

/** Turns what was loaded from the database into an editable draft (sessions without a crew are not part of a program). */
export function draftFromProgram(data: ProgramData): ProgramDraft {
  const sessions: SessionDraft[] = [];
  for (const assignment of data.assignments) {
    const rows = data.crew.filter((c) => c.assignment_id === assignment.id);
    // the seat number IS the order in the boat; the member id only breaks ties of old rows that have no seat
    const crew = rows
      .filter((c) => !c.is_cox)
      .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0) || a.member_id.localeCompare(b.member_id))
      .map((c) => c.member_id);
    if (crew.length === 0) continue;
    sessions.push({
      id: assignment.slot_index,
      boatId: assignment.boat_id,
      start: instantToWallTime(assignment.starts_at).time,
      end: instantToWallTime(assignment.ends_at).time,
      crew,
      cox: rows.find((c) => c.is_cox)?.member_id ?? null,
      notes: assignment.notes ?? '',
    });
  }
  return normalize({ weatherNote: data.program?.weather_note ?? '', trainingNotes: data.program?.training_notes ?? '', sessions });
}

/** Canonical form: sessions without a crew dropped, a stable order, text trimmed. Used for comparing and saving. */
export function normalize(draft: ProgramDraft): ProgramDraft {
  return {
    weatherNote: draft.weatherNote.trim(),
    trainingNotes: draft.trainingNotes.trim(),
    sessions: draft.sessions
      .filter((s) => s.crew.length > 0)
      .map((s) => ({ id: s.id, boatId: s.boatId, start: s.start, end: s.end, crew: [...s.crew], cox: s.cox, notes: s.notes.trim() }))
      .sort((a, b) => a.id - b.id || a.boatId.localeCompare(b.boatId)),
  };
}

/** Two drafts are the same program when they only differ by empty sessions. */
export const isSameDraft = (a: ProgramDraft, b: ProgramDraft): boolean => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

// --- reading -------------------------------------------------------------------------------------

const byTime = (a: SessionDraft, b: SessionDraft) => toMinutes(a.start) - toMinutes(b.start) || toMinutes(a.end) - toMinutes(b.end) || a.id - b.id;

/** One boat's sessions in time order. */
export const sessionsOf = (draft: ProgramDraft, boatId: string): SessionDraft[] => draft.sessions.filter((s) => s.boatId === boatId).sort(byTime);

export const sessionById = (draft: ProgramDraft, id: number, boatId?: string): SessionDraft | undefined =>
  draft.sessions.find((s) => s.id === id && (boatId === undefined || s.boatId === boatId));

export const hasAnyCrew = (draft: ProgramDraft): boolean => draft.sessions.some((s) => s.crew.length > 0);

/** The sessions a member takes part in (as a rower or as the dümenci), in time order (each with its boat). */
export const memberSessions = (draft: ProgramDraft, memberId: string): SessionDraft[] => draft.sessions.filter((s) => isInSession(s, memberId)).sort(byTime);

const overlaps = (a: Pick<SessionDraft, 'start' | 'end'>, b: Pick<SessionDraft, 'start' | 'end'>): boolean =>
  toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);

/** Another session that the person is already in (rowing or steering) while `session` is on the water, if any. */
export function conflictFor(draft: ProgramDraft, session: SessionDraft, memberId: string): SessionDraft | undefined {
  return draft.sessions.find((s) => s !== session && isInSession(s, memberId) && overlaps(s, session));
}

// --- adding, timing, removing sessions -------------------------------------------------------------

/** The number a new session gets: above every number in the draft and above `floor` (the training's bound, which covers attendance). */
export const nextSessionId = (draft: ProgramDraft, floor = 0): number => Math.max(floor, ...draft.sessions.map((s) => s.id + 1), 0);

export const canAddSession = (draft: ProgramDraft, boatId: string): boolean => {
  if (draft.sessions.length >= MAX_SLOTS) return false;
  const last = sessionsOf(draft, boatId).at(-1);
  return !last || toMinutes(last.end) < DAY_END;
};

/** Where the next session of a boat would start: when its last one ends, or at `firstStart` for a boat's first session. */
export function suggestedStart(draft: ProgramDraft, boatId: string, firstStart: string): string {
  const last = [...sessionsOf(draft, boatId)].sort((a, b) => toMinutes(a.end) - toMinutes(b.end)).at(-1);
  return last ? last.end : firstStart;
}

/**
 * A new (empty) session for the boat: it starts when the boat's previous session ends (or at `firstStart` for the first
 * one) and lasts an hour. Returns the draft and the new session's number; refuses beyond the maximum.
 */
export function addSession(draft: ProgramDraft, boatId: string, firstStart: string, floor = 0): { draft: ProgramDraft; id: number | null } {
  if (!canAddSession(draft, boatId)) return { draft, id: null };
  const start = suggestedStart(draft, boatId, firstStart);
  const end = fromMinutes(toMinutes(start) + DEFAULT_MINUTES);
  const id = nextSessionId(draft, floor);
  return { draft: { ...draft, sessions: [...draft.sessions, { id, boatId, start, end, crew: [], cox: null, notes: '' }] }, id };
}

/**
 * Gives every listed boat that has no session yet one empty session (an hour, starting at `firstStart`): the starting
 * point of the editor, so the coach only sets the boat's first start time and picks a team. Empty sessions are never saved.
 */
export function withDefaultSessions(draft: ProgramDraft, boatIds: readonly string[], firstStart: string, floor = 0): ProgramDraft {
  let next = draft;
  for (const boatId of boatIds) if (!next.sessions.some((s) => s.boatId === boatId)) next = addSession(next, boatId, firstStart, floor).draft;
  return next;
}

const mapSession = (draft: ProgramDraft, id: number, fn: (s: SessionDraft) => SessionDraft): ProgramDraft => ({
  ...draft,
  sessions: draft.sessions.map((s) => (s.id === id ? fn(s) : s)),
});

/**
 * Sets a session's start.
 *  - The FIRST session of a boat is the boat's starting time: the whole boat moves with it (every session keeps its
 *    length and the gaps between them), so the coach types 08:15 once. Refused if something would leave the day.
 *  - Any other session only changes its own start (a shorter or longer session); an end that is no longer after
 *    the start becomes one hour after it.
 * Other boats are never touched.
 */
export function setStart(draft: ProgramDraft, id: number, start: string): ProgramDraft {
  const session = sessionById(draft, id);
  if (!session || !isTime(start)) return draft;
  const first = sessionsOf(draft, session.boatId)[0];
  if (first && first.id === id) {
    const delta = toMinutes(start) - toMinutes(session.start);
    const moved = draft.sessions.filter((s) => s.boatId === session.boatId);
    if (moved.some((s) => toMinutes(s.start) + delta < 0 || toMinutes(s.end) + delta > DAY_END)) return draft;
    return {
      ...draft,
      sessions: draft.sessions.map((s) => (s.boatId === session.boatId ? { ...s, start: fromMinutes(toMinutes(s.start) + delta), end: fromMinutes(toMinutes(s.end) + delta) } : s)),
    };
  }
  return mapSession(draft, id, (s) => ({ ...s, start, end: toMinutes(s.end) > toMinutes(start) ? s.end : fromMinutes(toMinutes(start) + DEFAULT_MINUTES) }));
}

/**
 * Sets a session's end. The boat's LATER sessions follow by the same amount (they keep their length and the gaps), so
 * making 08:00–09:00 into 08:00–09:15 turns 09:00–10:00 into 09:15–10:15. Earlier sessions and other boats are untouched.
 */
export function setEnd(draft: ProgramDraft, id: number, end: string): ProgramDraft {
  const session = sessionById(draft, id);
  if (!session || !isTime(end)) return draft;
  const delta = toMinutes(end) - toMinutes(session.end);
  const later = draft.sessions.filter((s) => s.boatId === session.boatId && s.id !== id && toMinutes(s.start) >= toMinutes(session.end));
  if (later.some((s) => toMinutes(s.start) + delta < 0 || toMinutes(s.end) + delta > DAY_END)) return mapSession(draft, id, (s) => ({ ...s, end }));
  const laterIds = new Set(later.map((s) => s.id));
  return {
    ...draft,
    sessions: draft.sessions.map((s) => {
      if (s.id === id) return { ...s, end };
      if (s.boatId === session.boatId && laterIds.has(s.id)) return { ...s, start: fromMinutes(toMinutes(s.start) + delta), end: fromMinutes(toMinutes(s.end) + delta) };
      return s;
    }),
  };
}

/** Removes the session together with its crew. The boat's other sessions keep their times. */
export const removeSession = (draft: ProgramDraft, id: number): ProgramDraft => ({ ...draft, sessions: draft.sessions.filter((s) => s.id !== id) });

/**
 * Swaps the TEAMS (rowers in their order, dümenci and note) of a session and its neighbour in the same boat, `direction`
 * -1 = the one before, +1 = the one after. The times stay where they are: the first team simply rows second.
 */
export function moveTeam(draft: ProgramDraft, id: number, direction: -1 | 1): ProgramDraft {
  const session = sessionById(draft, id);
  if (!session) return draft;
  const list = sessionsOf(draft, session.boatId);
  const index = list.findIndex((s) => s.id === id);
  const other = list[index + direction];
  if (!other) return draft;
  return {
    ...draft,
    sessions: draft.sessions.map((s) => {
      if (s.id === session.id) return { ...s, crew: [...other.crew], cox: other.cox, notes: other.notes };
      if (s.id === other.id) return { ...s, crew: [...session.crew], cox: session.cox, notes: session.notes };
      return s;
    }),
  };
}

// --- crew ---------------------------------------------------------------------------------------------

export type ToggleError = 'full' | 'elsewhere' | 'cox';
export interface ToggleResult {
  draft: ProgramDraft;
  error?: ToggleError;
  /** For 'elsewhere': the session the member is already in at that time. */
  conflict?: SessionDraft;
}

/**
 * Adds the member to the session as a rower (at the END of the order), or removes them if they already row in it. Refuses
 * (and returns the draft unchanged) when the boat is full, the member is already in another boat while this session is on
 * the water, or is this session's dümenci (a dümenci is not a rower).
 */
export function toggleMember(draft: ProgramDraft, id: number, memberId: string, capacity: number): ToggleResult {
  const session = sessionById(draft, id);
  if (!session) return { draft };
  if (session.crew.includes(memberId)) {
    return { draft: mapSession(draft, id, (s) => ({ ...s, crew: s.crew.filter((m) => m !== memberId) })) };
  }
  if (session.cox === memberId) return { draft, error: 'cox' };
  const conflict = conflictFor(draft, session, memberId);
  if (conflict) return { draft, error: 'elsewhere', conflict };
  if (session.crew.length >= capacity) return { draft, error: 'full' };
  return { draft: mapSession(draft, id, (s) => ({ ...s, crew: [...s.crew, memberId] })) };
}

export function removeMember(draft: ProgramDraft, id: number, memberId: string): ProgramDraft {
  return mapSession(draft, id, (s) => ({ ...s, crew: s.crew.filter((m) => m !== memberId) }));
}

/**
 * Moves a rower one place towards the FRONT (`direction` -1) or towards the back (+1) of the boat. The order is the seating
 * order and only changes when the coach says so. Does nothing at either end.
 */
export function moveMember(draft: ProgramDraft, id: number, memberId: string, direction: -1 | 1): ProgramDraft {
  return mapSession(draft, id, (s) => {
    const from = s.crew.indexOf(memberId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= s.crew.length) return s;
    const crew = [...s.crew];
    [crew[from], crew[to]] = [crew[to] as string, crew[from] as string];
    return { ...s, crew };
  });
}

export type CoxError = 'rower' | 'elsewhere';
export interface CoxResult {
  draft: ProgramDraft;
  error?: CoxError;
  /** For 'elsewhere': the session the person is already in at that time. */
  conflict?: SessionDraft;
}

/**
 * Sets (or, with null, clears) the session's dümenci. Any member or the coach can steer, but not somebody who already rows in
 * this very session, nor somebody who is in another boat while this session is on the water.
 */
export function setCox(draft: ProgramDraft, id: number, memberId: string | null): CoxResult {
  const session = sessionById(draft, id);
  if (!session) return { draft };
  if (memberId === null || session.cox === memberId) return { draft: mapSession(draft, id, (s) => ({ ...s, cox: null })) };
  if (session.crew.includes(memberId)) return { draft, error: 'rower' };
  const conflict = conflictFor(draft, session, memberId);
  if (conflict) return { draft, error: 'elsewhere', conflict };
  return { draft: mapSession(draft, id, (s) => ({ ...s, cox: memberId })) };
}

/** A draft in which boats without a dümenci role carry none (their setting may have been switched off after the save). */
export function withoutCoxOn(draft: ProgramDraft, boats: ReadonlyArray<Pick<Boat, 'id' | 'has_coxswain'>>): ProgramDraft {
  const allowed = new Set(boats.filter((b) => b.has_coxswain).map((b) => b.id));
  return draft.sessions.some((s) => s.cox && !allowed.has(s.boatId))
    ? { ...draft, sessions: draft.sessions.map((s) => (s.cox && !allowed.has(s.boatId) ? { ...s, cox: null } : s)) }
    : draft;
}

export const setSessionNotes = (draft: ProgramDraft, id: number, notes: string): ProgramDraft => mapSession(draft, id, (s) => ({ ...s, notes }));
export const setWeatherNote = (draft: ProgramDraft, weatherNote: string): ProgramDraft => ({ ...draft, weatherNote });
export const setTrainingNotes = (draft: ProgramDraft, trainingNotes: string): ProgramDraft => ({ ...draft, trainingNotes });

// --- what is wrong with the schedule ------------------------------------------------------------------

export type ProblemKind = 'order' | 'long' | 'early' | 'boat-overlap' | 'person-overlap';
export interface SessionProblem {
  kind: ProblemKind;
  /** The other session for overlaps. */
  other?: SessionDraft;
  /** The person for 'person-overlap'. */
  memberId?: string;
}

/**
 * Problems per session (only sessions with a crew are part of the program, but a bad time on any session is flagged).
 * `trainingStart` ("HH:MM") is the earliest a session may start. Saving must be blocked while any exists; the database
 * refuses the same things.
 */
export function sessionProblems(draft: ProgramDraft, trainingStart: string): Map<number, SessionProblem[]> {
  const result = new Map<number, SessionProblem[]>();
  const add = (id: number, problem: SessionProblem) => result.set(id, [...(result.get(id) ?? []), problem]);
  const crewed = draft.sessions.filter((s) => s.crew.length > 0);

  for (const s of draft.sessions) {
    const length = toMinutes(s.end) - toMinutes(s.start);
    if (!Number.isFinite(length) || length <= 0) add(s.id, { kind: 'order' });
    else if (length > MAX_SESSION_MINUTES) add(s.id, { kind: 'long' });
  }
  for (const s of crewed) if (toMinutes(s.start) < toMinutes(trainingStart)) add(s.id, { kind: 'early' });

  for (let i = 0; i < crewed.length; i++) {
    for (let j = i + 1; j < crewed.length; j++) {
      const a = crewed[i] as SessionDraft;
      const b = crewed[j] as SessionDraft;
      if (!overlaps(a, b)) continue;
      if (a.boatId === b.boatId) {
        add(a.id, { kind: 'boat-overlap', other: b });
        add(b.id, { kind: 'boat-overlap', other: a });
      }
      for (const memberId of peopleOf(a)) {
        if (isInSession(b, memberId)) {
          add(a.id, { kind: 'person-overlap', other: b, memberId });
          add(b.id, { kind: 'person-overlap', other: a, memberId });
        }
      }
    }
  }
  return result;
}

// --- boats that must be full (C4X) ---------------------------------------------------------------

export interface FullCrewProblem {
  sessionId: number;
  boatId: string;
  start: string;
  end: string;
  count: number;
  capacity: number;
}

/**
 * Boats with `requires_full_crew` (C4X = exactly 4) that have a session with a crew of the wrong size. A session with
 * nobody in it is simply not used and is fine. Publishing (and updating a published program) must be blocked while this
 * is non-empty; drafts may be incomplete. The database refuses the same thing.
 */
export function fullCrewProblems(draft: ProgramDraft, boats: ReadonlyArray<Pick<Boat, 'id' | 'capacity' | 'requires_full_crew'>>): FullCrewProblem[] {
  const byId = new Map(boats.map((b) => [b.id, b]));
  return draft.sessions.flatMap((s) => {
    const boat = byId.get(s.boatId);
    return boat?.requires_full_crew && s.crew.length > 0 && s.crew.length !== boat.capacity
      ? [{ sessionId: s.id, boatId: s.boatId, start: s.start, end: s.end, count: s.crew.length, capacity: boat.capacity }]
      : [];
  });
}

export interface CoxProblem {
  sessionId: number;
  boatId: string;
  start: string;
  end: string;
}

/**
 * Boats with a dümenci (`has_coxswain`, the C4X) that have a session with rowers but nobody steering. Like an incomplete
 * crew this blocks publishing (drafts may be incomplete); the database refuses the same thing.
 */
export function coxProblems(draft: ProgramDraft, boats: ReadonlyArray<Pick<Boat, 'id' | 'has_coxswain'>>): CoxProblem[] {
  const withCox = new Set(boats.filter((b) => b.has_coxswain).map((b) => b.id));
  return draft.sessions
    .filter((s) => withCox.has(s.boatId) && s.crew.length > 0 && !s.cox)
    .map((s) => ({ sessionId: s.id, boatId: s.boatId, start: s.start, end: s.end }));
}

// --- saving --------------------------------------------------------------------------------------

export interface SavePayload {
  weather_note: string | null;
  training_notes: string | null;
  /** `crew` = the rowers in seat order; `cox` = the dümenci (null when there is none). */
  assignments: Array<{ slot_index: number; boat_id: string; starts_at: string; ends_at: string; notes: string | null; crew: string[]; cox: string | null }>;
}

/**
 * The argument of save_program(). `date` is the training's day ("2026-09-22", club time): every session's "HH:MM"
 * becomes a real instant on that day. Sessions without a crew are left out.
 */
export function toPayload(draft: ProgramDraft, date: string): SavePayload {
  const n = normalize(draft);
  return {
    weather_note: n.weatherNote || null,
    training_notes: n.trainingNotes || null,
    assignments: n.sessions.map((s) => ({
      slot_index: s.id,
      boat_id: s.boatId,
      starts_at: wallTimeToInstant(date, s.start).toISOString(),
      ends_at: wallTimeToInstant(date, s.end).toISOString(),
      notes: s.notes || null,
      crew: s.crew,
      cox: s.cox,
    })),
  };
}

export const payloadAsJson = (payload: SavePayload): Json => payload as unknown as Json;

// --- checks shown to the coach before publishing -----------------------------------------------

export interface RosterEntry {
  id: string;
  name: string;
  answer?: 'attending' | 'not_attending' | undefined;
}

export interface Analysis {
  /** Said "attending" but rows in no session at all. */
  unassignedAttending: string[];
  /** Placed in a boat although they said "not attending". */
  assignedNotAttending: string[];
  /** Placed in a boat without having answered. */
  assignedNoAnswer: string[];
  /** How many different people row at least once. */
  peopleAssigned: number;
}

export function analyzeDraft(draft: ProgramDraft, roster: RosterEntry[]): Analysis {
  const inProgram = new Set<string>();
  for (const s of draft.sessions) for (const id of peopleOf(s)) inProgram.add(id);
  const byId = new Map(roster.map((r) => [r.id, r]));

  const unassignedAttending = roster.filter((r) => r.answer === 'attending' && !inProgram.has(r.id)).map((r) => r.id);
  const assignedNotAttending: string[] = [];
  const assignedNoAnswer: string[] = [];
  for (const id of inProgram) {
    const member = byId.get(id);
    if (member?.answer === 'not_attending') assignedNotAttending.push(id);
    else if (member && !member.answer) assignedNoAnswer.push(id);
  }
  return { unassignedAttending, assignedNotAttending, assignedNoAnswer, peopleAssigned: inProgram.size };
}
