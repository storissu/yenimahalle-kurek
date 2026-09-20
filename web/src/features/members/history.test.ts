import { describe, expect, it } from 'vitest';
import type { SharedHistoryRow } from '@/types/database';
import { groupByTraining, summarizeHistory } from './history';

const row = (training: string, startsAt: string, slot: number, boat: string, title: string | null = `Antrenman ${training}`): SharedHistoryRow => ({
  training_id: training,
  starts_at: startsAt,
  title,
  slot_index: slot,
  boat_id: `id-${boat}`,
  boat_name: boat,
  session_starts_at: null,
  session_ends_at: null,
});

// as the server sends them: newest training first, sessions of one training in slot order (but do not rely on it)
const rows = [row('t2', '2026-09-22T05:00:00Z', 1, 'Mavi'), row('t2', '2026-09-22T05:00:00Z', 0, 'Turuncu'), row('t1', '2026-09-15T05:00:00Z', 0, 'Mavi'), row('t0', '2026-09-08T05:00:00Z', 2, 'Çelik', null)];

describe('groupByTraining', () => {
  it('makes one entry per training, newest first, with its shared sessions in time order', () => {
    const days = groupByTraining(rows);
    expect(days.map((d) => d.trainingId)).toEqual(['t2', 't1', 't0']);
    expect(days[0]?.sessions).toEqual([
      { slotIndex: 0, boatId: 'id-Turuncu', boatName: 'Turuncu', startsAt: null, endsAt: null },
      { slotIndex: 1, boatId: 'id-Mavi', boatName: 'Mavi', startsAt: null, endsAt: null },
    ]);
    expect(days[0]).toMatchObject({ startsAt: '2026-09-22T05:00:00Z', title: 'Antrenman t2' });
    expect(days[2]?.title).toBeNull(); // an untitled training stays untitled
  });

  it('is empty for no history', () => {
    expect(groupByTraining([])).toEqual([]);
  });
});

describe('summarizeHistory', () => {
  it('counts sessions and training days, and how often each boat was shared (most first, ties in Turkish order)', () => {
    expect(summarizeHistory(rows)).toEqual({
      sessions: 4,
      days: 3,
      boats: [
        { name: 'Mavi', count: 2 },
        { name: 'Çelik', count: 1 },
        { name: 'Turuncu', count: 1 },
      ],
    });
  });

  it('has nothing to say for no history', () => {
    expect(summarizeHistory([])).toEqual({ sessions: 0, days: 0, boats: [] });
  });
});
