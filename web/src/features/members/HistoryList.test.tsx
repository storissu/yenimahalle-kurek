import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { tr } from '@/strings/tr';
import type { MemberHistoryRow } from '@/types/database';
import { groupByTraining, summarizeHistory } from './history';
import { HistoryList } from './HistoryList';

const row = (training: string, startsAt: string, slot: number, boat: string | null, title: string | null = null): MemberHistoryRow => ({
  training_id: training,
  starts_at: startsAt,
  title,
  slot_index: slot,
  boat_id: boat ? `id-${boat}` : null,
  boat_name: boat,
  session_starts_at: null,
  session_ends_at: null,
});

// 08:00 Istanbul on 22 Sep 2026: two sessions (Mavi, then no boat known); 08:00 on 15 Sep: one session on the C4X.
const rows = [row('t2', '2026-09-22T05:00:00Z', 0, 'Mavi', 'Salı antrenmanı'), row('t2', '2026-09-22T05:00:00Z', 1, null), row('t1', '2026-09-15T05:00:00Z', 0, 'C4X')];
const empty = { title: 'Boş başlık', body: 'Boş içerik' };

describe('history with sessions that have no boat', () => {
  it('groups them like any other session, with the boat left empty', () => {
    const days = groupByTraining(rows);
    expect(days[0]?.sessions).toEqual([
      { slotIndex: 0, boatId: 'id-Mavi', boatName: 'Mavi', startsAt: null, endsAt: null },
      { slotIndex: 1, boatId: null, boatName: null, startsAt: null, endsAt: null },
    ]);
  });

  it('counts every session but only tallies boats that are known', () => {
    expect(summarizeHistory(rows)).toEqual({
      sessions: 3,
      days: 2,
      boats: [
        { name: 'C4X', count: 1 },
        { name: 'Mavi', count: 1 },
      ],
    });
  });
});

describe('history with sessions of their own time', () => {
  // Turuncu's session started a quarter past eight and lasted an hour and a half; Mavi's at 09:00 for an hour.
  const timed = [
    { ...row('t3', '2026-09-22T05:00:00Z', 5, 'Mavi'), session_starts_at: '2026-09-22T06:00:00Z', session_ends_at: '2026-09-22T07:00:00Z' },
    { ...row('t3', '2026-09-22T05:00:00Z', 2, 'Turuncu'), session_starts_at: '2026-09-22T05:15:00Z', session_ends_at: '2026-09-22T06:45:00Z' },
  ];

  it('orders a day\'s sessions by their own time, not by their number', () => {
    expect(groupByTraining(timed)[0]?.sessions.map((s) => s.boatName)).toEqual(['Turuncu', 'Mavi']);
  });

  it('shows each session at its own time; older rows without one fall back to the hourly grid', () => {
    render(<HistoryList rows={[...timed, row('t9', '2026-09-01T05:00:00Z', 1, 'Mavi')]} capacityOf={() => 2} limit={200} empty={empty} />);
    expect(screen.getByText('08:15–09:45')).toBeInTheDocument();
    // Mavi's own 09:00–10:00, and the older row without a time (slot 1 = the training's start + 1 hour = 09:00–10:00)
    expect(screen.getAllByText('09:00–10:00')).toHaveLength(2);
  });
});

describe('HistoryList', () => {
  const show = (over: Partial<Parameters<typeof HistoryList>[0]> = {}) => render(<HistoryList rows={rows} capacityOf={(id) => (id === 'id-C4X' ? 4 : 2)} limit={200} empty={empty} {...over} />);

  it('shows a one-line summary, then a card per training day with each session\'s time and boat', () => {
    show();
    expect(screen.getByText(tr.person.summary(3, 2))).toBeInTheDocument();
    const days = screen.getAllByRole('listitem').filter((li) => li.querySelector('ul'));
    expect(days).toHaveLength(2);
    expect(within(days[0] as HTMLElement).getByText('Salı antrenmanı')).toBeInTheDocument();
    expect(within(days[0] as HTMLElement).getByText('08:00–09:00')).toBeInTheDocument();
    expect(within(days[0] as HTMLElement).getByText('Mavi')).toBeInTheDocument();
    expect(within(days[0] as HTMLElement).getByText('09:00–10:00')).toBeInTheDocument(); // no boat known: just the time
    expect(within(days[1] as HTMLElement).getByText('C4X')).toBeInTheDocument();
  });

  it('draws the boat icon by capacity', () => {
    const { container } = show();
    expect([...container.querySelectorAll('svg[data-boat]')].map((s) => s.getAttribute('data-boat'))).toEqual(['double', 'quad']);
  });

  it('shows the empty state instead when there is nothing, and says when the list is capped', () => {
    const { unmount } = show({ rows: [] });
    expect(screen.getByText(empty.title)).toBeInTheDocument();
    expect(screen.getByText(empty.body)).toBeInTheDocument();
    unmount();
    show({ limit: 3 });
    expect(screen.getByText(tr.person.capped(3))).toBeInTheDocument();
  });
});
