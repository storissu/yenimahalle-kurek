// The coach's attendance sheet as plain data + pure functions. Attendance is per 1-hour session:
// each session has a list of people, each marked present ("Geldi") or absent ("Gelmedi").
// It starts from the PLAN (who was in the boats, or who said "attending") so the coach only fixes
// the exceptions, and it is completely separate from the RSVP and from the program.
import type { AttendanceStatus } from '@/types/database';
import { MAX_SLOTS } from '../trainings/schedule';

export type Mark = AttendanceStatus;

export interface AttendanceRow {
  memberId: string;
  mark: Mark;
  /** Not part of the plan for this session (added by the coach, or recorded that way). */
  walkIn: boolean;
  note: string;
}

export interface AttendanceDraft {
  /** slots[i] = the people listed for session i. */
  slots: AttendanceRow[][];
}

export interface SavedRecord {
  slot_index: number;
  member_id: string;
  status: Mark;
  note: string | null;
}

/** planned[i] = member ids expected in session i (the boat crews, or everyone who said "attending"). */
export type Planned = string[][];

/**
 * Who is expected in each session:
 *   - if a program has any crew: exactly the crew of that session
 *   - otherwise: everyone who answered "attending", in every session
 */
export function plannedFrom(slotCount: number, crewBySlot: string[][] | null, attendingIds: string[]): Planned {
  const hasProgram = crewBySlot?.some((crew) => crew.length > 0) ?? false;
  return Array.from({ length: slotCount }, (_, slot) => (hasProgram ? [...(crewBySlot?.[slot] ?? [])] : [...attendingIds]));
}

/** First-time sheet: the whole plan marked present. */
export function draftFromPlan(planned: Planned): AttendanceDraft {
  return {
    slots: planned.map((ids) => ids.map((memberId) => ({ memberId, mark: 'present' as const, walkIn: false, note: '' }))),
  };
}

/** A sheet rebuilt from what was saved: exactly the saved people, with plan membership marking walk-ins. */
export function draftFromSaved(saved: SavedRecord[], planned: Planned): AttendanceDraft {
  const slots: AttendanceRow[][] = planned.map(() => []);
  for (const record of saved) {
    const slot = slots[record.slot_index];
    if (!slot) continue;
    slot.push({
      memberId: record.member_id,
      mark: record.status,
      walkIn: !(planned[record.slot_index] ?? []).includes(record.member_id),
      note: record.note ?? '',
    });
  }
  return { slots };
}

/** Saved sheet if there is one, otherwise the plan. */
export function initialDraft(saved: SavedRecord[], planned: Planned): AttendanceDraft {
  return saved.length > 0 ? draftFromSaved(saved, planned) : draftFromPlan(planned);
}

const withSlot = (draft: AttendanceDraft, slot: number, rows: AttendanceRow[]): AttendanceDraft => ({
  slots: draft.slots.map((existing, i) => (i === slot ? rows : existing)),
});

export const rowFor = (draft: AttendanceDraft, slot: number, memberId: string): AttendanceRow | undefined =>
  draft.slots[slot]?.find((r) => r.memberId === memberId);

export function setMark(draft: AttendanceDraft, slot: number, memberId: string, mark: Mark): AttendanceDraft {
  const rows = draft.slots[slot];
  if (!rows?.some((r) => r.memberId === memberId)) return draft;
  return withSlot(draft, slot, rows.map((r) => (r.memberId === memberId ? { ...r, mark } : r)));
}

/** Adds someone to a session as present. Does nothing if they are already listed there. */
export function addWalkIn(draft: AttendanceDraft, slot: number, memberId: string): AttendanceDraft {
  const rows = draft.slots[slot];
  if (!rows || rows.some((r) => r.memberId === memberId)) return draft;
  return withSlot(draft, slot, [...rows, { memberId, mark: 'present', walkIn: true, note: '' }]);
}

/** Removes a walk-in. Planned people cannot be removed (mark them "Gelmedi" instead). */
export function removeWalkIn(draft: AttendanceDraft, slot: number, memberId: string): AttendanceDraft {
  const rows = draft.slots[slot];
  const row = rows?.find((r) => r.memberId === memberId);
  if (!rows || !row?.walkIn) return draft;
  return withSlot(draft, slot, rows.filter((r) => r.memberId !== memberId));
}

/** Another session may be added while the last one has people to carry over, up to the maximum. */
export const canAddSession = (draft: AttendanceDraft): boolean =>
  draft.slots.length < MAX_SLOTS && (draft.slots[draft.slots.length - 1]?.length ?? 0) > 0;

/**
 * The training ran longer than planned: a new last session that starts from the people in the previous one, all present.
 * They are listed as walk-ins because no plan (program or answer) covers that hour; the coach can remove or mark them.
 */
export function addSession(draft: AttendanceDraft): AttendanceDraft {
  if (!canAddSession(draft)) return draft;
  const previous = draft.slots[draft.slots.length - 1] ?? [];
  return { slots: [...draft.slots, previous.map((r) => ({ memberId: r.memberId, mark: 'present' as const, walkIn: true, note: '' }))] };
}

/** Takes back sessions added in this sitting (never below `keep`, the number that already exists). */
export function removeLastSession(draft: AttendanceDraft, keep: number): AttendanceDraft {
  return draft.slots.length > Math.max(keep, 1) ? { slots: draft.slots.slice(0, -1) } : draft;
}

/** Marks everybody listed in a session at once (e.g. nobody came: all "Gelmedi"). */
export function setAllMarks(draft: AttendanceDraft, slot: number, mark: Mark): AttendanceDraft {
  const rows = draft.slots[slot];
  return rows ? withSlot(draft, slot, rows.map((r) => ({ ...r, mark }))) : draft;
}

export interface SavePayloadRow {
  slot_index: number;
  member_id: string;
  status: Mark;
  note: string | null;
}

export function toPayload(draft: AttendanceDraft): SavePayloadRow[] {
  return draft.slots.flatMap((rows, slot) =>
    rows.map((r) => ({ slot_index: slot, member_id: r.memberId, status: r.mark, note: r.note.trim() || null })),
  );
}

const canonical = (draft: AttendanceDraft) => {
  const sessions = draft.slots.map((rows) =>
    rows
      .map((r) => `${r.memberId}:${r.mark}:${r.note.trim()}`)
      .sort()
      .join('|'),
  );
  // a session without anyone at the end is nothing to save (the training is only as long as what was recorded)
  while (sessions.length > 0 && sessions[sessions.length - 1] === '') sessions.pop();
  return sessions;
};

export const isSameDraft = (a: AttendanceDraft, b: AttendanceDraft): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export interface Summary {
  /** Present person-sessions: what the statistics will count. */
  sessionsPresent: number;
  /** Different people present at least once. */
  peoplePresent: number;
  /** Listed but marked absent. */
  absent: number;
}

export function summarize(draft: AttendanceDraft): Summary {
  const people = new Set<string>();
  let sessionsPresent = 0;
  let absent = 0;
  for (const rows of draft.slots) {
    for (const r of rows) {
      if (r.mark === 'present') {
        sessionsPresent += 1;
        people.add(r.memberId);
      } else absent += 1;
    }
  }
  return { sessionsPresent, peoplePresent: people.size, absent };
}

export const hasAnyRow = (draft: AttendanceDraft): boolean => draft.slots.some((rows) => rows.length > 0);

// --- the member's own view ------------------------------------------------------------------------

export interface MySessions {
  present: number[];
  absent: number[];
}

/** Sessions (0-based) a member was present / absent in for one training. */
export function mySessions(records: Array<{ slot_index: number; status: Mark }>): MySessions {
  const sorted = [...records].sort((a, b) => a.slot_index - b.slot_index);
  return {
    present: sorted.filter((r) => r.status === 'present').map((r) => r.slot_index),
    absent: sorted.filter((r) => r.status === 'absent').map((r) => r.slot_index),
  };
}
