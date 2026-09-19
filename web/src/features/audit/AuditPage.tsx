import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useState } from 'react';
import { BackLink } from '@/components/layout/BackLink';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { AuditCategory } from '@/types/database';
import { AUDIT_PAGE_SIZE, auditKeys, fetchAudit } from './api';
import { actorLabel, AUDIT_CATEGORIES, changedFields, countNote, groupByDay } from './format';

type Filter = AuditCategory | 'all';
const FILTERS: Filter[] = ['all', ...AUDIT_CATEGORIES];

/** Coach-only: who changed what, newest first, grouped by day. Read-only. */
export function AuditPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(AUDIT_PAGE_SIZE);
  const audit = useQuery({ queryKey: auditKeys.list(filter, limit), queryFn: () => fetchAudit(filter, limit), placeholderData: (previous) => previous });

  const groups = groupByDay(audit.data ?? []);
  // A full page means there may be older entries.
  const mayHaveMore = (audit.data?.length ?? 0) >= limit;

  return (
    <>
      <BackLink to="/antrenor/diger">{tr.audit.back}</BackLink>
      <PageHeader title={tr.audit.title} subtitle={tr.audit.hint} />

      <div role="group" aria-label={tr.audit.filterLabel} className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
              setLimit(AUDIT_PAGE_SIZE);
            }}
            className={cn(
              'min-h-11 rounded-full border-2 px-4 text-sm font-semibold',
              filter === f ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-fg',
            )}
          >
            {tr.audit.filters[f]}
          </button>
        ))}
      </div>

      {audit.isPending && (
        <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      )}
      {audit.isError && <ErrorState message={tr.audit.loadError} onRetry={() => void audit.refetch()} />}
      {audit.isSuccess && audit.data.length === 0 && <EmptyState icon={History} title={tr.audit.emptyTitle} body={tr.audit.emptyBody} />}

      {groups.map((group) => (
        <section key={group.day} aria-labelledby={`audit-day-${group.day}`} className="mb-5">
          <h2 id={`audit-day-${group.day}`} className="mb-2 text-sm font-bold text-muted">
            {group.heading}
          </h2>
          <Card className="px-4 py-1">
            <ul className="divide-y divide-border">
              {group.entries.map((entry) => {
                const fields = changedFields(entry.detail);
                const count = countNote(entry.detail);
                return (
                  <li key={entry.id} className="flex gap-3 py-3">
                    <time dateTime={entry.at} className="w-12 shrink-0 pt-0.5 text-sm font-bold tabular-nums">
                      {formatTime(entry.at)}
                    </time>
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium">
                        {entry.summary}
                        {count && <span className="font-normal text-muted"> · {count}</span>}
                      </p>
                      {fields && <p className="text-sm text-muted">{tr.audit.changed(fields)}</p>}
                      <p className="text-sm text-muted">{tr.audit.by(actorLabel(entry))}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      ))}

      {audit.isSuccess && mayHaveMore && (
        <Button variant="secondary" fullWidth loading={audit.isFetching} onClick={() => setLimit((n) => n + AUDIT_PAGE_SIZE)}>
          {tr.audit.more}
        </Button>
      )}
    </>
  );
}
