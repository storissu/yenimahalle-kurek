import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import { useNow } from '@/lib/clock';
import { errorMessage } from '@/lib/errors';
import { tr } from '@/strings/tr';
import type { Training } from '@/types/database';
import { useMyResponses, useSetRsvp } from './hooks';
import { RsvpCard } from './RsvpCard';

/** RsvpCard wired to the signed-in member's data. */
export function MemberRsvp({ training }: { training: Training }) {
  const responses = useMyResponses();
  const setRsvp = useSetRsvp(training.id);
  const toast = useToast();
  const now = useNow();

  if (responses.isPending) return <Skeleton className="h-64" />;
  if (responses.isError) return <ErrorState message={tr.responses.loadError} onRetry={() => void responses.refetch()} />;

  const answer = responses.data.find((r) => r.training_id === training.id);
  return (
    <RsvpCard
      training={training}
      answer={answer}
      now={now}
      pending={setRsvp.isPending}
      error={setRsvp.isError ? errorMessage(setRsvp.error) : null}
      onSubmit={async (response, note) => {
        await setRsvp.mutateAsync({ response, note });
        toast.show(tr.rsvp.saved, 'success');
      }}
    />
  );
}
