import { CircleCheck, CircleX, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { tr } from '@/strings/tr';
import type { Training, TrainingResponse } from '@/types/database';
import { usePublishedTrainingIds } from '../program/hooks';
import { rsvpWindow } from './schedule';

/** A member's answer for one training as a status chip (icon + text, never colour alone). */
export function MyAnswerBadge({
  training,
  response,
  now,
}: {
  training: Pick<Training, 'id' | 'status' | 'rsvp_deadline'>;
  response: Pick<TrainingResponse, 'response'> | undefined;
  now: Date;
}) {
  const published = usePublishedTrainingIds();
  if (response?.response === 'attending') {
    return (
      <Badge tone="success">
        <CircleCheck aria-hidden="true" size={14} />
        {tr.rsvp.attending}
      </Badge>
    );
  }
  if (response?.response === 'not_attending') {
    return (
      <Badge>
        <CircleX aria-hidden="true" size={14} />
        {tr.rsvp.notAttending}
      </Badge>
    );
  }
  const window = rsvpWindow(training, now, published.data?.has(training.id) ?? false);
  if (window.kind === 'open') {
    return (
      <Badge tone="warning">
        <Clock aria-hidden="true" size={14} />
        {tr.rsvp.awaiting}
      </Badge>
    );
  }
  if (window.kind === 'locked') return <Badge>{tr.rsvp.lockedNoAnswer}</Badge>;
  return null;
}
