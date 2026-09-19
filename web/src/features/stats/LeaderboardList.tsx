import { Trophy } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';
import type { MonthRow } from '@/types/database';
import { isTied, sortBoard } from './leaderboard';

/** Ranked list. Equal sessions share a place ("2. eşit"); the reader's own row is highlighted and labelled "Siz". */
export function LeaderboardList({ rows, meId }: { rows: MonthRow[]; meId?: string }) {
  const sorted = sortBoard(rows);
  return (
    <ol className="flex flex-col gap-2">
      {sorted.map((row) => {
        const mine = row.member_id === meId;
        const tied = isTied(sorted, row.rank);
        return (
          <li
            key={row.member_id}
            className={cn('flex min-h-14 items-center gap-3 rounded-2xl border px-3 py-2', mine ? 'border-primary bg-primary-soft' : 'border-border bg-surface')}
          >
            <span
              role="img"
              aria-label={`${row.rank}. sıra${tied ? `, ${tr.stats.tied}` : ''}`}
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold',
                row.rank === 1 ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-fg',
              )}
            >
              {row.rank === 1 ? <Trophy aria-hidden="true" size={18} /> : row.rank}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-semibold">
                <span className="truncate">{row.full_name}</span>
                {mine && <Badge tone="primary">{tr.stats.you}</Badge>}
              </span>
              <span className="block text-xs text-muted">
                {tr.stats.daysLabel(row.training_days)}
                {tied && ` · ${tr.stats.tied}`}
              </span>
            </span>
            <span className="text-right">
              <span className="block text-xl font-extrabold leading-none">{row.sessions}</span>
              <span className="text-xs text-muted">{tr.stats.sessions}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
