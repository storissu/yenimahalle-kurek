import { ChevronRight, CircleCheck } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { formatDayMonth } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { Training } from '@/types/database';
import { sessionCountLabel, timeRangeLabel } from '../trainings/schedule';
import { useProgram } from './hooks';
import { summarizeProgram } from './view';

/**
 * One line-and-a-half summary of a training whose program is published, for the coach's dashboard: when it is, that it
 * is live, and how big it is. The whole card opens the training's Program tab. The counts appear once the program has
 * loaded; until then (or if it fails) the card simply shows the date and time.
 */
export function PublishedProgramCard({ training }: { training: Pick<Training, 'id' | 'starts_at' | 'slot_count' | 'ends_at'> }) {
  const program = useProgram(training.id);
  const summary = program.data ? summarizeProgram(program.data) : null;
  const details = [
    summary ? sessionCountLabel(summary.sessions) : null,
    summary ? tr.program.boatCount(summary.boats) : null,
    summary ? tr.program.peopleCount(summary.people) : null,
  ].filter(Boolean);

  return (
    <Link
      to={`/antrenor/antrenmanlar/${training.id}?sekme=program`}
      className="flex items-center gap-3 rounded-2xl border border-success bg-surface px-4 py-3 transition-colors active:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <p className="font-bold">{formatDayMonth(training.starts_at)}</p>
        <p className="text-sm">
          <span className="whitespace-nowrap font-bold tabular-nums">{timeRangeLabel(training)}</span>
          {details.length > 0 && <span className="text-muted"> · {details.join(' · ')}</span>}
        </p>
      </div>
      <Badge tone="success">
        <CircleCheck aria-hidden="true" size={13} />
        {tr.program.publishedBadge}
      </Badge>
      <ChevronRight aria-hidden="true" size={20} className="shrink-0 text-muted" />
    </Link>
  );
}
