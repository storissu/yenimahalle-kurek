import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return <div className={cn('rounded-2xl border border-border bg-surface p-4', className)} {...rest} />;
}
