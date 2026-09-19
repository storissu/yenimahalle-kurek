// Server-adjusted clock. The database decides every deadline, but the app shows countdowns and
// locks buttons on the phone — whose clock is often wrong. We measure the difference once
// (and refresh it periodically) so what people SEE matches what the server will ENFORCE.
import { useEffect, useState } from 'react';

let offsetMs = 0;
const listeners = new Set<() => void>();

/** Record the server's current time (ISO). `requestedAt`/`receivedAt` are device times around the call. */
export function syncServerTime(serverIso: string, requestedAt: number, receivedAt: number): void {
  const server = new Date(serverIso).getTime();
  if (Number.isNaN(server)) return;
  // Assume the server stamped the response halfway through the round trip.
  const deviceMidpoint = (requestedAt + receivedAt) / 2;
  const next = server - deviceMidpoint;
  const changed = Math.abs(next - offsetMs) >= 1000;
  offsetMs = next;
  // Everything showing a countdown must re-render at once, not at its next timer tick.
  if (changed) listeners.forEach((listener) => listener());
}

/** Current time as the server sees it. */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** For tests. */
export function resetServerClock(): void {
  offsetMs = 0;
  listeners.clear();
}

export function getServerOffsetMs(): number {
  return offsetMs;
}

/** Re-renders every `intervalMs`, and immediately when the server offset changes. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState<Date>(() => serverNow());
  useEffect(() => {
    const update = () => setNow(serverNow());
    listeners.add(update);
    const id = window.setInterval(update, intervalMs);
    // The offset may have changed between the first render and this effect.
    update();
    return () => {
      listeners.delete(update);
      window.clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}
