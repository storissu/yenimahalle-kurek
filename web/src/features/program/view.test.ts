import { describe, expect, it } from 'vitest';
import type { ProgramData } from './model';
import { buildByBoat, buildTimeline, isMineSession, matesLabel, myAssignments } from './view';

// The club example from the requirements.
const data: ProgramData = {
  program: null,
  assignments: [
    { id: 'a-mavi-0', training_id: 't', slot_index: 0, boat_id: 'mavi', notes: null },
    { id: 'a-mavi-1', training_id: 't', slot_index: 1, boat_id: 'mavi', notes: 'sprint' },
    { id: 'a-turuncu-0', training_id: 't', slot_index: 0, boat_id: 'turuncu', notes: null },
  ],
  crew: [
    { assignment_id: 'a-mavi-0', training_id: 't', slot_index: 0, member_id: 'ashley', seat: 2 },
    { assignment_id: 'a-mavi-0', training_id: 't', slot_index: 0, member_id: 'alex', seat: 1 },
    { assignment_id: 'a-mavi-1', training_id: 't', slot_index: 1, member_id: 'john', seat: 1 },
    { assignment_id: 'a-mavi-1', training_id: 't', slot_index: 1, member_id: 'jamie', seat: 2 },
    { assignment_id: 'a-turuncu-0', training_id: 't', slot_index: 0, member_id: 'ali', seat: 1 },
    { assignment_id: 'a-turuncu-0', training_id: 't', slot_index: 0, member_id: 'becca', seat: 2 },
  ],
};
const order = new Map([['mavi', 1], ['turuncu', 2], ['c4x', 3]]);

describe('buildTimeline', () => {
  const timeline = buildTimeline(data, 2, order);

  it('lists boats per hour in boat order, crews in seat order', () => {
    expect(timeline).toEqual([
      {
        slotIndex: 0,
        boats: [
          { boatId: 'mavi', notes: null, crew: ['alex', 'ashley'] },
          { boatId: 'turuncu', notes: null, crew: ['ali', 'becca'] },
        ],
      },
      { slotIndex: 1, boats: [{ boatId: 'mavi', notes: 'sprint', crew: ['john', 'jamie'] }] },
    ]);
  });

  it('keeps hours without any boat (as empty) and ignores rows beyond the training', () => {
    const longer = buildTimeline(data, 3, order);
    expect(longer).toHaveLength(3);
    expect(longer[2]).toEqual({ slotIndex: 2, boats: [] });
    expect(buildTimeline(data, 1, order)).toHaveLength(1);
  });

  it('is stable without boat order information', () => {
    expect(buildTimeline(data, 1)[0]?.boats.map((b) => b.boatId)).toEqual(['mavi', 'turuncu']);
  });
});

describe('myAssignments ("which boat am I in, and when?")', () => {
  const timeline = buildTimeline(data, 2, order);

  it('finds the hour, boat and crew mates of a member', () => {
    expect(myAssignments(timeline, 'jamie')).toEqual([{ slotIndex: 1, boatId: 'mavi', notes: 'sprint', mates: ['john'] }]);
    expect(myAssignments(timeline, 'ali')).toEqual([{ slotIndex: 0, boatId: 'turuncu', notes: null, mates: ['becca'] }]);
  });

  it('lists every hour for someone who rows twice, in time order', () => {
    const twice = buildTimeline(
      {
        ...data,
        crew: [
          ...data.crew,
          { assignment_id: 'a-turuncu-0', training_id: 't', slot_index: 0, member_id: 'zed', seat: 3 },
          { assignment_id: 'a-mavi-1', training_id: 't', slot_index: 1, member_id: 'zed', seat: 3 },
        ],
      },
      2,
      order,
    );
    expect(myAssignments(twice, 'zed').map((a) => `${a.slotIndex}:${a.boatId}`)).toEqual(['0:turuncu', '1:mavi']);
  });

  it('returns nothing for someone who is not in the program', () => {
    expect(myAssignments(timeline, 'nobody')).toEqual([]);
  });
});

describe('matesLabel (Turkish)', () => {
  it.each([
    [[], 'tek başına'],
    [['Jamie'], 'Jamie ile'],
    [['Jamie', 'Ali'], 'Jamie ve Ali ile'],
    [['Jamie', 'Ali', 'Becca'], 'Jamie, Ali ve Becca ile'],
  ])('%j → %s', (names, label) => {
    expect(matesLabel(names)).toBe(label);
  });
});

describe('buildByBoat', () => {
  it('groups the club example by boat: each boat with its sessions in time order and crews in seat order', () => {
    expect(buildByBoat(data, order)).toEqual([
      {
        boatId: 'mavi',
        sessions: [
          { slotIndex: 0, crew: ['alex', 'ashley'], notes: null },
          { slotIndex: 1, crew: ['john', 'jamie'], notes: 'sprint' },
        ],
      },
      { boatId: 'turuncu', sessions: [{ slotIndex: 0, crew: ['ali', 'becca'], notes: null }] },
    ]);
  });

  it('follows the club boat order, not the order of the rows', () => {
    const reversed = new Map([['mavi', 3], ['turuncu', 1]]);
    expect(buildByBoat(data, reversed).map((b) => b.boatId)).toEqual(['turuncu', 'mavi']);
  });

  it('leaves out boats that are not used, and sessions without a crew', () => {
    const withEmpty: ProgramData = { ...data, assignments: [...data.assignments, { id: 'a-c4x', training_id: 't', slot_index: 0, boat_id: 'c4x', notes: null }] };
    expect(buildByBoat(withEmpty, order).map((b) => b.boatId)).toEqual(['mavi', 'turuncu']);
  });

  it('keeps sessions with gaps (a boat resting for an hour) and sorts them by time even if stored out of order', () => {
    const gap: ProgramData = {
      program: null,
      assignments: [
        { id: 'late', training_id: 't', slot_index: 3, boat_id: 'mavi', notes: null },
        { id: 'early', training_id: 't', slot_index: 0, boat_id: 'mavi', notes: null },
      ],
      crew: [
        { assignment_id: 'late', training_id: 't', slot_index: 3, member_id: 'john', seat: 1 },
        { assignment_id: 'early', training_id: 't', slot_index: 0, member_id: 'alex', seat: 1 },
      ],
    };
    expect(buildByBoat(gap, order)[0]?.sessions.map((s) => s.slotIndex)).toEqual([0, 3]);
  });

  it('is empty for a program with no crews', () => {
    expect(buildByBoat({ program: null, assignments: [], crew: [] })).toEqual([]);
  });
});

describe('isMineSession', () => {
  it('is true only for a member who rows in that session', () => {
    expect(isMineSession({ crew: ['alex', 'ashley'] }, 'alex')).toBe(true);
    expect(isMineSession({ crew: ['alex', 'ashley'] }, 'john')).toBe(false);
    expect(isMineSession({ crew: ['alex'] }, undefined)).toBe(false);
  });
});
