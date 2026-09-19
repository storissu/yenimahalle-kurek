import { cn } from '@/lib/cn';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block animate-spin rounded-full border-2 border-current border-t-transparent', className ?? 'h-5 w-5')}
    />
  );
}
