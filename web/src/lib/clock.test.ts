import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getServerOffsetMs, resetServerClock, serverNow, syncServerTime, useNow } from './clock';

afterEach(() => {
  resetServerClock();
  vi.useRealTimers();
});

describe('server clock', () => {
  it('starts with no offset', () => {
    expect(getServerOffsetMs()).toBe(0);
  });

  it('measures how far the phone clock is behind the server', () => {
    // Phone thinks it is 10:00:00; server says 10:05:00 (phone is 5 minutes slow). Instant round trip.
    const phone = Date.parse('2026-09-19T10:00:00Z');
    syncServerTime('2026-09-19T10:05:00Z', phone, phone);
    expect(getServerOffsetMs()).toBe(5 * 60_000);
  });

  it('splits the round-trip time evenly', () => {
    const start = Date.parse('2026-09-19T10:00:00Z');
    syncServerTime('2026-09-19T10:00:01Z', start, start + 2000); // 2 s round trip, server stamped in the middle
    expect(getServerOffsetMs()).toBe(0);
  });

  it('corrects the time the app uses for deadlines', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T10:00:00Z')); // phone clock (5 minutes fast)
    syncServerTime('2026-09-19T09:55:00Z', Date.now(), Date.now());
    expect(serverNow().toISOString()).toBe('2026-09-19T09:55:00.000Z');
    vi.advanceTimersByTime(60_000);
    expect(serverNow().toISOString()).toBe('2026-09-19T09:56:00.000Z');
  });

  it('re-renders countdowns as soon as the offset changes (not at the next timer tick)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T10:00:00Z'));
    const { result } = renderHook(() => useNow(60_000));
    expect(result.current.toISOString()).toBe('2026-09-19T10:00:00.000Z');
    act(() => syncServerTime('2026-09-19T12:00:00Z', Date.now(), Date.now())); // phone is 2 h slow
    expect(result.current.toISOString()).toBe('2026-09-19T12:00:00.000Z');
  });

  it('ignores garbage from the server', () => {
    syncServerTime('not a date', 0, 0);
    expect(getServerOffsetMs()).toBe(0);
  });
});
