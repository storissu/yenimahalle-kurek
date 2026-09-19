import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus, Ship } from 'lucide-react';
import { useState } from 'react';
import { BackLink } from '@/components/layout/BackLink';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { tr } from '@/strings/tr';
import type { Boat } from '@/types/database';
import { boatsKey, fetchBoats } from './api';
import { BoatDialog } from './BoatDialog';

export function BoatsPage() {
  const boats = useQuery({ queryKey: boatsKey, queryFn: fetchBoats });
  const [target, setTarget] = useState<Boat | 'new' | null>(null);
  const nextSortOrder = (boats.data?.reduce((max, b) => Math.max(max, b.sort_order), 0) ?? 0) + 1;

  return (
    <>
      <BackLink to="/antrenor/diger">{tr.boats.back}</BackLink>
      <PageHeader
        title={tr.boats.title}
        action={
          <Button onClick={() => setTarget('new')}>
            <Plus aria-hidden="true" size={18} />
            {tr.boats.add}
          </Button>
        }
      />

      {boats.isPending && (
        <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
          <Skeleton className="h-[72px]" />
          <Skeleton className="h-[72px]" />
        </div>
      )}
      {boats.isError && <ErrorState message={tr.boats.loadError} onRetry={() => void boats.refetch()} />}
      {boats.isSuccess && boats.data.length === 0 && (
        <EmptyState icon={Ship} title={tr.boats.emptyTitle} body={tr.boats.emptyBody} action={<Button onClick={() => setTarget('new')}>{tr.boats.add}</Button>} />
      )}

      {boats.isSuccess && boats.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {boats.data.map((boat) => (
            <li key={boat.id}>
              <button
                type="button"
                onClick={() => setTarget(boat)}
                className="flex min-h-[72px] w-full items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Ship aria-hidden="true" size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{boat.name}</p>
                  <p className="text-sm text-muted">{tr.boats.capacityOption(boat.capacity)}</p>
                </div>
                <Badge tone={boat.is_active ? 'success' : 'neutral'}>{boat.is_active ? tr.boats.active : tr.boats.inactive}</Badge>
                <ChevronRight aria-hidden="true" size={20} className="shrink-0 text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <BoatDialog target={target} nextSortOrder={nextSortOrder} onClose={() => setTarget(null)} />
    </>
  );
}
