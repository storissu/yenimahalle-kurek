import { ClipboardList } from 'lucide-react';
import { useMemo } from 'react';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { tr } from '@/strings/tr';
import type { Training } from '@/types/database';
import { useProfile } from '../auth/AuthProvider';
import { useMyResponses } from '../trainings/hooks';
import { useBoats, useMemberNames, useProgram } from './hooks';
import { initialSessionCount } from './model';
import { MyBoatCard, ProgramNotes } from './ProgramParts';
import { ProgramByBoat } from './ProgramByBoat';
import { buildTimeline, myAssignments } from './view';

interface MemberProgramProps {
  training: Training;
  /**
   * `mine` = only the reader's own boats (top of the page, above the weather and the RSVP)
   * `rest` = notes + the whole program by boat, or the "not published" message (below the RSVP)
   */
  variant: 'mine' | 'rest';
}

/** A member's view of a training's PUBLISHED program. Drafts are invisible to members (RLS). */
export function MemberProgram({ training, variant }: MemberProgramProps) {
  const me = useProfile();
  const program = useProgram(training.id);
  const boats = useBoats();
  const { query: namesQuery, nameOf, contactOf } = useMemberNames();
  const responses = useMyResponses();

  const boatById = useMemo(() => new Map((boats.data ?? []).map((b) => [b.id, b])), [boats.data]);
  const boatOrder = useMemo(() => new Map((boats.data ?? []).map((b) => [b.id, b.sort_order])), [boats.data]);
  const boatName = (id: string) => boatById.get(id)?.name ?? '?';
  const capacityOf = (id: string) => boatById.get(id)?.capacity ?? 2;

  if (program.isPending || boats.isPending || namesQuery.isPending) return <Skeleton className={variant === 'mine' ? 'h-32' : 'h-48'} />;
  if (program.isError || boats.isError || namesQuery.isError) {
    return (
      <ErrorState
        message={tr.program.loadError}
        onRetry={() => {
          void program.refetch();
          void boats.refetch();
          void namesQuery.refetch();
        }}
      />
    );
  }

  const published = program.data.program?.status === 'published';
  if (!published) {
    // Only the lower part of the training page explains that nothing is published yet.
    if (variant !== 'rest') return null;
    return <EmptyState icon={ClipboardList} title={tr.program.notPublishedTitle} body={tr.program.notPublishedBody} />;
  }

  const timeline = buildTimeline(program.data, initialSessionCount(program.data, training.slot_count), boatOrder);
  const mine = myAssignments(timeline, me.id);
  const attending = responses.data?.find((r) => r.training_id === training.id)?.response === 'attending';

  const yours =
    mine.length > 0 ? (
      <MyBoatCard assignments={mine} training={training} nameOf={nameOf} boatName={boatName} capacityOf={capacityOf} />
    ) : attending ? (
      <Card className="border-warning bg-warning-soft text-sm font-medium text-warning">{tr.program.yourNoneAttending}</Card>
    ) : null;

  if (variant === 'mine') return yours;

  const everything = (
    <>
      <ProgramNotes weatherNote={program.data.program?.weather_note ?? null} trainingNotes={program.data.program?.training_notes ?? null} />
      <section aria-labelledby="full-program-heading" className="flex flex-col gap-3">
        <h2 id="full-program-heading" className="text-sm font-bold text-muted">
          {tr.program.fullProgram}
        </h2>
        <ProgramByBoat data={program.data} training={training} boats={boats.data} meId={me.id} nameOf={nameOf} contactOf={contactOf} />
      </section>
    </>
  );

  return <div className="flex flex-col gap-4">{everything}</div>;
}
