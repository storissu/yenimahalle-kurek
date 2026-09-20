import { describe, expect, it } from 'vitest';
import type { ProgramData } from './model';
import { buildByBoat, isMineSession, matesLabel, myAssignments, summarizeProgram } from './view';

// 08:00 Istanbul = 05:00Z. Every boat has its own schedule: Mavi from 08:00, Turuncu from 08:15.
const at = (hhmm: string) => `2026-09-22T${String(Number(hhmm.slice(0, 2)) - 3).padStart(2, '0')}:${hhmm.slice(3)}:00Z`;
const asg = (id: string, slot: number, boat: string, from: string, to: string, notes: string | null = null) => ({
  id,
  training_id: 't',
  slot_index: slot,
  boat_id: boat,
  notes,
  starts_at: at(from),
  ends_at: at(to),
});
const crew = (assignment: string, slot: number, member: string, seat: number | null, isCox = false) => ({ assignment_id: assignment, training_id: 't', slot_index: slot, member_id: member, seat, is_cox: isCox });

const data: ProgramData = {
  program: null,
  assignments: [
    asg('m1', 1, 'mavi', '09:00', '10:00', 'sprint'), // listed out of order on purpose
    asg('m0', 0, 'mavi', '08:00', '09:00'),
    asg('t0', 2, 'turuncu', '08:15', '09:15'),
    asg('t1', 3, 'turuncu', '09:15', '10:15'),
    asg('empty', 4, 'c4x', '08:30', '09:30'), // nobody in it: not part of the program
  ],
  crew: [
    crew('m0', 0, 'ashley', 2),
    crew('m0', 0, 'alex', 1),
    crew('m1', 1, 'john', 1),
    crew('m1', 1, 'jamie', 2),
    crew('t0', 2, 'ali', 1),
    crew('t0', 2, 'becca', 2),
    crew('t1', 3, 'ali', 1),
    crew('t1', 3, 'deniz', 2),
  ],
};
const order = new Map([['mavi', 1], ['turuncu', 2], ['c4x', 3]]);

describe('buildByBoat (each boat with its OWN schedule)', () => {
  const boats = buildByBoat(data, order);
  const span = (s: { startsAt: string; endsAt: string }) => `${s.startsAt.slice(11, 16)}–${s.endsAt.slice(11, 16)}`;

  it('lists the boats in club order, each with its sessions in time order and its own times', () => {
    expect(boats.map((b) => b.boatId)).toEqual(['mavi', 'turuncu']);
    expect(boats[0]?.sessions.map(span)).toEqual(['05:00–06:00', '06:00–07:00']); // 08:00–09:00, 09:00–10:00
    expect(boats[1]?.sessions.map(span)).toEqual(['05:15–06:15', '06:15–07:15']); // 08:15–09:15, 09:15–10:15
  });

  it('puts the crew in seat order and keeps the note of a session', () => {
    expect(boats[0]?.sessions[0]).toMatchObject({ slotIndex: 0, crew: ['alex', 'ashley'], notes: null });
    expect(boats[0]?.sessions[1]).toMatchObject({ slotIndex: 1, crew: ['john', 'jamie'], notes: 'sprint' });
  });

  it('leaves out boats and sessions nobody rows in', () => {
    expect(boats.some((b) => b.boatId === 'c4x')).toBe(false);
  });

  it('is stable without boat order information', () => {
    expect(buildByBoat(data).map((b) => b.boatId)).toEqual(['mavi', 'turuncu']);
  });

  it('is empty for an empty program', () => {
    expect(buildByBoat({ program: null, assignments: [], crew: [] })).toEqual([]);
  });
});

describe('myAssignments ("which boat am I in, and when?")', () => {
  it('finds each session of a member with its boat, ITS OWN times and the crew mates', () => {
    expect(myAssignments(data, 'jamie')).toEqual([
      { slotIndex: 1, boatId: 'mavi', startsAt: at('09:00'), endsAt: at('10:00'), notes: 'sprint', mates: ['john'], cox: null, iAmCox: false, seat: 2 },
    ]);
    expect(myAssignments(data, 'becca')).toEqual([
      { slotIndex: 2, boatId: 'turuncu', startsAt: at('08:15'), endsAt: at('09:15'), notes: null, mates: ['ali'], cox: null, iAmCox: false, seat: 2 },
    ]);
  });

  it('lists every session for someone who rows twice, in TIME order', () => {
    const ali = myAssignments(data, 'ali');
    expect(ali.map((a) => [a.boatId, a.startsAt.slice(11, 16), a.mates])).toEqual([
      ['turuncu', '05:15', ['becca']],
      ['turuncu', '06:15', ['deniz']],
    ]);
  });

  it('works when somebody rows two different boats one after the other', () => {
    const relay: ProgramData = {
      program: null,
      assignments: [asg('a', 5, 'mavi', '08:00', '09:00'), asg('b', 2, 'turuncu', '09:00', '10:00')],
      crew: [crew('a', 5, 'ali', 1), crew('b', 2, 'ali', 1)],
    };
    expect(myAssignments(relay, 'ali').map((a) => a.boatId)).toEqual(['mavi', 'turuncu']); // by time, not by session number
  });

  it('is empty for somebody who is in no boat', () => {
    expect(myAssignments(data, 'nobody')).toEqual([]);
  });

  it('recognises my own session in a boat schedule', () => {
    const [mavi] = buildByBoat(data, order);
    expect(isMineSession(mavi!.sessions[0]!, 'alex')).toBe(true);
    expect(isMineSession(mavi!.sessions[1]!, 'alex')).toBe(false);
    expect(isMineSession(mavi!.sessions[0]!, undefined)).toBe(false);
  });
});

describe('summarizeProgram', () => {
  it('counts the sessions with a crew, the boats that carry one and the different people', () => {
    expect(summarizeProgram(data)).toEqual({ sessions: 4, boats: 2, people: 7 });
    expect(summarizeProgram({ program: null, assignments: [], crew: [] })).toEqual({ sessions: 0, boats: 0, people: 0 });
  });
});

describe('matesLabel', () => {
  it('reads naturally in Turkish for one, two, three and nobody', () => {
    expect(matesLabel([])).toBe('tek başına');
    expect(matesLabel(['Jamie'])).toBe('Jamie ile');
    expect(matesLabel(['Jamie', 'Ali'])).toBe('Jamie ve Ali ile');
    expect(matesLabel(['Jamie', 'Ali', 'Becca'])).toBe('Jamie, Ali ve Becca ile');
  });
});

describe('the dümenci (coxswain) and the seating order', () => {
  // a C4X with the rowers deliberately NOT in alphabetical order, and a coach steering
  const quad: ProgramData = {
    program: null,
    assignments: [asg('q', 6, 'c4x', '08:30', '09:30')],
    crew: [
      crew('q', 6, 'coach', null, true),
      crew('q', 6, 'zeynep', 3),
      crew('q', 6, 'ali', 4),
      crew('q', 6, 'mert', 1),
      crew('q', 6, 'bora', 2),
    ],
  };

  it('keeps the rowers in the order of their seats — never alphabetical — and lists the dümenci apart', () => {
    const session = buildByBoat(quad, order)[0]?.sessions[0];
    expect(session?.crew).toEqual(['mert', 'bora', 'zeynep', 'ali']);
    expect(session?.cox).toBe('coach');
  });

  it('a session without a dümenci says null, and a dümenci alone does not make a session', () => {
    expect(buildByBoat(data, order)[0]?.sessions[0]?.cox).toBeNull();
    const onlyCox: ProgramData = { program: null, assignments: [asg('q', 6, 'c4x', '08:30', '09:30')], crew: [crew('q', 6, 'coach', null, true)] };
    expect(buildByBoat(onlyCox, order)).toEqual([]);
  });

  it('the dümenci takes part: the session is theirs (also when it is a coach), the rowers stay theirs', () => {
    const session = buildByBoat(quad, order)[0]?.sessions[0] as NonNullable<ReturnType<typeof buildByBoat>[0]>['sessions'][0];
    expect(isMineSession(session, 'coach')).toBe(true);
    expect(isMineSession(session, 'bora')).toBe(true);
    expect(isMineSession(session, 'stranger')).toBe(false);
  });

  it('tells a rower their seat, the other rowers in order and who steers', () => {
    const mine = myAssignments(quad, 'zeynep');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ boatId: 'c4x', mates: ['mert', 'bora', 'ali'], cox: 'coach', iAmCox: false, seat: 3 });
  });

  it('tells the dümenci that they steer: no seat, all four rowers as crew', () => {
    const mine = myAssignments(quad, 'coach');
    expect(mine[0]).toMatchObject({ mates: ['mert', 'bora', 'zeynep', 'ali'], cox: 'coach', iAmCox: true, seat: null });
  });
});
