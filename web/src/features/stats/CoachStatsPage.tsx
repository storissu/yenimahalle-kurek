import { ChevronRight, Download } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { Users } from 'lucide-react';
import { useNow } from '@/lib/clock';
import { saveCsv } from '@/lib/csv';
import { currentMonthKey, type MonthKey } from '@/lib/months';
import { tr } from '@/strings/tr';
import { loadExport, useCoachMonthTable } from '../attendance/hooks';
import { detailCsvRows, detailFilename, summaryCsvRows, summaryFilename } from './exports';
import { sortBoard } from './leaderboard';
import { MonthPicker } from './MonthPicker';

/** Coach's "İstatistik" tab: every active member for the month, best first, with CSV export. */
export function CoachStatsPage() {
  const toast = useToast();
  const now = useNow(60_000);
  const max = currentMonthKey(now);
  const [picked, setPicked] = useState<MonthKey | null>(null);
  const month = picked ?? max;
  const [exporting, setExporting] = useState<'summary' | 'detail' | null>(null);

  const table = useCoachMonthTable(month);
  const rows = table.data ? sortBoard(table.data) : [];
  const totalSessions = rows.reduce((sum, r) => sum + r.sessions, 0);

  const exportFile = async (kind: 'summary' | 'detail') => {
    setExporting(kind);
    try {
      const fileRows = kind === 'summary' ? summaryCsvRows(rows) : detailCsvRows(await loadExport(month));
      if (kind === 'detail' && fileRows.length <= 1) {
        toast.show(tr.stats.exportEmpty, 'info');
        return;
      }
      const outcome = await saveCsv(kind === 'summary' ? summaryFilename(month) : detailFilename(month), fileRows);
      if (outcome !== 'cancelled') toast.show(tr.stats.exported, 'success');
    } catch {
      toast.show(tr.stats.exportError, 'error');
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <PageHeader title={tr.stats.title} />
      <MonthPicker month={month} max={max} onChange={setPicked} />

      {table.isPending && (
        <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}
      {table.isError && <ErrorState message={tr.stats.loadError} onRetry={() => void table.refetch()} />}
      {table.isSuccess && rows.length === 0 && <EmptyState icon={Users} title={tr.stats.membersHeading} body={tr.stats.noMembers} />}

      {table.isSuccess && rows.length > 0 && (
        <div className="flex flex-col gap-5">
          <p className="text-sm font-semibold text-muted">{tr.stats.coachSummary(rows.filter((r) => r.sessions > 0).length, totalSessions)}</p>

          <section aria-labelledby="stats-members-heading" className="flex flex-col gap-2">
            <h2 id="stats-members-heading" className="sr-only">
              {tr.stats.membersHeading}
            </h2>
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.member_id}>
                  <Link to={`/antrenor/istatistik/${r.member_id}`} className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-extrabold">{r.rank ?? '–'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.full_name}</span>
                      <span className="block text-xs text-muted">{tr.stats.daysLabel(r.training_days)}</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-xl font-extrabold leading-none">{r.sessions}</span>
                      <span className="text-xs text-muted">{tr.stats.sessions}</span>
                    </span>
                    <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <Card className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Download aria-hidden="true" size={18} />
              {tr.stats.exportHeading}
            </h2>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" loading={exporting === 'summary'} disabled={exporting !== null} onClick={() => void exportFile('summary')}>
                {tr.stats.exportSummary}
              </Button>
              <Button variant="secondary" loading={exporting === 'detail'} disabled={exporting !== null} onClick={() => void exportFile('detail')}>
                {tr.stats.exportDetail}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
