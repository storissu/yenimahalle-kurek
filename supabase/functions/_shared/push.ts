// Decisions about pushing notifications, kept pure so they can be unit-tested.

/** What happened when one notification was sent to ONE of a user's devices. */
export type SendResult = 'ok' | 'gone' | 'retry';

export interface Outcome {
  /** The row is finished (sent, or there is nothing more to try). */
  done: boolean;
  /** Recorded in push_error for troubleshooting. */
  error: string | null;
  /** Count this run as a failed attempt. */
  countAttempt: boolean;
}

export const MAX_ATTEMPTS = 5;

/**
 * Decides what to do with a notification row after trying every device of the recipient.
 *   - no devices           → done (the in-app inbox is enough)
 *   - at least one success → done
 *   - every device is gone → done (dead subscriptions are removed separately)
 *   - otherwise            → try again next minute, and give up after MAX_ATTEMPTS
 * `attemptsSoFar` is the number of failed runs before this one.
 */
export function decideOutcome(deviceCount: number, results: SendResult[], attemptsSoFar: number): Outcome {
  if (deviceCount === 0) return { done: true, error: null, countAttempt: false };
  if (results.includes('ok')) return { done: true, error: null, countAttempt: false };
  if (results.length > 0 && results.every((r) => r === 'gone')) return { done: true, error: 'subscriptions-expired', countAttempt: false };
  const attempts = attemptsSoFar + 1;
  return attempts >= MAX_ATTEMPTS
    ? { done: true, error: 'gave-up', countAttempt: true }
    : { done: false, error: 'retry', countAttempt: true };
}

/** Web Push HTTP status → what to do with that device's subscription. */
export function classifyStatus(status: number | undefined): SendResult {
  if (status === 404 || status === 410) return 'gone';
  return 'retry';
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface OutboxRow {
  id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  training_id: string | null;
}

/**
 * The payload the service worker shows. `tag` makes a newer notification of the same kind for the same
 * training REPLACE the older one on the phone instead of piling up. Only in-app paths are allowed.
 */
export function payloadFor(row: OutboxRow): PushPayload {
  const url = row.url.startsWith('/') && !row.url.startsWith('//') ? row.url : '/';
  return { title: row.title, body: row.body, url, tag: `${row.type}:${row.training_id ?? row.id}` };
}

/** Time-sensitive messages are delivered with high urgency; everything expires after a few hours. */
export function pushOptions(type: string): { TTL: number; urgency: 'high' | 'normal' } {
  const urgent = type === 'training_cancelled' || type === 'training_changed' || type === 'deadline_reminder';
  return { TTL: 6 * 60 * 60, urgency: urgent ? 'high' : 'normal' };
}
