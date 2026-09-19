import type { ComponentPropsWithRef } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: Variant;
  size?: 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
}

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:opacity-90',
  secondary: 'bg-surface-2 text-fg hover:opacity-90 border border-border',
  ghost: 'bg-transparent text-primary hover:bg-primary-soft',
  danger: 'bg-danger text-primary-fg hover:opacity-90',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-opacity',
        'disabled:cursor-not-allowed disabled:opacity-60',
        size === 'lg' ? 'min-h-12 px-5 text-base' : 'min-h-11 px-4 text-[15px]',
        fullWidth && 'w-full',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}
