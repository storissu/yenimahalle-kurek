import { describe, expect, it } from 'vitest';
import { currentMonthKey, isFutureMonth, isMonthKey, monthKeyOf, monthLabel, monthStartDate, shiftMonth } from './months';

describe('month keys (club time)', () => {
  it('takes the month from Istanbul time, not UTC', () => {
    expect(currentMonthKey(new Date('2026-08-31T20:59:00Z'))).toBe('2026-08');
    expect(currentMonthKey(new Date('2026-08-31T21:00:00Z'))).toBe('2026-09'); // already 1 September in Istanbul
    expect(monthKeyOf('2026-12-31T21:30:00Z')).toBe('2027-01');
  });

  it('shifts across year boundaries', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-03', -15)).toBe('2024-12');
    expect(shiftMonth('2026-09', 0)).toBe('2026-09');
  });

  it('labels months in Turkish', () => {
    expect(monthLabel('2026-09')).toBe('Eylül 2026');
    expect(monthLabel('2027-01')).toBe('Ocak 2027');
    expect(monthLabel('2026-03')).toBe('Mart 2026');
  });

  it('builds the date sent to the database', () => {
    expect(monthStartDate('2026-09')).toBe('2026-09-01');
  });

  it('knows which months are in the future', () => {
    const now = new Date('2026-09-19T10:00:00Z');
    expect(isFutureMonth('2026-10', now)).toBe(true);
    expect(isFutureMonth('2026-09', now)).toBe(false);
    expect(isFutureMonth('2025-12', now)).toBe(false);
  });

  it('validates keys and rejects bad input', () => {
    for (const ok of ['2026-01', '2026-12', '1999-07']) expect(isMonthKey(ok)).toBe(true);
    for (const bad of ['2026-13', '2026-00', '26-09', '2026-9', '2026-09-01', '']) expect(isMonthKey(bad)).toBe(false);
    expect(() => shiftMonth('nope', 1)).toThrow();
  });
});
