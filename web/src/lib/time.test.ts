import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatTime,
  instantToWallTime,
  todayInClubZone,
  wallTimeToInstant,
} from './time';

// All expectations are in club time (Europe/Istanbul, UTC+3 year-round) no matter where the tests run.
describe('club time formatting', () => {
  it('shows the Istanbul wall-clock time for a UTC instant', () => {
    expect(formatTime('2026-09-19T05:00:00Z')).toBe('08:00');
    expect(formatTime('2026-09-19T06:00:00Z')).toBe('09:00');
  });

  it('uses 24-hour time including midnight', () => {
    expect(formatTime('2026-09-19T21:00:00Z')).toBe('00:00'); // 00:00 on the 20th in Istanbul
  });

  it('rolls the date over at Istanbul midnight, not UTC midnight', () => {
    expect(formatDate('2026-09-19T20:59:00Z')).toContain('19 Eylül 2026');
    expect(formatDate('2026-09-19T21:00:00Z')).toContain('20 Eylül 2026');
  });

  it('formats in Turkish', () => {
    const text = formatDate('2026-09-19T05:00:00Z');
    expect(text).toContain('Cumartesi');
    expect(text).toContain('Eylül');
    expect(formatDayMonth('2026-09-19T05:00:00Z')).toBe('19 Eylül Cumartesi');
  });

  it('combines date and time', () => {
    expect(formatDateTime('2026-09-19T05:00:00Z')).toMatch(/19 Eylül 2026.*08:00$/);
  });
});

describe('wall time <-> instant (club zone)', () => {
  it('turns Istanbul wall time into the right UTC instant', () => {
    expect(wallTimeToInstant('2026-09-19', '08:00').toISOString()).toBe('2026-09-19T05:00:00.000Z');
    expect(wallTimeToInstant('2026-01-05', '00:30').toISOString()).toBe('2026-01-04T21:30:00.000Z');
  });

  it('crosses midnight correctly', () => {
    expect(wallTimeToInstant('2026-09-19', '23:30').toISOString()).toBe('2026-09-19T20:30:00.000Z');
    expect(wallTimeToInstant('2026-09-20', '01:00').toISOString()).toBe('2026-09-19T22:00:00.000Z');
  });

  it('round-trips wall time', () => {
    for (const [date, time] of [['2026-09-19', '08:00'], ['2026-12-31', '23:59'], ['2027-03-01', '00:00']] as const) {
      expect(instantToWallTime(wallTimeToInstant(date, time))).toEqual({ date, time });
    }
  });

  it('reads an instant back as Istanbul wall time', () => {
    expect(instantToWallTime('2026-09-19T20:30:00Z')).toEqual({ date: '2026-09-19', time: '23:30' });
    expect(instantToWallTime('2026-09-19T21:00:00Z')).toEqual({ date: '2026-09-20', time: '00:00' });
  });

  it('rejects malformed or impossible input', () => {
    for (const [d, t] of [['', '08:00'], ['2026-09-19', ''], ['19.09.2026', '08:00'], ['2026-02-31', '08:00'], ['2026-13-01', '08:00'], ['2026-09-19', '25:00'], ['2026-09-19', '08:60']]) {
      expect(Number.isNaN(wallTimeToInstant(d as string, t as string).getTime())).toBe(true);
    }
  });

  it("tells today's date in club time, not UTC", () => {
    expect(todayInClubZone(new Date('2026-09-19T21:30:00Z'))).toBe('2026-09-20');
    expect(todayInClubZone(new Date('2026-09-19T20:30:00Z'))).toBe('2026-09-19');
  });
});
