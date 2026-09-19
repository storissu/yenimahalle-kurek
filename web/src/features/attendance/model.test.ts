import { describe, expect, it } from 'vitest';
import {
  addWalkIn,
  draftFromPlan,
  draftFromSaved,
  hasAnyRow,
  initialDraft,
  isSameDraft,
  mySessions,
  plannedFrom,
  removeWalkIn,
  rowFor,
  setAllMarks,
  setMark,
  summarize,
  toPayload,
} from './model';

const [ALEX, ASHLEY, JOHN, JAMIE, ALI] = ['alex', 'ashley', 'john', 'jamie', 'ali'];

describe('plannedFrom', () => {
  it('uses the boat crews of each session when a program exists', () => {
    expect(plannedFrom(2, [[ALEX, ASHLEY, ALI], [JOHN, JAMIE, ALI]], [ALEX, ASHLEY, JOHN, JAMIE, ALI, 'bob'])).toEqual([
      [ALEX, ASHLEY, ALI],
      [JOHN, JAMIE, ALI],
    ]);
  });

  it('falls back to everyone who said "attending" in every session when there is no program', () => {
    expect(plannedFrom(2, null, [ALEX, ALI])).toEqual([[ALEX, ALI], [ALEX, ALI]]);
    expect(plannedFrom(2, [[], []], [ALEX])).toEqual([[ALEX], [ALEX]]); // an empty program counts as none
  });

  it('gives an empty session when the program leaves an hour without crew', () => {
    expect(plannedFrom(2, [[ALEX], []], [JOHN])).toEqual([[ALEX], []]);
  });
});

describe('the first sheet', () => {
  it('starts with the whole plan marked present, none of them walk-ins', () => {
    const d = draftFromPlan([[ALEX, ASHLEY], [JOHN]]);
    expect(d.slots[0]?.map((r) => `${r.memberId}:${r.mark}:${r.walkIn}`)).toEqual(['alex:present:false', 'ashley:present:false']);
    expect(d.slots[1]?.map((r) => r.memberId)).toEqual(['john']);
  });

  it('is what initialDraft returns when nothing has been saved yet', () => {
    expect(initialDraft([], [[ALEX]])).toEqual(draftFromPlan([[ALEX]]));
  });
});

describe('a saved sheet', () => {
  const planned = [[ALEX, ASHLEY], [JOHN]];
  const saved = [
    { slot_index: 0, member_id: ALEX, status: 'present' as const, note: null },
    { slot_index: 0, member_id: ASHLEY, status: 'absent' as const, note: 'hasta' },
    { slot_index: 1, member_id: JAMIE, status: 'present' as const, note: null }, // not in the plan: a walk-in
  ];

  it('reproduces exactly what was saved (John was not saved, so he is not listed)', () => {
    const d = initialDraft(saved, planned);
    expect(d.slots[0]?.map((r) => `${r.memberId}:${r.mark}:${r.note}`)).toEqual(['alex:present:', 'ashley:absent:hasta']);
    expect(d.slots[1]?.map((r) => r.memberId)).toEqual(['jamie']);
  });

  it('marks people who were not planned as walk-ins', () => {
    const d = draftFromSaved(saved, planned);
    expect(rowFor(d, 1, JAMIE)?.walkIn).toBe(true);
    expect(rowFor(d, 0, ALEX)?.walkIn).toBe(false);
  });

  it('ignores records of sessions the sheet does not have', () => {
    expect(draftFromSaved([{ slot_index: 9, member_id: ALEX, status: 'present', note: null }], planned).slots.flat()).toEqual([]);
  });
});

describe('editing', () => {
  const base = () => draftFromPlan([[ALEX, ASHLEY], [ALEX]]);

  it('marks one person in one session without touching the others', () => {
    const d = setMark(base(), 0, ASHLEY, 'absent');
    expect(rowFor(d, 0, ASHLEY)?.mark).toBe('absent');
    expect(rowFor(d, 0, ALEX)?.mark).toBe('present');
    expect(rowFor(d, 1, ALEX)?.mark).toBe('present'); // the same person in another hour is independent
  });

  it('adds a walk-in as present, once', () => {
    let d = addWalkIn(base(), 1, JAMIE);
    expect(rowFor(d, 1, JAMIE)).toMatchObject({ mark: 'present', walkIn: true });
    const again = addWalkIn(d, 1, JAMIE);
    expect(again).toBe(d);
    expect(addWalkIn(d, 1, ALEX)).toBe(d); // already listed
    d = addWalkIn(d, 0, JAMIE);
    expect(rowFor(d, 0, JAMIE)?.walkIn).toBe(true);
  });

  it('removes walk-ins but never planned people (they are marked absent instead)', () => {
    let d = addWalkIn(base(), 0, JAMIE);
    d = removeWalkIn(d, 0, JAMIE);
    expect(rowFor(d, 0, JAMIE)).toBeUndefined();
    const same = removeWalkIn(d, 0, ALEX);
    expect(same).toBe(d);
    expect(rowFor(same, 0, ALEX)).toBeDefined();
  });

  it('marks a whole session at once', () => {
    const d = setAllMarks(base(), 0, 'absent');
    expect(d.slots[0]?.every((r) => r.mark === 'absent')).toBe(true);
    expect(d.slots[1]?.every((r) => r.mark === 'present')).toBe(true);
  });

  it('ignores edits for people or sessions that are not there', () => {
    const d = base();
    expect(setMark(d, 0, JOHN, 'absent')).toBe(d);
    expect(setMark(d, 5, ALEX, 'absent')).toBe(d);
    expect(addWalkIn(d, 5, JAMIE)).toBe(d);
  });

  it('never mutates the draft it was given', () => {
    const d = base();
    const snapshot = JSON.stringify(d);
    setMark(d, 0, ALEX, 'absent');
    addWalkIn(d, 0, JAMIE);
    setAllMarks(d, 0, 'absent');
    expect(JSON.stringify(d)).toBe(snapshot);
  });
});

describe('payload, comparison and summary', () => {
  it('produces the save_attendance rows, absences included, with trimmed notes', () => {
    let d = draftFromPlan([[ALEX, ASHLEY], []]);
    d = setMark(d, 0, ASHLEY, 'absent');
    d = addWalkIn(d, 1, JAMIE);
    expect(toPayload(d)).toEqual([
      { slot_index: 0, member_id: ALEX, status: 'present', note: null },
      { slot_index: 0, member_id: ASHLEY, status: 'absent', note: null },
      { slot_index: 1, member_id: JAMIE, status: 'present', note: null },
    ]);
  });

  it('counts present person-sessions (2 hours = 2), people and absences', () => {
    let d = draftFromPlan([[ALEX, ASHLEY, ALI], [ALEX, ALI]]);
    d = setMark(d, 0, ASHLEY, 'absent');
    expect(summarize(d)).toEqual({ sessionsPresent: 4, peoplePresent: 2, absent: 1 });
  });

  it('compares sheets regardless of row order', () => {
    const a = draftFromPlan([[ALEX, ASHLEY]]);
    const b = draftFromPlan([[ASHLEY, ALEX]]);
    expect(isSameDraft(a, b)).toBe(true);
    expect(isSameDraft(a, setMark(b, 0, ALEX, 'absent'))).toBe(false);
    expect(isSameDraft(a, addWalkIn(b, 0, JAMIE))).toBe(false);
  });

  it('knows whether anything is listed at all', () => {
    expect(hasAnyRow(draftFromPlan([[], []]))).toBe(false);
    expect(hasAnyRow(draftFromPlan([[], [ALEX]]))).toBe(true);
  });
});

describe('mySessions', () => {
  it('lists the hours a member was present and absent, in order', () => {
    expect(
      mySessions([
        { slot_index: 2, status: 'present' },
        { slot_index: 0, status: 'present' },
        { slot_index: 1, status: 'absent' },
      ]),
    ).toEqual({ present: [0, 2], absent: [1] });
  });

  it('is empty when nothing was recorded', () => {
    expect(mySessions([])).toEqual({ present: [], absent: [] });
  });
});
