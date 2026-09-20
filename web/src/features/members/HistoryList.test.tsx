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
});

// 08:00 Istanbul on 22 Sep 2026: two sessions (Mavi, then no boat known); 08:00 on 15 Sep: one session on the C4X.
const rows = [row('t2', '2026-09-22T05:00:00Z', 0, 'Mavi', 'Salı antrenmanı'), row('t2', '2026-09-22T05:00:00Z', 1, null), row('t1', '2026-09-15T05:00:00Z', 0, 'C4X')];
const empty = { title: 'Boş başlık', body: 'Boş içerik' };

describe('history with sessions that have no boat', () => {
  it('groups them like any other session, with the boat left empty', () => {
    const days = groupByTraining(rows);
    expect(days[0]?.sessions).toEqual([
      { slotIndex: 0, boatId: 'id-Mavi', boatName: 'Mavi' },
      { slotIndex: 1, boatId: null, boatName: null },
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
