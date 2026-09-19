// Response counts per training for the coach's list/dashboard. Pure, so it is easy to test.

export interface ResponseCounts {
  attending: number;
  notAttending: number;
  /** Active members who have not answered. */
  none: number;
}

/**
 * Counts answers per training against the CURRENT roster of active members: answers from people who
 * were deactivated since don't count, so attending + notAttending + none always equals the roster size.
 */
export function countResponses(
  activeMemberIds: Iterable<string>,
  rows: Array<{ training_id: string; member_id: string; response: 'attending' | 'not_attending' }>,
  trainingIds: string[],
): Map<string, ResponseCounts> {
  const active = new Set(activeMemberIds);
  const result = new Map<string, ResponseCounts>();
  for (const id of trainingIds) result.set(id, { attending: 0, notAttending: 0, none: active.size });
  const seen = new Set<string>();
  for (const row of rows) {
    const counts = result.get(row.training_id);
    const key = `${row.training_id}:${row.member_id}`;
    if (!counts || !active.has(row.member_id) || seen.has(key)) continue;
    seen.add(key);
    if (row.response === 'attending') counts.attending += 1;
    else counts.notAttending += 1;
    counts.none -= 1;
  }
  return result;
}
