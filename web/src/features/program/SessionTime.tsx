import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/time';
import { spanLabel } from '../trainings/schedule';

interface SessionTimeProps {
  /** THIS session's own start and end (ISO instants): every boat has its own schedule. */
  startsAt: string;
  endsAt: string;
  /** `lg` for the reader's own session. */
  size?: 'md' | 'lg';
  /** The reader's own session: the end time is as dark as the rest of the text (it sits on a tint). */
  strong?: boolean;
  className?: string;
}

/**
 * The time of one session, the first thing a row shows: the start big and bold, the end small beneath it.
 * Screen readers get the whole range as one piece of text ("08:15–09:15").
 */
export function SessionTime({ startsAt, endsAt, size = 'md', strong = false, className }: SessionTimeProps) {
  return (
    <div className={cn('shrink-0 tabular-nums leading-none', className)}>
      <span className="sr-only">{spanLabel(startsAt, endsAt)}</span>
      <div aria-hidden="true">
        <span className={cn('block font-extrabold', size === 'lg' ? 'text-3xl' : 'text-2xl')}>{formatTime(startsAt)}</span>
        <span className={cn('mt-1 block text-xs font-semibold', strong ? 'text-fg' : 'text-muted')}>–{formatTime(endsAt)}</span>
      </div>
    </div>
  );
}
