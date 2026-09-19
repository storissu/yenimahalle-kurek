import { cn } from '@/lib/cn';

/** Placeholder block shown while data loads. Decorative: hidden from assistive tech. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-xl bg-surface-2', className ?? 'h-16 w-full')} />;
}
