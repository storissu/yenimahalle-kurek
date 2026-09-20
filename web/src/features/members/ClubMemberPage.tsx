import { useQuery } from '@tanstack/react-query';
import { Phone, UsersRound } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router';
import { BackLink } from '@/components/layout/BackLink';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { tr } from '@/strings/tr';
import { useProfile } from '../auth/AuthProvider';
import { useBoats } from '../program/hooks';
import { fetchMemberHistory, fetchMemberNames, fetchSharedHistory, memberHistoryKey, memberNamesKey, sharedHistoryKey } from './api';
import { telHref } from './contact';
import { FULL_HISTORY_LIMIT, HISTORY_LIMIT } from './history';
import { HistoryList } from './HistoryList';

type HistoryTab = 'shared' | 'all';

/**
 * Another club member, as any member may see them: name, phone (with a "call" link) and their training history in two
 * tabs — "Birlikte" (the sessions the two of you rowed in the SAME boat) and "Tüm antrenmanlar" (everything they took
 * part in). Nothing else is shown or loaded (the directory only holds id, name and phone; both histories come from
 * database functions that decide what may be seen).
 */
export function ClubMemberPage() {
  const { memberId } = useParams();
  const me = useProfile();
  const tabsPrefix = useId();
  const [tab, setTab] = useState<HistoryTab>('shared');
  const directory = useQuery({ queryKey: memberNamesKey, queryFn: fetchMemberNames, staleTime: 5 * 60_000 });
  const person = directory.data?.find((m) => m.id === memberId) ?? null;
  const isSelf = memberId === me.id;

  const shared = useQuery({
    queryKey: sharedHistoryKey(memberId ?? ''),
    queryFn: () => fetchSharedHistory(memberId as string),
    enabled: person !== null && !isSelf,
  });
  const all = useQuery({
    queryKey: memberHistoryKey(memberId ?? ''),
    queryFn: () => fetchMemberHistory(memberId as string),
    enabled: person !== null && !isSelf,
  });
  const boats = useBoats();
  const capacityOf = useMemo(() => {
    const map = new Map((boats.data ?? []).map((b) => [b.id, b.capacity]));
    return (boatId: string) => map.get(boatId) ?? 2;
  }, [boats.data]);

  if (isSelf) return <Navigate to="/uye/profil" replace />;

  const href = telHref(person?.phone);
  const count = (n: number | undefined) => (n === undefined ? '' : ` · ${n}`);
  const tabs = [
    { id: 'shared' as const, label: `${tr.person.tabShared}${count(shared.data?.length)}` },
    { id: 'all' as const, label: `${tr.person.tabAll}${count(all.data?.length)}` },
  ];

  const panel = (query: typeof shared | typeof all, render: () => ReactNode) => (
    <>
      {query.isPending && (
        <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}
      {query.isError && <ErrorState message={tr.person.loadHistoryError} onRetry={() => void query.refetch()} />}
      {query.isSuccess && render()}
    </>
  );

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
        <div className="flex flex-col gap-5">
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

          <div>
            <Tabs variant="prominent" label={tr.person.tabsLabel} idPrefix={tabsPrefix} tabs={tabs} value={tab} onChange={setTab} />
            <TabPanel idPrefix={tabsPrefix} id="shared" hidden={tab !== 'shared'}>
              {tab === 'shared' &&
                panel(shared, () => (
                  <HistoryList rows={shared.data ?? []} capacityOf={capacityOf} limit={HISTORY_LIMIT} empty={{ title: tr.person.sharedEmptyTitle, body: tr.person.sharedEmptyBody }} />
                ))}
            </TabPanel>
            <TabPanel idPrefix={tabsPrefix} id="all" hidden={tab !== 'all'}>
              {tab === 'all' &&
                panel(all, () => (
                  <HistoryList rows={all.data ?? []} capacityOf={capacityOf} limit={FULL_HISTORY_LIMIT} empty={{ title: tr.person.allEmptyTitle, body: tr.person.allEmptyBody }} />
                ))}
            </TabPanel>
          </div>
        </div>
      )}
    </>
  );
}
