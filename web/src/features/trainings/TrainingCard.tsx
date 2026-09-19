import { CalendarClock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { formatDayMonth } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { Training } from '@/types/database';
import { deadlineLabel, trainingTimeText } from './schedule';

export function TrainingStatusBadge({ status }: { status: Training['status'] }) {
  if (status === 'cancelled') return <Badge tone="danger">{tr.trainings.statusCancelled}</Badge>;
  if (status === 'completed') return <Badge tone="success">{tr.trainings.statusCompleted}</Badge>;
  return null;
}

interface TrainingCardProps {
  training: Training;
  to: string;
  /** Extra line(s) under the schedule, e.g. the member's answer or the coach's response counts. */
  footer?: ReactNode;
}

/** One training in a list: date, time range, number of sessions, deadline. The whole card is a link. */
export function TrainingCard({ training, to, footer }: TrainingCardProps) {
  const cancelled = training.status === 'cancelled';
  return (
    <Link
      to={to}
      className="block rounded-2xl border border-border bg-surface p-4 transition-colors active:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cancelled ? 'font-bold text-muted line-through' : 'font-bold'}>{formatDayMonth(training.starts_at)}</p>
          <p className="text-sm text-muted">{trainingTimeText(training)}</p>
          {training.title && <p className="mt-1 truncate text-sm font-medium">{training.title}</p>}
        </div>
        <TrainingStatusBadge status={training.status} />
      </div>
      {training.status === 'scheduled' && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <CalendarClock aria-hidden="true" size={14} />
          {tr.trainings.deadlineLabel(deadlineLabel(training))}
        </p>
      )}
      {footer && <div className="mt-3 border-t border-border pt-3">{footer}</div>}
    </Link>
  );
}
