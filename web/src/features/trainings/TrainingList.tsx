import { CalendarX } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { useNow } from '@/lib/clock';
import { tr } from '@/strings/tr';
import type { Training } from '@/types/database';
import { useTrainings } from './hooks';
import { partitionTrainings } from './schedule';
import { TrainingCard } from './TrainingCard';

type ListTab = 'upcoming' | 'past';

interface TrainingListProps {
  /** Detail page prefix, e.g. "/uye/antrenmanlar". */
  basePath: string;
  emptyUpcomingBody: string;
  /** Extra content under each card (answer badge / response counts). */
  footer?: (training: Training, now: Date) => ReactNode;
  /** Rendered above the tabs (e.g. the "add" button). */
  children?: ReactNode;
}

/** Upcoming / past list of trainings with loading, error and empty states. Shared by members and coaches. */
export function TrainingList({ basePath, emptyUpcomingBody, footer, children }: TrainingListProps) {
  const trainings = useTrainings();
  const now = useNow();
  const [tab, setTab] = useState<ListTab>('upcoming');
  const idPrefix = useId();

  const partition = useMemo(() => partitionTrainings(trainings.data ?? [], now), [trainings.data, now]);

  return (
    <>
      {children}
      <Tabs
        label={tr.common.tabsLabel}
        idPrefix={idPrefix}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'upcoming', label: tr.trainings.tabUpcoming },
          { id: 'past', label: tr.trainings.tabPast },
        ]}
      />

      <TabPanel idPrefix={idPrefix} id={tab}>
        {trainings.isPending && (
          <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        )}

        {trainings.isError && <ErrorState message={tr.trainings.loadError} onRetry={() => void trainings.refetch()} />}

        {trainings.isSuccess && tab === 'upcoming' && (
          partition.upcoming.length === 0 ? (
            <EmptyState icon={CalendarX} title={tr.trainings.emptyUpcomingTitle} body={emptyUpcomingBody} />
          ) : (
            <ul className="flex flex-col gap-3">
              {partition.upcoming.map((t) => (
                <li key={t.id}>
                  <TrainingCard training={t} to={`${basePath}/${t.id}`} footer={footer?.(t, now)} />
                </li>
              ))}
            </ul>
          )
        )}

        {trainings.isSuccess && tab === 'past' && (
          partition.past.length === 0 ? (
            <EmptyState icon={CalendarX} title={tr.trainings.emptyPastTitle} body={tr.trainings.emptyPastBody} />
          ) : (
            <ul className="flex flex-col gap-3">
              {partition.past.map((t) => (
                <li key={t.id}>
                  <TrainingCard training={t} to={`${basePath}/${t.id}`} footer={footer?.(t, now)} />
                </li>
              ))}
            </ul>
          )
        )}
      </TabPanel>
    </>
  );
}
