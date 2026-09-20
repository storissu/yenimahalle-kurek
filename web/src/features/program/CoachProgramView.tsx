import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { tr } from '@/strings/tr';
import type { Training } from '@/types/database';
import { useBoats, useMemberNames, useProgram } from './hooks';
import { ProgramByBoat } from './ProgramByBoat';
import { TrainingNote, WeatherNote } from './ProgramParts';

/**
 * The coach's copy of what members see once a program is PUBLISHED: the notes and the whole program, boat by boat, in the
 * same compact layout as on a member's phone (no one is highlighted — the coach is not rowing). Nothing is shown for a
 * draft (the editor below is the place for that) or for a cancelled training. Names open a contact card with the phone.
 */
export function CoachProgramView({ training }: { training: Pick<Training, 'id' | 'status'> }) {
  const program = useProgram(training.id);
  const boats = useBoats();
  const { query: namesQuery, nameOf, contactOf } = useMemberNames();

  if (training.status === 'cancelled') return null;
  if (program.isPending || boats.isPending || namesQuery.isPending) return <Skeleton className="h-32" />;
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
  if (program.data.program?.status !== 'published') return null;

  return (
    <section aria-labelledby={`published-program-${training.id}`} className="flex flex-col gap-3">
      <h2 id={`published-program-${training.id}`} className="text-sm font-bold text-muted">
        {tr.program.coachPublished}
      </h2>
      <TrainingNote notes={program.data.program.training_notes} />
      <ProgramByBoat data={program.data} boats={boats.data} nameOf={nameOf} contactOf={contactOf} profileLinks={false} />
      <WeatherNote note={program.data.program.weather_note} />
    </section>
  );
}
