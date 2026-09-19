import { CalendarX } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { useNow } from '@/lib/clock';
import { tr } from '@/strings/tr';
import type { Training } from '@/types/database';
import { useOlderTrainings, useTrainings } from './hooks';
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
  const [showOlder, setShowOlder] = useState(false);
  const older = useOlderTrainings(showOlder);
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
          <div className="flex flex-col gap-3">
            {partition.past.length === 0 && !showOlder && (
              <EmptyState icon={CalendarX} title={tr.trainings.emptyPastTitle} body={tr.trainings.emptyPastBody} />
            )}
            {partition.past.length > 0 && (
              <ul className="flex flex-col gap-3">
                {partition.past.map((t) => (
                  <li key={t.id}>
                    <TrainingCard training={t} to={`${basePath}/${t.id}`} footer={footer?.(t, now)} />
                  </li>
                ))}
              </ul>
            )}

            {!showOlder && (
              <Button variant="secondary" onClick={() => setShowOlder(true)}>
                {tr.trainings.showOlder}
              </Button>
            )}
            {showOlder && older.isPending && <Skeleton className="h-24" />}
            {showOlder && older.isError && <ErrorState message={tr.trainings.loadError} onRetry={() => void older.refetch()} />}
            {showOlder && older.isSuccess && older.data.length === 0 && <p className="text-center text-sm text-muted">{tr.trainings.olderNone}</p>}
            {showOlder && older.isSuccess && older.data.length > 0 && (
              <section aria-labelledby="older-trainings-heading" className="flex flex-col gap-3">
                <h3 id="older-trainings-heading" className="text-sm font-bold text-muted">
                  {tr.trainings.olderHeading}
                </h3>
                <ul className="flex flex-col gap-3">
                  {older.data.map((t) => (
                    <li key={t.id}>
                      <TrainingCard training={t} to={`${basePath}/${t.id}`} footer={footer?.(t, now)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </TabPanel>
    </>
  );
}
