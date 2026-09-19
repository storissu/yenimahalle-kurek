import { describe, expect, it } from 'vitest';
import { iconKeyFor, relativeTime, safeInternalPath } from './format';

// "Now" = 19 Sep 2026, 15:00 in Istanbul (12:00Z).
const NOW = new Date('2026-09-19T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('relativeTime (Turkish, club time)', () => {
  it('says "az önce" for the last minute and for slightly-future timestamps (clock differences)', () => {
    expect(relativeTime(ago(20_000), NOW)).toBe('az önce');
    expect(relativeTime(ago(-5_000), NOW)).toBe('az önce');
  });

  it('counts minutes within the hour and hours within the same day', () => {
    expect(relativeTime(ago(5 * MIN), NOW)).toBe('5 dk önce');
    expect(relativeTime(ago(59 * MIN), NOW)).toBe('59 dk önce');
    expect(relativeTime(ago(3 * HOUR), NOW)).toBe('3 sa önce');
  });

  it('names yesterday with its time (in club time), even when it was fewer than 24 hours ago', () => {
    expect(relativeTime('2026-09-18T15:30:00Z', NOW)).toBe('Dün 18:30');
    // 00:30 today in Istanbul is "today" (14 h ago), although it is still the 18th in UTC
    expect(relativeTime('2026-09-18T21:30:00Z', NOW)).toBe('14 sa önce');
  });

  it('falls back to the short date for older messages', () => {
    expect(relativeTime('2026-09-10T08:00:00Z', NOW)).toBe('10 Eyl');
  });
});

describe('iconKeyFor', () => {
  it('groups notification types into a few icons', () => {
    expect(iconKeyFor('training_new')).toBe('calendar-plus');
    expect(iconKeyFor('training_changed')).toBe('calendar-clock');
    expect(iconKeyFor('training_cancelled')).toBe('calendar-x');
    expect(iconKeyFor('deadline_reminder')).toBe('clock');
    expect(iconKeyFor('deadline_summary')).toBe('clock');
    expect(iconKeyFor('program_published')).toBe('ship');
    expect(iconKeyFor('program_updated')).toBe('ship');
  });
});

describe('safeInternalPath', () => {
  it('keeps in-app paths and refuses everything that could leave the app', () => {
    expect(safeInternalPath('/uye/antrenmanlar/abc')).toBe('/uye/antrenmanlar/abc');
    for (const bad of ['https://evil.example', '//evil.example', 'javascript:alert(1)', '']) expect(safeInternalPath(bad)).toBe('/');
  });
});
