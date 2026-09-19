import { CalendarClock, Clock, NotebookText } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { formatDate } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { Training } from '@/types/database';
import { deadlineLabel, sessionCountLabel, timeRangeLabel } from './schedule';
import { TrainingStatusBadge } from './TrainingCard';

/** Header card of a training detail page (member and coach). */
export function TrainingSummary({ training }: { training: Training }) {
  const cancelled = training.status === 'cancelled';
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {training.title && <p className="text-sm font-semibold text-muted">{training.title}</p>}
          <h1 className={cancelled ? 'text-xl font-bold text-muted line-through' : 'text-xl font-bold'}>{formatDate(training.starts_at)}</h1>
        </div>
        <TrainingStatusBadge status={training.status} />
      </div>

      <p className="flex items-center gap-2 font-semibold">
        <Clock aria-hidden="true" size={18} className="text-primary" />
        {timeRangeLabel(training)} · {sessionCountLabel(training.slot_count)}
      </p>

      {training.status === 'scheduled' && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <CalendarClock aria-hidden="true" size={18} />
          {tr.trainings.deadlineLabel(deadlineLabel(training))}
        </p>
      )}

      {training.notes && (
        <div className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-sm">
          <NotebookText aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-muted" />
          <p className="whitespace-pre-line break-words">{training.notes}</p>
        </div>
      )}
    </Card>
  );
}
