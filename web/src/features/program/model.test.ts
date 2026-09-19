import { describe, expect, it } from 'vitest';
import {
  addSession,
  analyzeDraft,
  assignedInSlot,
  clearBoat,
  clearSlot,
  copySlot,
  crewOf,
  draftFromProgram,
  emptyDraft,
  fullCrewProblems,
  hasAnyCrew,
  initialSessionCount,
  isSameDraft,
  memberSlots,
  normalize,
  removeLastSession,
  removeMember,
  setBoatNotes,
  setWeatherNote,
  toggleMember,
  toPayload,
  trimTrailingEmpty,
  type ProgramDraft,
} from './model';

const MAVI = 'boat-mavi';
const TURUNCU = 'boat-turuncu';
const C4X = 'boat-c4x';
const [ALEX, ASHLEY, JOHN, JAMIE, ALI, BECCA] = ['alex', 'ashley', 'john', 'jamie', 'ali', 'becca'];

/** toggle that must succeed */
function add(draft: ProgramDraft, slot: number, boat: string, member: string, capacity = 2): ProgramDraft {
  const result = toggleMember(draft, slot, boat, member, capacity);
  expect(result.error).toBeUndefined();
  return result.draft;
}

describe('toggleMember', () => {
  it('builds the club example: Mavi 08–09 Alex+Ashley, 09–10 John+Jamie; Turuncu 08–09 Ali+Becca', () => {
    let d = emptyDraft(2);
    d = add(d, 0, MAVI, ALEX);
    d = add(d, 0, MAVI, ASHLEY);
    d = add(d, 1, MAVI, JOHN);
    d = add(d, 1, MAVI, JAMIE);
    d = add(d, 0, TURUNCU, ALI);
    d = add(d, 0, TURUNCU, BECCA);
    expect(crewOf(d, 0, MAVI)).toEqual([ALEX, ASHLEY]);
    expect(crewOf(d, 1, MAVI)).toEqual([JOHN, JAMIE]);
    expect(crewOf(d, 0, TURUNCU)).toEqual([ALI, BECCA]);
    expect(crewOf(d, 1, TURUNCU)).toEqual([]);
  });

  it('refuses a third person in a two-person boat, and leaves the draft untouched', () => {
    let d = add(add(emptyDraft(1), 0, MAVI, ALEX), 0, MAVI, ASHLEY);
    const result = toggleMember(d, 0, MAVI, JOHN, 2);
    expect(result.error).toBe('full');
    expect(result.draft).toBe(d);
    d = add(d, 0, C4X, JOHN, 4);
    expect(crewOf(d, 0, C4X)).toEqual([JOHN]);
  });

  it('refuses a member who is already in another boat in the same hour', () => {
    const d = add(emptyDraft(2), 0, MAVI, ALEX);
    const result = toggleMember(d, 0, TURUNCU, ALEX, 2);
    expect(result.error).toBe('elsewhere');
    expect(result.draft).toBe(d);
  });

  it('allows the same member in a different boat in a different hour', () => {
    let d = add(emptyDraft(2), 0, MAVI, ALEX);
    d = add(d, 1, TURUNCU, ALEX);
    expect(memberSlots(d, ALEX)).toEqual([
      { slot: 0, boatId: MAVI },
      { slot: 1, boatId: TURUNCU },
    ]);
  });

  it('toggling a member who is already in the boat takes them out again', () => {
    let d = add(add(emptyDraft(1), 0, MAVI, ALEX), 0, MAVI, ASHLEY);
    d = toggleMember(d, 0, MAVI, ALEX, 2).draft;
    expect(crewOf(d, 0, MAVI)).toEqual([ASHLEY]);
  });

  it('drops a boat from the hour when its last person leaves', () => {
    let d = add(emptyDraft(1), 0, MAVI, ALEX);
    d = toggleMember(d, 0, MAVI, ALEX, 2).draft;
    expect(d.slots[0]).toEqual([]);
    expect(hasAnyCrew(d)).toBe(false);
  });

  it('never mutates the draft it was given', () => {
    const before = add(emptyDraft(1), 0, MAVI, ALEX);
    const snapshot = JSON.stringify(before);
    toggleMember(before, 0, MAVI, ASHLEY, 2);
    removeMember(before, 0, MAVI, ALEX);
    copySlot(before, 0, 0);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('ignores an hour that does not exist', () => {
    const d = emptyDraft(1);
    expect(toggleMember(d, 5, MAVI, ALEX, 2).draft).toBe(d);
  });
});

describe('removing, clearing and copying', () => {
  const base = () => {
    let d = emptyDraft(3);
    d = add(d, 0, MAVI, ALEX);
    d = add(d, 0, MAVI, ASHLEY);
    d = add(d, 0, TURUNCU, ALI);
    d = setBoatNotes(d, 0, MAVI, 'teknik çalışma');
    return d;
  };

  it('removeMember removes only that person', () => {
    expect(crewOf(removeMember(base(), 0, MAVI, ALEX), 0, MAVI)).toEqual([ASHLEY]);
  });

  it('clearBoat and clearSlot empty a boat / the whole hour', () => {
    expect(clearBoat(base(), 0, MAVI).slots[0]?.map((e) => e.boatId)).toEqual([TURUNCU]);
    expect(clearSlot(base(), 0).slots[0]).toEqual([]);
  });

  it('copySlot copies boats, crews and notes into another hour, replacing it', () => {
    let d = base();
    d = add(d, 1, C4X, JOHN, 4); // will be replaced
    d = copySlot(d, 0, 1);
    expect(d.slots[1]?.map((e) => e.boatId).sort()).toEqual([MAVI, TURUNCU].sort());
    expect(crewOf(d, 1, MAVI)).toEqual([ALEX, ASHLEY]);
    expect(d.slots[1]?.find((e) => e.boatId === MAVI)?.notes).toBe('teknik çalışma');
    expect(crewOf(d, 1, C4X)).toEqual([]);
    expect(assignedInSlot(d, 1).get(ALI)).toBe(TURUNCU);
  });

  it('copySlot gives the copy its own arrays (editing one hour does not change the other)', () => {
    let d = copySlot(base(), 0, 1);
    d = removeMember(d, 1, MAVI, ALEX);
    expect(crewOf(d, 0, MAVI)).toEqual([ALEX, ASHLEY]);
  });

  it('copySlot skips boats that are no longer usable', () => {
    const d = copySlot(base(), 0, 1, (boat) => boat !== TURUNCU);
    expect(d.slots[1]?.map((e) => e.boatId)).toEqual([MAVI]);
  });

  it('copying an hour onto itself does nothing', () => {
    const d = base();
    expect(copySlot(d, 0, 0)).toBe(d);
  });
});

describe('payload and comparison', () => {
  it('produces the save_program payload and leaves out boats without a crew', () => {
    let d = emptyDraft(2);
    d = add(d, 1, MAVI, JOHN);
    d = add(d, 0, MAVI, ALEX);
    d = setBoatNotes(d, 0, MAVI, '  ısınma  ');
    d = setWeatherNote(d, '  batıdan rüzgâr  ');
    expect(toPayload(d)).toEqual({
      weather_note: 'batıdan rüzgâr',
      training_notes: null,
      assignments: [
        { slot_index: 0, boat_id: MAVI, notes: 'ısınma', crew: [ALEX] },
        { slot_index: 1, boat_id: MAVI, notes: null, crew: [JOHN] },
      ],
    });
  });

  it('treats an empty draft as an empty program', () => {
    expect(toPayload(emptyDraft(3))).toEqual({ weather_note: null, training_notes: null, assignments: [] });
  });

  it('compares drafts regardless of boat order or surrounding whitespace', () => {
    const a: ProgramDraft = { weatherNote: 'x', trainingNotes: '', slots: [[{ boatId: TURUNCU, crew: [ALI], notes: '' }, { boatId: MAVI, crew: [ALEX], notes: '' }]] };
    const b: ProgramDraft = { weatherNote: ' x ', trainingNotes: '', slots: [[{ boatId: MAVI, crew: [ALEX], notes: ' ' }, { boatId: TURUNCU, crew: [ALI], notes: '' }]] };
    expect(isSameDraft(a, b)).toBe(true);
    expect(isSameDraft(a, { ...b, weatherNote: 'y' })).toBe(false);
    expect(isSameDraft(a, add(a, 0, C4X, JOHN, 4))).toBe(false);
  });

  it('normalize drops empty entries', () => {
    const d: ProgramDraft = { weatherNote: '', trainingNotes: '', slots: [[{ boatId: MAVI, crew: [], notes: 'x' }]] };
    expect(normalize(d).slots[0]).toEqual([]);
  });
});

describe('draftFromProgram', () => {
  const data = {
    program: {
      training_id: 't',
      status: 'draft' as const,
      version: 0,
      weather_note: 'Sakin',
      training_notes: null,
      published_at: null,
      published_by: null,
      created_at: '',
      updated_at: '',
    },
    assignments: [
      { id: 'a1', training_id: 't', slot_index: 0, boat_id: MAVI, notes: 'not' },
      { id: 'a2', training_id: 't', slot_index: 1, boat_id: MAVI, notes: null },
      { id: 'a3', training_id: 't', slot_index: 7, boat_id: MAVI, notes: null }, // beyond the training: ignored
    ],
    crew: [
      { assignment_id: 'a1', training_id: 't', slot_index: 0, member_id: ASHLEY, seat: 2 },
      { assignment_id: 'a1', training_id: 't', slot_index: 0, member_id: ALEX, seat: 1 },
      { assignment_id: 'a2', training_id: 't', slot_index: 1, member_id: JOHN, seat: 1 },
    ],
  };

  it('rebuilds the hours with crews in seat order', () => {
    const d = draftFromProgram(data, 2);
    expect(d.weatherNote).toBe('Sakin');
    expect(crewOf(d, 0, MAVI)).toEqual([ALEX, ASHLEY]);
    expect(d.slots[0]?.[0]?.notes).toBe('not');
    expect(crewOf(d, 1, MAVI)).toEqual([JOHN]);
    expect(d.slots).toHaveLength(2);
  });

  it('round-trips through toPayload', () => {
    const d = draftFromProgram(data, 2);
    expect(toPayload(d).assignments.map((a) => `${a.slot_index}:${a.boat_id}:${a.crew.join('+')}`)).toEqual([`0:${MAVI}:${ALEX}+${ASHLEY}`, `1:${MAVI}:${JOHN}`]);
  });

  it('gives an empty draft when there is no program yet', () => {
    expect(draftFromProgram({ program: null, assignments: [], crew: [] }, 2)).toEqual(emptyDraft(2));
  });
});

describe('analyzeDraft (checks before publishing)', () => {
  const roster = [
    { id: ALEX, name: 'Alex', answer: 'attending' as const },
    { id: ASHLEY, name: 'Ashley', answer: 'attending' as const },
    { id: JOHN, name: 'John', answer: 'not_attending' as const },
    { id: JAMIE, name: 'Jamie', answer: undefined },
    { id: ALI, name: 'Ali', answer: 'attending' as const },
  ];

  it('flags attendees who row in no hour', () => {
    const d = add(emptyDraft(2), 0, MAVI, ALEX);
    const a = analyzeDraft(d, roster);
    expect(a.unassignedAttending.sort()).toEqual([ALI, ASHLEY].sort());
    expect(a.peopleAssigned).toBe(1);
  });

  it('flags people placed against their answer, and empty hours', () => {
    let d = emptyDraft(3);
    d = add(d, 0, MAVI, JOHN);
    d = add(d, 0, TURUNCU, JAMIE);
    const a = analyzeDraft(d, roster);
    expect(a.assignedNotAttending).toEqual([JOHN]);
    expect(a.assignedNoAnswer).toEqual([JAMIE]);
    expect(a.emptySlots).toEqual([1, 2]);
  });

  it('counts a person who rows in two hours once', () => {
    let d = add(emptyDraft(2), 0, MAVI, ALEX);
    d = add(d, 1, MAVI, ALEX);
    expect(analyzeDraft(d, roster).peopleAssigned).toBe(1);
  });

  it('has nothing to warn about when everyone attending is placed', () => {
    let d = emptyDraft(1);
    d = add(d, 0, C4X, ALEX, 4);
    d = add(d, 0, C4X, ASHLEY, 4);
    d = add(d, 0, C4X, ALI, 4);
    const a = analyzeDraft(d, roster);
    expect(a.unassignedAttending).toEqual([]);
    expect(a.assignedNotAttending).toEqual([]);
    expect(a.emptySlots).toEqual([]);
  });
});

describe('sessions are added while preparing the program', () => {
  it('starts from what the program already uses, at least one session', () => {
    expect(initialSessionCount({ assignments: [] }, 0)).toBe(1); // a new training: not planned yet
    expect(initialSessionCount({ assignments: [] }, 3)).toBe(3); // older training planned with three sessions
    const two = [{ slot_index: 1 }] as never;
    expect(initialSessionCount({ assignments: two }, 0)).toBe(2);
    expect(initialSessionCount({ assignments: two }, 4)).toBe(4);
  });

  it('addSession appends an empty session and never mutates the draft', () => {
    const d = emptyDraft(1);
    const next = addSession(d);
    expect(next.slots).toHaveLength(2);
    expect(d.slots).toHaveLength(1);
    expect(next.slots[1]).toEqual([]);
  });

  it('stops at 12 sessions, like the database', () => {
    let d = emptyDraft(1);
    for (let i = 0; i < 20; i++) d = addSession(d);
    expect(d.slots).toHaveLength(12);
  });

  it('removeLastSession drops the last session with its crews, but keeps at least one', () => {
    let d = add(addSession(emptyDraft(1)), 1, MAVI, ALEX);
    d = removeLastSession(d);
    expect(d.slots).toHaveLength(1);
    expect(removeLastSession(d).slots).toHaveLength(1);
  });

  it('empty sessions at the end are not a change (the training just ends earlier)', () => {
    const saved = add(emptyDraft(1), 0, MAVI, ALEX);
    const withSpare = addSession(addSession(saved));
    expect(withSpare.slots).toHaveLength(3);
    expect(isSameDraft(withSpare, saved)).toBe(true);
    expect(trimTrailingEmpty(withSpare).slots).toHaveLength(1);
  });

  it('but an empty session in the middle is kept, and a crew in a new session is a change', () => {
    const base = add(emptyDraft(1), 0, MAVI, ALEX);
    const gap = add(addSession(addSession(base)), 2, MAVI, ASHLEY);
    expect(trimTrailingEmpty(gap).slots).toHaveLength(3);
    expect(isSameDraft(gap, base)).toBe(false);
  });

  it('the save payload never depends on trailing empty sessions', () => {
    const saved = add(emptyDraft(1), 0, MAVI, ALEX);
    expect(toPayload(addSession(saved))).toEqual(toPayload(saved));
  });
});

describe('fullCrewProblems (C4X = exactly 4)', () => {
  const boats = [
    { id: MAVI, capacity: 2, requires_full_crew: false },
    { id: C4X, capacity: 4, requires_full_crew: true },
  ];
  const fill = (d: ProgramDraft, slot: number, boat: string, people: string[], capacity: number) => people.reduce((acc, p) => add(acc, slot, boat, p, capacity), d);

  it('is fine with exactly four in the C4X, and with any crew in boats that need not be full', () => {
    let d = fill(emptyDraft(2), 0, C4X, [ALEX, ASHLEY, JOHN, JAMIE], 4);
    d = fill(d, 1, MAVI, [ALI], 2);
    expect(fullCrewProblems(d, boats)).toEqual([]);
  });

  it('reports a short C4X with its hour and head count', () => {
    const d = fill(emptyDraft(2), 1, C4X, [ALEX, ASHLEY, JOHN], 4);
    expect(fullCrewProblems(d, boats)).toEqual([{ slot: 1, boatId: C4X, count: 3, capacity: 4 }]);
  });

  it('reports every short session separately', () => {
    let d = fill(emptyDraft(2), 0, C4X, [ALEX], 4);
    d = fill(d, 1, C4X, [ASHLEY, JOHN], 4);
    expect(fullCrewProblems(d, boats).map((p) => [p.slot, p.count])).toEqual([[0, 1], [1, 2]]);
  });

  it('ignores a boat nobody is in (it is simply not used)', () => {
    expect(fullCrewProblems(emptyDraft(3), boats)).toEqual([]);
  });

  it('follows the boat setting, not its name', () => {
    const d = fill(emptyDraft(1), 0, MAVI, [ALEX], 2);
    expect(fullCrewProblems(d, [{ id: MAVI, capacity: 2, requires_full_crew: true }])).toEqual([{ slot: 0, boatId: MAVI, count: 1, capacity: 2 }]);
  });
});
