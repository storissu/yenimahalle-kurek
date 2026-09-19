import { useQuery } from '@tanstack/react-query';
import { Phone, UsersRound } from 'lucide-react';
import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router';
import { BackLink } from '@/components/layout/BackLink';
import { PageHeader } from '@/components/layout/PageHeader';
import { BoatIcon } from '@/components/ui/BoatIcon';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/time';
import { tr } from '@/strings/tr';
import { useProfile } from '../auth/AuthProvider';
import { useBoats } from '../program/hooks';
import { sessionRangeLabel } from '../trainings/schedule';
import { fetchMemberNames, fetchSharedHistory, memberNamesKey, sharedHistoryKey } from './api';
import { telHref } from './contact';
import { groupByTraining, HISTORY_LIMIT, summarizeHistory } from './history';

/**
 * Another club member, as any member may see them: name, phone (with a "call" link) and the sessions the two of you
 * rowed in the SAME boat. Nothing else is shown or loaded (the directory only holds id, name and phone; the history
 * comes from a function that only tells about sessions the reader took part in).
 */
export function ClubMemberPage() {
  const { memberId } = useParams();
  const me = useProfile();
  const directory = useQuery({ queryKey: memberNamesKey, queryFn: fetchMemberNames, staleTime: 5 * 60_000 });
  const person = directory.data?.find((m) => m.id === memberId) ?? null;
  const isSelf = memberId === me.id;

  const history = useQuery({
    queryKey: sharedHistoryKey(memberId ?? ''),
    queryFn: () => fetchSharedHistory(memberId as string),
    enabled: person !== null && !isSelf,
  });
  const boats = useBoats();
  const capacityOf = useMemo(() => new Map((boats.data ?? []).map((b) => [b.id, b.capacity])), [boats.data]);

  const days = useMemo(() => groupByTraining(history.data ?? []), [history.data]);
  const summary = useMemo(() => summarizeHistory(history.data ?? []), [history.data]);

  if (isSelf) return <Navigate to="/uye/profil" replace />;

  const href = telHref(person?.phone);

  return (
    <>
      <BackLink to="/uye/uyeler">{tr.person.back}</BackLink>

      {directory.isPending && (
        <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-16" />
          <Skeleton className="h-32" />
        </div>
      )}
      {directory.isError && <ErrorState message={tr.person.loadError} onRetry={() => void directory.refetch()} />}
      {directory.isSuccess && !person && <EmptyState icon={UsersRound} title={tr.person.notFound} body={tr.person.notFoundBody} />}

      {person && (
        <div className="flex flex-col gap-6">
          <PageHeader title={person.full_name} />

          {href ? (
            <a
              href={href}
              aria-label={`${tr.contact.call}: ${person.full_name}, ${person.phone ?? ''}`}
              className="-mt-2 flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3"
            >
              <Phone aria-hidden="true" size={22} className="shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-muted">{tr.contact.phone}</span>
                <span className="block text-lg font-bold tabular-nums">{person.phone}</span>
              </span>
              <span className="font-semibold text-primary">{tr.contact.call}</span>
            </a>
          ) : (
            <p className="-mt-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">{tr.contact.noPhone}</p>
          )}

          <section aria-labelledby="shared-history-heading" className="flex flex-col gap-3">
            <div>
              <h2 id="shared-history-heading" className="text-lg font-bold">
                {tr.person.historyHeading}
              </h2>
              <p className="mt-1 text-sm text-muted">{tr.person.historyHint}</p>
            </div>

            {history.isPending && (
              <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            )}
            {history.isError && <ErrorState message={tr.person.loadHistoryError} onRetry={() => void history.refetch()} />}
            {history.isSuccess && history.data.length === 0 && <EmptyState icon={UsersRound} title={tr.person.emptyTitle} body={tr.person.emptyBody} />}

            {history.isSuccess && history.data.length > 0 && (
              <>
                <Card className="flex flex-col gap-2 border-primary bg-primary-soft">
                  <p className="text-xl font-extrabold text-primary">{tr.person.summary(summary.sessions, summary.days)}</p>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
                    {summary.boats.map((b) => (
                      <li key={b.name}>{tr.person.boatCount(b.name, b.count)}</li>
                    ))}
                  </ul>
                </Card>

                <ul className="flex flex-col gap-3">
                  {days.map((day) => (
                    <li key={day.trainingId} className="rounded-2xl border border-border bg-surface px-4 py-3">
                      <p className="font-bold">{formatDate(day.startsAt)}</p>
                      {day.title && <p className="text-sm text-muted">{day.title}</p>}
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {day.sessions.map((s) => (
                          <li key={s.slotIndex} className="flex flex-wrap items-center gap-x-3 text-[15px]">
                            <span className="w-28 shrink-0 font-semibold tabular-nums">{sessionRangeLabel({ starts_at: day.startsAt }, s.slotIndex)}</span>
                            <span className="inline-flex items-center gap-1.5">
                              <BoatIcon capacity={capacityOf.get(s.boatId) ?? 2} size={18} className="text-muted" />
                              {s.boatName}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
                {history.data.length >= HISTORY_LIMIT && <p className="text-center text-xs text-muted">{tr.person.capped(HISTORY_LIMIT)}</p>}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
