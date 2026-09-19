import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX, ClipboardCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { BackLink } from '@/components/layout/BackLink';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNow } from '@/lib/clock';
import { currentMonthKey, monthKeyOf, type MonthKey } from '@/lib/months';
import { formatDayMonth } from '@/lib/time';
import { tr } from '@/strings/tr';
import { useCoachMonthTable, useMemberAttendance } from '../attendance/hooks';
import { mySessions } from '../attendance/model';
import { fetchMembers, membersKey } from '../members/api';
import { fetchTrainingsByIds } from '../trainings/api';
import { sessionRangeLabel } from '../trainings/schedule';
import { MonthPicker } from './MonthPicker';

/** Coach: one member's attendance history, month by month. */
export function CoachMemberStatsPage() {
  const { memberId } = useParams();
  const now = useNow(60_000);
  const max = currentMonthKey(now);
  const [picked, setPicked] = useState<MonthKey | null>(null);
  const month = picked ?? max;

  const roster = useQuery({ queryKey: membersKey, queryFn: fetchMembers });
  const records = useMemberAttendance(memberId);
  const table = useCoachMonthTable(month);

  const trainingIds = useMemo(() => [...new Set((records.data ?? []).map((r) => r.training_id))].sort(), [records.data]);
  const trainings = useQuery({
    queryKey: ['trainings', 'by-ids', ...trainingIds],
    queryFn: () => fetchTrainingsByIds(trainingIds),
    enabled: trainingIds.length > 0,
  });

  const member = roster.data?.find((p) => p.id === memberId);
  const stats = table.data?.find((r) => r.member_id === memberId);

  const inMonth = useMemo(
    () =>
      (trainings.data ?? [])
        .filter((t) => t.status === 'completed' && monthKeyOf(t.starts_at) === month)
        .sort((a, b) => b.starts_at.localeCompare(a.starts_at)),
    [trainings.data, month],
  );

  const pending = roster.isPending || records.isPending || table.isPending || (trainingIds.length > 0 && trainings.isPending);
  const failed = roster.isError || records.isError || table.isError || trainings.isError;

  return (
    <>
      <BackLink to="/antrenor/istatistik">{tr.stats.memberBack}</BackLink>
      {pending && (
        <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}
      {!pending && failed && (
        <ErrorState
          message={tr.stats.loadError}
          onRetry={() => {
            void roster.refetch();
            void records.refetch();
            void table.refetch();
            void trainings.refetch();
          }}
        />
      )}
      {!pending && !failed && !member && <EmptyState icon={ClipboardCheck} title={tr.stats.memberNotFound} />}

      {!pending && !failed && member && (
        <>
          <PageHeader title={member.full_name} subtitle={`@${member.username}`} />
          <MonthPicker month={month} max={max} onChange={setPicked} />

          <Card className="mb-5 flex items-end gap-6">
            <p>
              <span className="block text-4xl font-extrabold leading-none text-primary">{stats?.sessions ?? 0}</span>
              <span className="text-sm text-muted">{tr.stats.sessions}</span>
            </p>
            <p>
              <span className="block text-2xl font-bold leading-none">{stats?.training_days ?? 0}</span>
              <span className="text-sm text-muted">{tr.stats.trainingDays}</span>
            </p>
          </Card>

          <section aria-labelledby="member-history-heading" className="flex flex-col gap-3">
            <h2 id="member-history-heading" className="text-sm font-bold text-muted">
              {tr.stats.memberHistory}
            </h2>
            {inMonth.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">{tr.stats.memberHistoryNone}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {inMonth.map((t) => {
                  const sessions = mySessions((records.data ?? []).filter((r) => r.training_id === t.id));
                  return (
                    <li key={t.id}>
                      <Card className="flex flex-col gap-2">
                        <p className="font-bold">
                          {formatDayMonth(t.starts_at)}
                          {t.title && <span className="font-medium text-muted"> · {t.title}</span>}
                        </p>
                        <ul className="flex flex-wrap gap-1.5">
                          {sessions.present.map((slot) => (
                            <li key={`p${slot}`}>
                              <Badge tone="success">
                                <CircleCheck aria-hidden="true" size={13} />
                                {sessionRangeLabel(t, slot)}
                              </Badge>
                            </li>
                          ))}
                          {sessions.absent.map((slot) => (
                            <li key={`a${slot}`}>
                              <Badge>
                                <CircleX aria-hidden="true" size={13} />
                                {sessionRangeLabel(t, slot)} · {tr.stats.hoursAbsent}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
