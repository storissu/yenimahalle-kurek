import { describe, expect, it } from 'vitest';
import {
  endsAt,
  formatCountdown,
  groupRoster,
  hasPlannedSessions,
  partitionTrainings,
  rsvpWindow,
  sessionCountLabel,
  sessionRangeLabel,
  sessionStarts,
  sessionTimes,
  timeRangeLabel,
  trainingTimeText,
  type TrainingLike,
} from './schedule';

const training = (over: Partial<TrainingLike> = {}): TrainingLike => ({
  starts_at: '2026-09-19T05:00:00Z', // 08:00 Istanbul
  slot_count: 2,
  rsvp_deadline: '2026-09-18T17:00:00Z', // 20:00 Istanbul, the evening before
  status: 'scheduled',
  ...over,
});

describe('session schedule', () => {
  it('spans slot_count one-hour sessions', () => {
    expect(endsAt(training()).toISOString()).toBe('2026-09-19T07:00:00.000Z');
    expect(timeRangeLabel(training())).toBe('08:00–10:00');
    expect(timeRangeLabel(training({ slot_count: 1 }))).toBe('08:00–09:00');
    expect(sessionCountLabel(2)).toBe('2 seans');
  });

  it('a training whose length is not planned yet (0 sessions) shows only its start and counts as one hour', () => {
    const open = training({ slot_count: 0 });
    expect(hasPlannedSessions(open)).toBe(false);
    expect(hasPlannedSessions(training())).toBe(true);
    expect(timeRangeLabel(open)).toBe('08:00');
    expect(trainingTimeText(open)).toBe('08:00 · süre program hazırlanınca belli olur');
    expect(trainingTimeText(training())).toBe('08:00–10:00');
    // the end is the end of the LAST session, whatever its length: boats have their own schedules
    expect(trainingTimeText(training({ ends_at: '2026-09-19T07:15:00Z' }))).toBe('08:00–10:15');
    expect(endsAt(training({ ends_at: '2026-09-19T07:15:00Z' })).toISOString()).toBe('2026-09-19T07:15:00.000Z');
    expect(hasPlannedSessions({ slot_count: 0, ends_at: '2026-09-19T07:15:00Z' })).toBe(true);
    expect(endsAt(open).toISOString()).toBe('2026-09-19T06:00:00.000Z'); // "is it over?" still works
  });

  it('gives the start and end of one session, and the same as one range', () => {
    expect(sessionTimes(training(), 0)).toEqual({ start: '08:00', end: '09:00' });
    expect(sessionTimes(training(), 2)).toEqual({ start: '10:00', end: '11:00' });
    expect(sessionRangeLabel(training(), 1)).toBe('09:00–10:00');
  });

  it('lists each session start', () => {
    expect(sessionStarts(training({ slot_count: 3 })).map((d) => d.toISOString())).toEqual([
      '2026-09-19T05:00:00.000Z',
      '2026-09-19T06:00:00.000Z',
      '2026-09-19T07:00:00.000Z',
    ]);
  });
});

describe('rsvpWindow', () => {
  const t = training();
  it('is open with the time left before the deadline', () => {
    expect(rsvpWindow(t, new Date('2026-09-18T16:00:00Z'))).toEqual({ kind: 'open', msLeft: 3_600_000 });
  });

  it('locks at the deadline (not one millisecond later)', () => {
    expect(rsvpWindow(t, new Date('2026-09-18T16:59:59.999Z')).kind).toBe('open');
    expect(rsvpWindow(t, new Date('2026-09-18T17:00:00Z'))).toEqual({ kind: 'locked', reason: 'deadline' });
    expect(rsvpWindow(t, new Date('2026-09-19T00:00:00Z')).kind).toBe('locked');
  });

  it('locks as soon as the program is published, even long before the deadline', () => {
    expect(rsvpWindow(t, new Date('2026-09-10T00:00:00Z'), true)).toEqual({ kind: 'locked', reason: 'program' });
    expect(rsvpWindow(t, new Date('2026-09-10T00:00:00Z'), false).kind).toBe('open');
  });

  it('says "deadline" when both reasons apply, and never reports a lock for cancelled/completed trainings', () => {
    expect(rsvpWindow(t, new Date('2026-09-19T00:00:00Z'), true)).toEqual({ kind: 'locked', reason: 'deadline' });
    expect(rsvpWindow(training({ status: 'cancelled' }), new Date('2026-09-10T00:00:00Z'), true)).toEqual({ kind: 'cancelled' });
    expect(rsvpWindow(training({ status: 'completed' }), new Date('2026-09-10T00:00:00Z'), true)).toEqual({ kind: 'completed' });
  });

  it('cancelled and completed trainings are never open, whatever the clock says', () => {
    const early = new Date('2026-09-01T00:00:00Z');
    expect(rsvpWindow(training({ status: 'cancelled' }), early)).toEqual({ kind: 'cancelled' });
    expect(rsvpWindow(training({ status: 'completed' }), early)).toEqual({ kind: 'completed' });
  });
});

describe('formatCountdown', () => {
  const min = 60_000;
  it.each([
    [-5, 'Süre doldu'],
    [0, 'Süre doldu'],
    [30_000, '1 dakikadan az kaldı'],
    [45 * min, '45 dk kaldı'],
    [60 * min, '1 sa kaldı'],
    [5 * 60 * min + 20 * min, '5 sa 20 dk kaldı'],
    [24 * 60 * min, '1 gün kaldı'],
    [2 * 24 * 60 * min + 3 * 60 * min + 10 * min, '2 gün 3 sa kaldı'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});

describe('partitionTrainings', () => {
  const now = new Date('2026-09-19T05:30:00Z'); // during the 08:00–10:00 training
  const mk = (starts_at: string, slot_count = 1) => ({ starts_at, slot_count });

  it('keeps a training that is still running in "upcoming"', () => {
    const running = mk('2026-09-19T05:00:00Z', 2);
    expect(partitionTrainings([running], now).upcoming).toEqual([running]);
  });

  it('sorts upcoming soonest-first and past most-recent-first', () => {
    const list = [mk('2026-09-25T05:00:00Z'), mk('2026-09-10T05:00:00Z'), mk('2026-09-21T05:00:00Z'), mk('2026-09-15T05:00:00Z')];
    const { upcoming, past } = partitionTrainings(list, now);
    expect(upcoming.map((t) => t.starts_at)).toEqual(['2026-09-21T05:00:00Z', '2026-09-25T05:00:00Z']);
    expect(past.map((t) => t.starts_at)).toEqual(['2026-09-15T05:00:00Z', '2026-09-10T05:00:00Z']);
  });

  it('moves a training to the past once its last session ended', () => {
    const t = mk('2026-09-19T05:00:00Z', 2); // ends 07:00Z
    expect(partitionTrainings([t], new Date('2026-09-19T07:00:00Z')).past).toEqual([t]);
    expect(partitionTrainings([t], new Date('2026-09-19T06:59:00Z')).upcoming).toEqual([t]);
  });
});

describe('groupRoster', () => {
  const members = [
    { id: 'z', full_name: 'Zeynep' },
    { id: 'c', full_name: 'Çağla' },
    { id: 'a', full_name: 'Ahmet' },
    { id: 'b', full_name: 'Berk' },
  ];
  const responses = [
    { member_id: 'z', response: 'attending' as const, note: "9'dan sonra" },
    { member_id: 'a', response: 'not_attending' as const },
    { member_id: 'gone', response: 'attending' as const }, // deactivated member: ignored
  ];

  it('splits the roster into attending / not attending / no answer', () => {
    const groups = groupRoster(members, responses);
    expect(groups.attending.map((g) => g.member.full_name)).toEqual(['Zeynep']);
    expect(groups.attending[0]?.response.note).toBe("9'dan sonra");
    expect(groups.notAttending.map((g) => g.member.full_name)).toEqual(['Ahmet']);
    expect(groups.noResponse.map((m) => m.full_name)).toEqual(['Berk', 'Çağla']); // Turkish collation
  });

  it('counts always add up to the roster size', () => {
    const g = groupRoster(members, responses);
    expect(g.attending.length + g.notAttending.length + g.noResponse.length).toBe(members.length);
  });

  it('handles an empty roster', () => {
    expect(groupRoster([], responses)).toEqual({ attending: [], notAttending: [], noResponse: [] });
  });
});
