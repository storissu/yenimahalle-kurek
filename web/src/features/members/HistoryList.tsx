import { UsersRound } from 'lucide-react';
import { useMemo } from 'react';
import { BoatIcon } from '@/components/ui/BoatIcon';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDate } from '@/lib/time';
import { tr } from '@/strings/tr';
import { sessionWindow } from '../trainings/schedule';
import { groupByTraining, summarizeHistory, type HistoryRow } from './history';

/** "08:15–09:15": the session's own time, or (older data) the hourly grid from the training's start. */
function windowLabel(trainingStart: string, s: { slotIndex: number; startsAt: string | null; endsAt: string | null }): string {
  const { start, end } = sessionWindow({ starts_at: trainingStart }, s.slotIndex, { starts_at: s.startsAt, ends_at: s.endsAt });
  return `${start}–${end}`;
}

interface HistoryListProps {
  rows: HistoryRow[];
  /** Seats of a boat, for its icon. */
  capacityOf: (boatId: string) => number;
  /** The most rows the server ever sends; the list says so when it is reached. */
  limit: number;
  empty: { title: string; body: string };
}

/**
 * A member's training history as a one-line summary plus one card per training day (newest first): the date, and for
 * every session its time and — when there was one — the boat. Used for "Birlikte" and for "Tüm antrenmanlar".
 */
export function HistoryList({ rows, capacityOf, limit, empty }: HistoryListProps) {
  const days = useMemo(() => groupByTraining(rows), [rows]);
  const summary = useMemo(() => summarizeHistory(rows), [rows]);

  if (rows.length === 0) return <EmptyState icon={UsersRound} title={empty.title} body={empty.body} />;

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-2 border-primary bg-primary-soft">
        <p className="text-xl font-extrabold text-primary">{tr.person.summary(summary.sessions, summary.days)}</p>
        {summary.boats.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
            {summary.boats.map((b) => (
              <li key={b.name}>{tr.person.boatCount(b.name, b.count)}</li>
            ))}
          </ul>
        )}
      </Card>

      <ul className="flex flex-col gap-3">
        {days.map((day) => (
          <li key={day.trainingId} className="rounded-2xl border border-border bg-surface px-4 py-3">
            <p className="font-bold">{formatDate(day.startsAt)}</p>
            {day.title && <p className="text-sm text-muted">{day.title}</p>}
            <ul className="mt-2 flex flex-col gap-1.5">
              {day.sessions.map((s) => (
                <li key={s.slotIndex} className="flex flex-wrap items-center gap-x-3 text-[15px]">
                  <span className="w-28 shrink-0 font-semibold tabular-nums">{windowLabel(day.startsAt, s)}</span>
                  {s.boatName && s.boatId && (
                    <span className="inline-flex items-center gap-1.5">
                      <BoatIcon capacity={capacityOf(s.boatId)} size={18} className="text-muted" />
                      {s.boatName}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {rows.length >= limit && <p className="text-center text-xs text-muted">{tr.person.capped(limit)}</p>}
    </div>
  );
}
