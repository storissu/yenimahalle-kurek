import { describe, expect, it } from 'vitest';
import { addSession, analyzeDraft, canAddSession, conflictFor, draftFromProgram, durationLabel, emptyDraft, fromMinutes, fullCrewProblems, hasAnyCrew, isSameDraft, isTime, moveTeam, nextSessionId, normalize, payloadAsJson, removeMember, removeSession, sessionProblems, sessionsOf, setEnd, setSessionNotes, setStart, suggestedStart, toMinutes, toPayload, toggleMember, withDefaultSessions, type ProgramData, type ProgramDraft, type SessionDraft, coxProblems, isInSession, moveMember, peopleOf, setCox, withoutCoxOn, memberSessions, sessionById } from './model';

const MAVI = 'mavi';
const TURUNCU = 'turuncu';
const C4X = 'c4x';

const session = (id: number, boatId: string, start: string, end: string, crew: string[] = [], notes = '', cox: string | null = null): SessionDraft => ({ id, boatId, start, end, crew, cox, notes });
const draftOf = (...sessions: SessionDraft[]): ProgramDraft => ({ ...emptyDraft(), sessions });
const times = (draft: ProgramDraft, boatId: string) => sessionsOf(draft, boatId).map((s) => `${s.start}–${s.end}`);

describe('clock arithmetic', () => {
  it('converts "HH:MM" to minutes and back, never leaving the day', () => {
    expect(toMinutes('08:15')).toBe(495);
    expect(fromMinutes(495)).toBe('08:15');
    expect(fromMinutes(-30)).toBe('00:00');
    expect(fromMinutes(24 * 60 + 30)).toBe('23:59');
    expect(Number.isNaN(toMinutes('8:15'))).toBe(true);
    expect(isTime('23:59')).toBe(true);
    expect(isTime('24:00')).toBe(false);
    expect(isTime('')).toBe(false);
  });

  it('describes a duration in words: 1 sa, 1 sa 15 dk, 45 dk', () => {
    expect(durationLabel('08:00', '09:00')).toBe('1 sa');
    expect(durationLabel('08:00', '09:15')).toBe('1 sa 15 dk');
    expect(durationLabel('10:30', '11:15')).toBe('45 dk');
    expect(durationLabel('09:00', '08:00')).toBe('');
  });
});

describe('every boat has its own sequence of sessions', () => {
  it('starts a boat at its first time, one hour long, and continues each next session where the previous ended', () => {
    let draft = emptyDraft();
    draft = addSession(draft, MAVI, '08:00').draft;
    draft = addSession(draft, MAVI, '08:00').draft;
    draft = addSession(draft, MAVI, '08:00').draft;
    expect(times(draft, MAVI)).toEqual(['08:00–09:00', '09:00–10:00', '10:00–11:00']);
  });

  it('gives every boat its own, unrelated schedule (08:00, 08:15, 08:30) — adding to one never touches another', () => {
    let draft = withDefaultSessions(emptyDraft(), [MAVI, TURUNCU, C4X], '08:00');
    draft = setStart(draft, sessionsOf(draft, TURUNCU)[0]!.id, '08:15');
    draft = setStart(draft, sessionsOf(draft, C4X)[0]!.id, '08:30');
    draft = addSession(draft, MAVI, '08:00').draft;
    draft = addSession(draft, TURUNCU, '08:00').draft;
    draft = addSession(draft, C4X, '08:00').draft;
    expect(times(draft, MAVI)).toEqual(['08:00–09:00', '09:00–10:00']);
    expect(times(draft, TURUNCU)).toEqual(['08:15–09:15', '09:15–10:15']);
    expect(times(draft, C4X)).toEqual(['08:30–09:30', '09:30–10:30']);
  });

  it('numbers new sessions above everything in the draft and above the training\'s bound (attendance may use them)', () => {
    const draft = draftOf(session(3, MAVI, '08:00', '09:00'));
    expect(nextSessionId(draft)).toBe(4);
    expect(nextSessionId(draft, 9)).toBe(9);
    expect(addSession(draft, TURUNCU, '08:00', 9).id).toBe(9);
    expect(nextSessionId(emptyDraft())).toBe(0);
  });

  it('suggests the next start from the boat\'s LAST end, also after a custom length or a gap', () => {
    const draft = draftOf(session(0, MAVI, '08:00', '09:15'), session(1, MAVI, '10:30', '11:00'), session(2, TURUNCU, '08:00', '12:00'));
    expect(suggestedStart(draft, MAVI, '08:00')).toBe('11:00');
    expect(suggestedStart(draft, C4X, '08:30')).toBe('08:30'); // no sessions yet: the boat's first start
  });

  it('cannot add another session at the very end of the day, or beyond the maximum', () => {
    expect(canAddSession(draftOf(session(0, MAVI, '22:59', '23:59')), MAVI)).toBe(false);
    const many = draftOf(...Array.from({ length: 30 }, (_, i) => session(i, i % 2 ? MAVI : TURUNCU, '08:00', '09:00')));
    expect(canAddSession(many, C4X)).toBe(false);
    expect(addSession(many, C4X, '08:00')).toEqual({ draft: many, id: null });
  });

  it('gives each empty boat one default session (an hour at the training\'s start) and leaves boats that have sessions alone', () => {
    const draft = withDefaultSessions(draftOf(session(4, MAVI, '08:20', '09:20', ['a'])), [MAVI, TURUNCU], '08:00', 5);
    expect(times(draft, MAVI)).toEqual(['08:20–09:20']);
    expect(times(draft, TURUNCU)).toEqual(['08:00–09:00']);
    expect(sessionsOf(draft, TURUNCU)[0]!.id).toBe(5);
  });
});

describe('changing times', () => {
  const base = () =>
    draftOf(
      session(0, MAVI, '08:00', '09:00', ['a']),
      session(1, MAVI, '09:00', '10:00', ['b']),
      session(2, MAVI, '10:15', '11:15', ['c']), // a gap of a quarter of an hour
      session(3, TURUNCU, '08:15', '09:15', ['d']),
    );

  it('setting the FIRST session\'s start moves the whole boat, keeping every length and gap — and nothing else', () => {
    const draft = setStart(base(), 0, '08:30');
    expect(times(draft, MAVI)).toEqual(['08:30–09:30', '09:30–10:30', '10:45–11:45']);
    expect(times(draft, TURUNCU)).toEqual(['08:15–09:15']);
  });

  it('refuses to move a boat out of the day', () => {
    const late = draftOf(session(0, MAVI, '20:00', '21:00'), session(1, MAVI, '21:00', '23:30'));
    expect(setStart(late, 0, '21:00')).toBe(late); // the last session would end after midnight
  });

  it('setting a LATER session\'s start changes only that session, and repairs an end that is no longer after it', () => {
    const draft = setStart(base(), 1, '09:10');
    expect(times(draft, MAVI)).toEqual(['08:00–09:00', '09:10–10:00', '10:15–11:15']);
    // 10:30 is after the old end (10:00): the end follows to one hour after the new start
    const pushed = setStart(base(), 1, '10:30');
    expect(sessionsOf(pushed, MAVI).find((s) => s.id === 1)).toMatchObject({ start: '10:30', end: '11:30' });
    expect(sessionsOf(pushed, MAVI).find((s) => s.id === 0)).toMatchObject({ start: '08:00', end: '09:00' });
  });

  it('changing a session\'s END moves the boat\'s LATER sessions by the same amount, never earlier ones or other boats', () => {
    const longer = setEnd(base(), 0, '09:15');
    expect(times(longer, MAVI)).toEqual(['08:00–09:15', '09:15–10:15', '10:30–11:30']);
    expect(times(longer, TURUNCU)).toEqual(['08:15–09:15']);
    const shorter = setEnd(base(), 1, '09:45');
    expect(times(shorter, MAVI)).toEqual(['08:00–09:00', '09:00–09:45', '10:00–11:00']);
  });

  it('ignores a value that is not a time', () => {
    const draft = base();
    expect(setStart(draft, 0, '')).toBe(draft);
    expect(setEnd(draft, 0, '25:00')).toBe(draft);
    expect(setStart(draft, 99, '08:30')).toBe(draft);
  });

  it('removing a session leaves the others exactly where they were', () => {
    const draft = removeSession(base(), 1);
    expect(times(draft, MAVI)).toEqual(['08:00–09:00', '10:15–11:15']);
  });

  it('swaps the TEAMS of neighbouring sessions of a boat while the times stay put', () => {
    const original = base();
    const draft = moveTeam(original, 0, 1);
    expect(sessionsOf(draft, MAVI).map((s) => [s.start, s.crew[0]])).toEqual([['08:00', 'b'], ['09:00', 'a'], ['10:15', 'c']]);
    expect(sessionsOf(draft, TURUNCU)[0]!.crew).toEqual(['d']); // the other boat is not involved
    expect(moveTeam(original, 0, -1)).toBe(original); // nothing before the first
    expect(moveTeam(original, 2, 1)).toBe(original); // nothing after the last
  });
});

describe('crew', () => {
  const draft = () =>
    draftOf(
      session(0, MAVI, '08:00', '09:00', ['ali']),
      session(1, TURUNCU, '09:00', '10:00', []), // starts as Mavi's session ends
      session(2, TURUNCU, '08:30', '09:30', ['becca']),
    );

  it('adds and removes a member, and refuses a full boat', () => {
    const added = toggleMember(draft(), 0, 'john', 2);
    expect(added.draft.sessions[0]!.crew).toEqual(['ali', 'john']);
    expect(toggleMember(added.draft, 0, 'ayse', 2)).toMatchObject({ error: 'full' });
    expect(toggleMember(added.draft, 0, 'john', 2).draft.sessions[0]!.crew).toEqual(['ali']);
    expect(removeMember(added.draft, 0, 'ali').sessions[0]!.crew).toEqual(['john']);
  });

  it('lets somebody row two boats one after the other (adjacent times), but not at the same time — and says where', () => {
    expect(toggleMember(draft(), 1, 'ali', 2).draft.sessions[1]!.crew).toEqual(['ali']); // 09:00 follows 08:00–09:00
    const clash = toggleMember(draft(), 0, 'becca', 2); // Becca rows Turuncu 08:30–09:30
    expect(clash.error).toBe('elsewhere');
    expect(clash.conflict).toMatchObject({ boatId: TURUNCU, start: '08:30', end: '09:30' });
    expect(clash.draft).toEqual(draft());
  });

  it('finds a conflict only with OTHER sessions that overlap', () => {
    const d = draft();
    expect(conflictFor(d, d.sessions[0]!, 'ali')).toBeUndefined(); // his own session
    expect(conflictFor(d, d.sessions[0]!, 'becca')?.id).toBe(2);
    expect(conflictFor(d, d.sessions[1]!, 'becca')?.id).toBe(2); // 09:00–10:00 overlaps 08:30–09:30
  });

  it('keeps a session\'s note', () => {
    expect(setSessionNotes(draft(), 0, 'sprint').sessions[0]!.notes).toBe('sprint');
  });
});

describe('what is wrong with the schedule', () => {
  const kinds = (draft: ProgramDraft, start = '08:00') => [...sessionProblems(draft, start)].map(([id, list]) => `${id}:${list.map((p) => p.kind).join('+')}`);

  it('is quiet for a normal schedule, including sessions that only touch (09:00 ends, 09:00 starts)', () => {
    const draft = draftOf(session(0, MAVI, '08:00', '09:00', ['a']), session(1, MAVI, '09:00', '10:00', ['b']), session(2, TURUNCU, '08:15', '09:15', ['c']), session(3, TURUNCU, '09:15', '10:15', ['a']));
    expect(kinds(draft)).toEqual([]);
  });

  it('flags an end that is not after the start, and a session longer than eight hours', () => {
    expect(kinds(draftOf(session(0, MAVI, '09:00', '09:00')))).toEqual(['0:order']);
    expect(kinds(draftOf(session(0, MAVI, '09:00', '08:00')))).toEqual(['0:order']);
    expect(kinds(draftOf(session(0, MAVI, '08:00', '16:01')))).toEqual(['0:long']);
  });

  it('flags a session that starts before the training does (only when it has a crew)', () => {
    expect(kinds(draftOf(session(0, MAVI, '07:45', '08:45', ['a'])))).toEqual(['0:early']);
    expect(kinds(draftOf(session(0, MAVI, '07:45', '08:45', [])))).toEqual([]); // an empty session is not saved anyway
  });

  it('flags two overlapping sessions of one boat — on both', () => {
    const problems = sessionProblems(draftOf(session(0, MAVI, '08:00', '09:00', ['a']), session(1, MAVI, '08:59', '10:00', ['b'])), '08:00');
    expect([...problems.keys()].sort()).toEqual([0, 1]);
    expect(problems.get(0)![0]).toMatchObject({ kind: 'boat-overlap', other: { id: 1 } });
  });

  it('flags somebody in two boats at the same time — and names who', () => {
    const problems = sessionProblems(draftOf(session(0, MAVI, '08:00', '09:00', ['ali', 'john']), session(1, TURUNCU, '08:45', '09:45', ['ali'])), '08:00');
    expect(problems.get(1)).toEqual([expect.objectContaining({ kind: 'person-overlap', memberId: 'ali' })]);
    expect(problems.get(0)).toEqual([expect.objectContaining({ kind: 'person-overlap', memberId: 'ali' })]);
  });

  it('does not compare empty sessions with anybody', () => {
    expect(kinds(draftOf(session(0, MAVI, '08:00', '09:00', ['a']), session(1, MAVI, '08:30', '09:30', [])))).toEqual([]);
  });
});

describe('boats that must be full (C4X)', () => {
  const boats = [
    { id: MAVI, capacity: 2, requires_full_crew: false },
    { id: C4X, capacity: 4, requires_full_crew: true },
  ];

  it('flags a C4X session with the wrong number of people, per session, with its time', () => {
    const draft = draftOf(session(0, C4X, '08:30', '09:30', ['a', 'b', 'c']), session(1, C4X, '09:30', '10:30', ['a', 'b', 'c', 'd']), session(2, MAVI, '08:00', '09:00', ['x']));
    expect(fullCrewProblems(draft, boats)).toEqual([{ sessionId: 0, boatId: C4X, start: '08:30', end: '09:30', count: 3, capacity: 4 }]);
  });

  it('leaves an unused C4X alone', () => {
    expect(fullCrewProblems(draftOf(session(0, C4X, '08:30', '09:30', [])), boats)).toEqual([]);
  });
});

describe('loading and saving', () => {
  // 08:15 and 09:15 Istanbul (UTC+3) = 05:15Z and 06:15Z.
  const data: ProgramData = {
    program: { training_id: 't', status: 'draft', version: 0, weather_note: ' rüzgâr ', training_notes: null, published_at: null, published_by: null, created_at: '', updated_at: '' },
    assignments: [
      { id: 'a1', training_id: 't', slot_index: 4, boat_id: TURUNCU, notes: 'teknik', starts_at: '2026-09-22T05:15:00Z', ends_at: '2026-09-22T06:15:00Z' },
      { id: 'a2', training_id: 't', slot_index: 1, boat_id: MAVI, notes: null, starts_at: '2026-09-22T05:00:00Z', ends_at: '2026-09-22T06:15:00Z' },
      { id: 'a3', training_id: 't', slot_index: 2, boat_id: MAVI, notes: null, starts_at: '2026-09-22T06:15:00Z', ends_at: '2026-09-22T07:15:00Z' }, // nobody in it
    ],
    crew: [
      { assignment_id: 'a1', training_id: 't', slot_index: 4, member_id: 'z', seat: 2, is_cox: false },
      { assignment_id: 'a1', training_id: 't', slot_index: 4, member_id: 'y', seat: 1, is_cox: false },
      { assignment_id: 'a2', training_id: 't', slot_index: 1, member_id: 'x', seat: 1, is_cox: false },
    ],
  };

  it('builds a draft with the sessions\' own club-time "HH:MM", their numbers, seat order — and without empty sessions', () => {
    const draft = draftFromProgram(data);
    expect(draft.weatherNote).toBe('rüzgâr');
    expect(draft.sessions).toEqual([
      { id: 1, boatId: MAVI, start: '08:00', end: '09:15', crew: ['x'], cox: null, notes: '' },
      { id: 4, boatId: TURUNCU, start: '08:15', end: '09:15', crew: ['y', 'z'], cox: null, notes: 'teknik' },
    ]);
  });

  it('makes the save payload: real instants on the training\'s day, the same session numbers, only sessions with a crew', () => {
    const payload = toPayload({ ...draftFromProgram(data), sessions: [...draftFromProgram(data).sessions, session(7, C4X, '08:30', '09:30', [])] }, '2026-09-22');
    expect(payload.assignments).toEqual([
      { slot_index: 1, boat_id: MAVI, starts_at: '2026-09-22T05:00:00.000Z', ends_at: '2026-09-22T06:15:00.000Z', notes: null, crew: ['x'], cox: null },
      { slot_index: 4, boat_id: TURUNCU, starts_at: '2026-09-22T05:15:00.000Z', ends_at: '2026-09-22T06:15:00.000Z', notes: 'teknik', crew: ['y', 'z'], cox: null },
    ]);
    expect(payload.weather_note).toBe('rüzgâr');
    expect(payload.training_notes).toBeNull();
    expect(payloadAsJson(payload)).toBe(payload);
  });

  it('does not treat empty sessions or their times as a change (nothing to save)', () => {
    const saved = draftFromProgram(data);
    const withEmpty = { ...saved, sessions: [...saved.sessions, session(9, C4X, '08:45', '09:45', [])] };
    expect(isSameDraft(saved, withEmpty)).toBe(true);
    expect(isSameDraft(saved, setEnd(saved, 1, '09:30'))).toBe(false);
    expect(normalize(withEmpty).sessions).toHaveLength(2);
  });

  it('knows whether anybody is placed at all', () => {
    expect(hasAnyCrew(emptyDraft())).toBe(false);
    expect(hasAnyCrew(draftFromProgram(data))).toBe(true);
  });
});

describe('checks before publishing', () => {
  const roster = [
    { id: 'ali', name: 'Ali', answer: 'attending' as const },
    { id: 'becca', name: 'Becca', answer: 'not_attending' as const },
    { id: 'can', name: 'Can', answer: undefined },
    { id: 'deniz', name: 'Deniz', answer: 'attending' as const },
  ];

  it('lists who was forgotten, who is placed against their answer, and who did not answer', () => {
    const analysis = analyzeDraft(draftOf(session(0, MAVI, '08:00', '09:00', ['ali', 'becca']), session(1, TURUNCU, '08:15', '09:15', ['can'])), roster);
    expect(analysis).toEqual({ unassignedAttending: ['deniz'], assignedNotAttending: ['becca'], assignedNoAnswer: ['can'], peopleAssigned: 3 });
  });
});

describe('the dümenci (coxswain) and the order of the crew', () => {
  const boats = [
    { id: MAVI, capacity: 2, requires_full_crew: false, has_coxswain: false },
    { id: C4X, capacity: 4, requires_full_crew: true, has_coxswain: true },
  ];
  const four = ['a', 'b', 'c', 'd'];

  describe('order', () => {
    it('adds rowers at the end and never sorts them', () => {
      let draft = draftOf(session(0, C4X, '08:30', '09:30'));
      for (const id of ['z', 'm', 'a']) draft = toggleMember(draft, 0, id, 4).draft;
      expect(sessionById(draft, 0)?.crew).toEqual(['z', 'm', 'a']);
      expect(toPayload(draft, '2026-09-22').assignments[0]?.crew).toEqual(['z', 'm', 'a']);
    });

    it('moves a rower one place towards the front or the back, and stops at the ends', () => {
      const draft = draftOf(session(0, C4X, '08:30', '09:30', four));
      expect(sessionById(moveMember(draft, 0, 'c', -1), 0)?.crew).toEqual(['a', 'c', 'b', 'd']);
      expect(sessionById(moveMember(draft, 0, 'b', 1), 0)?.crew).toEqual(['a', 'c', 'b', 'd']);
      expect(sessionById(moveMember(draft, 0, 'a', -1), 0)?.crew).toEqual(four);
      expect(sessionById(moveMember(draft, 0, 'd', 1), 0)?.crew).toEqual(four);
      expect(sessionById(moveMember(draft, 0, 'nobody', 1), 0)?.crew).toEqual(four);
    });

    it('keeps the order through saving and loading (the seat number is the position)', () => {
      const draft = draftOf(session(0, MAVI, '08:00', '09:00', ['z', 'a']));
      const payload = toPayload(draft, '2026-09-22');
      expect(payload.assignments[0]?.crew).toEqual(['z', 'a']);
      const reloaded = draftFromProgram({
        program: null,
        assignments: [{ id: 'x1', training_id: 't', slot_index: 0, boat_id: MAVI, notes: null, starts_at: '2026-09-22T05:00:00Z', ends_at: '2026-09-22T06:00:00Z' }],
        crew: [
          { assignment_id: 'x1', training_id: 't', slot_index: 0, member_id: 'a', seat: 2, is_cox: false },
          { assignment_id: 'x1', training_id: 't', slot_index: 0, member_id: 'z', seat: 1, is_cox: false },
        ],
      });
      expect(reloaded.sessions[0]?.crew).toEqual(['z', 'a']);
    });

    it('a swap of teams takes the order and the dümenci along', () => {
      const draft = draftOf(session(0, C4X, '08:30', '09:30', ['d', 'c', 'b', 'a'], '', 'k1'), session(1, C4X, '09:30', '10:30', ['e', 'f', 'g', 'h'], '', 'k2'));
      const swapped = moveTeam(draft, 0, 1);
      expect(sessionById(swapped, 0)?.crew).toEqual(['e', 'f', 'g', 'h']);
      expect(sessionById(swapped, 0)?.cox).toBe('k2');
      expect(sessionById(swapped, 1)?.crew).toEqual(['d', 'c', 'b', 'a']);
      expect(sessionById(swapped, 1)?.cox).toBe('k1');
    });
  });

  describe('the dümenci', () => {
    it('is loaded from the crew row that is flagged, not counted among the rowers', () => {
      const draft = draftFromProgram({
        program: null,
        assignments: [{ id: 'x1', training_id: 't', slot_index: 0, boat_id: C4X, notes: null, starts_at: '2026-09-22T05:30:00Z', ends_at: '2026-09-22T06:30:00Z' }],
        crew: [
          { assignment_id: 'x1', training_id: 't', slot_index: 0, member_id: 'k', seat: null, is_cox: true },
          ...four.map((m, i) => ({ assignment_id: 'x1', training_id: 't', slot_index: 0, member_id: m, seat: i + 1, is_cox: false })),
        ],
      });
      expect(draft.sessions[0]?.crew).toEqual(four);
      expect(draft.sessions[0]?.cox).toBe('k');
      expect(peopleOf(draft.sessions[0] as SessionDraft)).toEqual([...four, 'k']);
    });

    it('is saved as its own field of the assignment', () => {
      const payload = toPayload(draftOf(session(0, C4X, '08:30', '09:30', four, '', 'k')), '2026-09-22');
      expect(payload.assignments[0]).toMatchObject({ crew: four, cox: 'k' });
      expect(toPayload(draftOf(session(0, C4X, '08:30', '09:30', four)), '2026-09-22').assignments[0]?.cox).toBeNull();
    });

    it('is chosen with setCox (a member or the coach), changed and cleared — and is not a fifth rower', () => {
      const draft = draftOf(session(0, C4X, '08:30', '09:30', four));
      const chosen = setCox(draft, 0, 'coach').draft;
      expect(sessionById(chosen, 0)?.cox).toBe('coach');
      expect(sessionById(chosen, 0)?.crew).toEqual(four); // capacity untouched
      expect(sessionById(setCox(chosen, 0, 'k').draft, 0)?.cox).toBe('k');
      expect(sessionById(setCox(chosen, 0, null).draft, 0)?.cox).toBeNull();
      expect(sessionById(setCox(chosen, 0, 'coach').draft, 0)?.cox).toBeNull(); // choosing the same person again clears it
      expect(toggleMember(chosen, 0, 'e', 4).error).toBe('full'); // four rowers is still four rowers
    });

    it('cannot be one of the rowers of the same session, in either direction', () => {
      const draft = draftOf(session(0, C4X, '08:30', '09:30', ['a', 'b', 'c'], '', 'k'));
      expect(setCox(draft, 0, 'a').error).toBe('rower');
      expect(toggleMember(draft, 0, 'k', 4).error).toBe('cox');
    });

    it('follows the "nobody is in two boats at once" rule (as a rower elsewhere or as another dümenci)', () => {
      const draft = draftOf(session(0, C4X, '08:30', '09:30', four), session(1, MAVI, '09:00', '10:00', ['x', 'y']));
      const clash = setCox(draft, 0, 'x');
      expect(clash.error).toBe('elsewhere');
      expect(clash.conflict?.boatId).toBe(MAVI);
      expect(toggleMember(setCox(draft, 0, 'k').draft, 1, 'k', 2).error).toBe('elsewhere'); // the dümenci is busy at that time
      expect(setCox(draft, 0, 'k').error).toBeUndefined();
      expect(conflictFor(setCox(draft, 0, 'k').draft, session(5, MAVI, '08:45', '09:45'), 'k')?.boatId).toBe(C4X);
    });

    it('counts as taking part: sessions of a person, the program summary and the schedule problems include the dümenci', () => {
      const draft = draftOf(session(0, C4X, '08:30', '09:30', four, '', 'k'), session(1, MAVI, '09:00', '10:00', ['x', 'k']));
      expect(memberSessions(draft, 'k').map((x) => x.id)).toEqual([0, 1]);
      expect(isInSession(draft.sessions[0] as SessionDraft, 'k')).toBe(true);
      expect(isInSession(draft.sessions[0] as SessionDraft, 'x')).toBe(false);
      expect(sessionProblems(draft, '08:00').get(0)?.some((p) => p.kind === 'person-overlap' && p.memberId === 'k')).toBe(true);
      expect(analyzeDraft(draftOf(session(0, C4X, '08:30', '09:30', four, '', 'ali')), [{ id: 'ali', name: 'Ali', answer: 'attending' }]).unassignedAttending).toEqual([]);
    });

    it('is required on boats that have one before publishing — drafts may be incomplete, other boats need none', () => {
      const draft = draftOf(session(0, C4X, '08:30', '09:30', four), session(1, C4X, '09:30', '10:30', four, '', 'k'), session(2, MAVI, '08:00', '09:00', ['x']), session(3, C4X, '11:00', '12:00'));
      expect(coxProblems(draft, boats)).toEqual([{ sessionId: 0, boatId: C4X, start: '08:30', end: '09:30' }]);
      expect(coxProblems(draftOf(session(0, C4X, '08:30', '09:30', four, '', 'k')), boats)).toEqual([]);
    });

    it('is dropped from boats that no longer have the role (the setting was switched off after saving)', () => {
      const draft = draftOf(session(0, C4X, '08:30', '09:30', four, '', 'k'), session(1, MAVI, '08:00', '09:00', ['x'], '', 'stale'));
      const cleaned = withoutCoxOn(draft, boats);
      expect(sessionById(cleaned, 0)?.cox).toBe('k');
      expect(sessionById(cleaned, 1)?.cox).toBeNull();
      expect(withoutCoxOn(cleaned, boats)).toBe(cleaned); // nothing to do: the same object
    });

    it('does not count as a change when only an empty session is involved, but a new dümenci is a change', () => {
      const saved = draftOf(session(0, C4X, '08:30', '09:30', four));
      expect(isSameDraft(saved, setCox(saved, 0, 'k').draft)).toBe(false);
    });
  });
});
