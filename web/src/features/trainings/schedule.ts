// Pure helpers about a training's sessions and RSVP window. No React, no network — easy to test.
import { formatDayMonth, formatTime, HOUR_MS } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { TrainingStatus } from '@/types/database';

export type { TrainingStatus };

export interface TrainingLike {
  starts_at: string;
  slot_count: number;
  /** End of the last session (server-derived); null until a program exists. */
  ends_at?: string | null;
  rsvp_deadline: string;
  status: TrainingStatus;
}

/** The most session numbers one training can use (the database enforces the same limit). */
export const MAX_SLOTS = 30;

export const startsAt = (t: Pick<TrainingLike, 'starts_at'>): Date => new Date(t.starts_at);

/**
 * A training's sessions are decided by its program, not up front: `slot_count` is 0 until a program (or an
 * attendance sheet) exists. Until then the training counts as one hour long, so lists and "is it over?"
 * checks keep working.
 */
type Span = Pick<TrainingLike, 'starts_at' | 'slot_count'> & { ends_at?: string | null };

export const hasPlannedSessions = (t: Pick<TrainingLike, 'slot_count'> & { ends_at?: string | null }): boolean => Boolean(t.ends_at) || t.slot_count > 0;

/** When the training is over: the end of its last session; without a program, start + one hour per session (at least one). */
export const endsAt = (t: Span): Date => (t.ends_at ? new Date(t.ends_at) : new Date(new Date(t.starts_at).getTime() + Math.max(1, t.slot_count) * HOUR_MS));

/** "08:00–10:30", or just "08:00" while the length is not known yet. */
export function timeRangeLabel(t: Span): string {
  return hasPlannedSessions(t) ? `${formatTime(startsAt(t))}–${formatTime(endsAt(t))}` : formatTime(startsAt(t));
}

/** "08:00–10:30", or "08:00 · süre program hazırlanınca belli olur". */
export function trainingTimeText(t: Span): string {
  return hasPlannedSessions(t) ? timeRangeLabel(t) : `${timeRangeLabel(t)} · ${tr.trainings.durationUnknown}`;
}

/** "08:15–09:15" from the two instants of a session. */
export const spanLabel = (from: string | Date, to: string | Date): string => `${formatTime(from)}–${formatTime(to)}`;

/**
 * When a session was, given the times the database knows for it (or not): its own window if there is one, otherwise the old
 * hourly grid — an hour per session number from the training's start (sessions nobody planned, older data).
 */
export function sessionWindow(t: Pick<TrainingLike, 'starts_at'>, slot: number, own?: { starts_at: string | null; ends_at: string | null } | null): { start: string; end: string } {
  if (own?.starts_at && own.ends_at) return { start: formatTime(own.starts_at), end: formatTime(own.ends_at) };
  return sessionTimes(t, slot);
}

/** "19 Eylül Cumartesi 20:00" — when the RSVP window closes. */
export const deadlineLabel = (t: Pick<TrainingLike, 'rsvp_deadline'>): string =>
  `${formatDayMonth(t.rsvp_deadline)} ${formatTime(t.rsvp_deadline)}`;

/** Start and end ("08:00", "09:00") of one 1-hour session (0-based index) of the training. */
export function sessionTimes(t: Pick<TrainingLike, 'starts_at'>, index: number): { start: string; end: string } {
  const start = new Date(new Date(t.starts_at).getTime() + index * HOUR_MS);
  return { start: formatTime(start), end: formatTime(new Date(start.getTime() + HOUR_MS)) };
}

/** "08:00–09:00" for one 1-hour session (0-based index) of the training. */
export function sessionRangeLabel(t: Pick<TrainingLike, 'starts_at'>, index: number): string {
  const { start, end } = sessionTimes(t, index);
  return `${start}–${end}`;
}

/** "1 seans" / "2 seans" (a session is one hour). */
export const sessionCountLabel = (n: number): string => `${n} seans`;

/** Start time of every 1-hour session, in order (used by the boat program in Phase 3). */
export function sessionStarts(t: Pick<TrainingLike, 'starts_at' | 'slot_count'>): Date[] {
  const first = new Date(t.starts_at).getTime();
  return Array.from({ length: t.slot_count }, (_, i) => new Date(first + i * HOUR_MS));
}

export type RsvpWindow =
  | { kind: 'open'; msLeft: number }
  /** No more changes: the deadline passed, or the coach published the program (whichever came first). */
  | { kind: 'locked'; reason: 'deadline' | 'program' }
  | { kind: 'cancelled' }
  | { kind: 'completed' };

/**
 * Whether a member may still answer. `now` should be SERVER-adjusted time (see clock.ts).
 * Publishing the program locks the answers even before the deadline (the database enforces it too).
 */
export function rsvpWindow(t: Pick<TrainingLike, 'status' | 'rsvp_deadline'>, now: Date, programPublished = false): RsvpWindow {
  if (t.status === 'cancelled') return { kind: 'cancelled' };
  if (t.status === 'completed') return { kind: 'completed' };
  const msLeft = new Date(t.rsvp_deadline).getTime() - now.getTime();
  if (msLeft <= 0) return { kind: 'locked', reason: 'deadline' };
  return programPublished ? { kind: 'locked', reason: 'program' } : { kind: 'open', msLeft };
}

/** "2 gün 3 sa kaldı" / "5 sa 20 dk kaldı" / "45 dk kaldı" / "Süre doldu". */
export function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return 'Süre doldu';
  const totalMinutes = Math.floor(msLeft / 60_000);
  if (totalMinutes < 1) return '1 dakikadan az kaldı';
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days >= 1) return hours > 0 ? `${days} gün ${hours} sa kaldı` : `${days} gün kaldı`;
  if (hours >= 1) return minutes > 0 ? `${hours} sa ${minutes} dk kaldı` : `${hours} sa kaldı`;
  return `${minutes} dk kaldı`;
}

export interface Partitioned<T> {
  /** Not over yet, soonest first. */
  upcoming: T[];
  /** Already over, most recent first. */
  past: T[];
}

/** Splits trainings into upcoming (end time still ahead) and past. Cancelled ones stay in the list they belong to by time. */
export function partitionTrainings<T extends Span>(list: T[], now: Date): Partitioned<T> {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const training of list) (endsAt(training) > now ? upcoming : past).push(training);
  upcoming.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  past.sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return { upcoming, past };
}

export type RsvpAnswer = 'attending' | 'not_attending';

export interface RosterMember {
  id: string;
  full_name: string;
}

export interface ResponseLike {
  member_id: string;
  response: RsvpAnswer;
  note?: string | null;
  set_by_coach?: boolean;
}

export interface RosterGroups<M extends RosterMember, R extends ResponseLike> {
  attending: Array<{ member: M; response: R }>;
  notAttending: Array<{ member: M; response: R }>;
  noResponse: M[];
}

/**
 * Groups the active members by their answer. Answers from people who are no longer in the roster
 * (deactivated) are ignored, so the counts always add up to the roster size.
 */
export function groupRoster<M extends RosterMember, R extends ResponseLike>(members: M[], responses: R[]): RosterGroups<M, R> {
  const byMember = new Map(responses.map((r) => [r.member_id, r]));
  const groups: RosterGroups<M, R> = { attending: [], notAttending: [], noResponse: [] };
  const sorted = [...members].sort((a, b) => a.full_name.localeCompare(b.full_name, 'tr'));
  for (const member of sorted) {
    const response = byMember.get(member.id);
    if (!response) groups.noResponse.push(member);
    else if (response.response === 'attending') groups.attending.push({ member, response });
    else groups.notAttending.push({ member, response });
  }
  return groups;
}
