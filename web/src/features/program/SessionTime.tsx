import { cn } from '@/lib/cn';
import type { Training } from '@/types/database';
import { sessionRangeLabel, sessionTimes } from '../trainings/schedule';

interface SessionTimeProps {
  training: Pick<Training, 'starts_at'>;
  /** 0-based session index. */
  index: number;
  /** `lg` for the reader's own session. */
  size?: 'md' | 'lg';
  /** On a solid primary background (the reader's own row). */
  onPrimary?: boolean;
  className?: string;
}

/**
 * The time of one session, the first thing a row shows: the start hour big and bold, the end hour small beneath it.
 * Screen readers get the whole range as one piece of text ("08:00–09:00").
 */
export function SessionTime({ training, index, size = 'md', onPrimary = false, className }: SessionTimeProps) {
  const { start, end } = sessionTimes(training, index);
  return (
    <div className={cn('shrink-0 tabular-nums leading-none', className)}>
      <span className="sr-only">{sessionRangeLabel(training, index)}</span>
      <div aria-hidden="true">
        <span className={cn('block font-extrabold', size === 'lg' ? 'text-3xl' : 'text-2xl')}>{start}</span>
        <span className={cn('mt-1 block text-xs font-semibold', onPrimary ? 'text-primary-fg' : 'text-muted')}>–{end}</span>
      </div>
    </div>
  );
}
