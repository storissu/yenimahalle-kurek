import { Trophy } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNow } from '@/lib/clock';
import { currentMonthKey, type MonthKey } from '@/lib/months';
import { tr } from '@/strings/tr';
import { useProfile } from '../auth/AuthProvider';
import { useLeaderboard, useMyMonthStats } from '../attendance/hooks';
import { LeaderboardList } from './LeaderboardList';
import { myPositionText } from './leaderboard';
import { MonthPicker } from './MonthPicker';

/** Member's "İstatistik" tab: my month + the leaderboard of the selected calendar month (club time). */
export function MemberStatsPage() {
  const me = useProfile();
  const now = useNow(60_000);
  const max = currentMonthKey(now);
  // null = "follow the current month", so the page moves on by itself when a new month starts.
  const [picked, setPicked] = useState<MonthKey | null>(null);
  const month = picked ?? max;

  const mine = useMyMonthStats(month);
  const board = useLeaderboard(month);

  return (
    <>
      <PageHeader title={tr.stats.title} />
      <MonthPicker month={month} max={max} onChange={setPicked} />

      <div className="flex flex-col gap-6">
        <section aria-labelledby="my-month-heading" className="flex flex-col gap-2">
          <h2 id="my-month-heading" className="text-sm font-bold text-muted">
            {tr.stats.mine}
          </h2>
          {mine.isPending && <Skeleton className="h-28" />}
          {mine.isError && <ErrorState message={tr.stats.loadError} onRetry={() => void mine.refetch()} />}
          {mine.isSuccess && (
            <Card className="flex flex-col gap-3 border-primary bg-primary-soft">
              <div className="flex items-end gap-6">
                <p>
                  <span className="block text-4xl font-extrabold leading-none text-primary">{mine.data?.sessions ?? 0}</span>
                  <span className="text-sm text-muted">{tr.stats.sessions}</span>
                </p>
                <p>
                  <span className="block text-2xl font-bold leading-none">{mine.data?.training_days ?? 0}</span>
                  <span className="text-sm text-muted">{tr.stats.trainingDays}</span>
                </p>
              </div>
              <p className="text-sm font-semibold">{myPositionText(mine.data)}</p>
            </Card>
          )}
        </section>

        <section aria-labelledby="leaderboard-heading" className="flex flex-col gap-3">
          <div>
            <h2 id="leaderboard-heading" className="text-lg font-bold">
              {tr.stats.leaderboard}
            </h2>
            <p className="mt-1 text-sm text-muted">{tr.stats.leaderboardHint}</p>
          </div>
          {board.isPending && (
            <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          )}
          {board.isError && <ErrorState message={tr.stats.loadError} onRetry={() => void board.refetch()} />}
          {board.isSuccess && board.data.length === 0 && (
            <EmptyState icon={Trophy} title={tr.stats.leaderboardEmptyTitle} body={tr.stats.leaderboardEmptyBody} />
          )}
          {board.isSuccess && board.data.length > 0 && <LeaderboardList rows={board.data} meId={me.id} />}
        </section>
      </div>
    </>
  );
}
