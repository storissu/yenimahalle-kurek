import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface TextAreaFieldProps extends ComponentPropsWithRef<'textarea'> {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Shows "12/200" under the field. */
  counter?: { current: number; max: number };
}

export function TextAreaField({ label, hint, error, counter, className, id, rows = 3, ...rest }: TextAreaFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-semibold">
        {label}
      </label>
      <textarea
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(Boolean(hint) && !error && hintId, Boolean(error) && errorId) || undefined}
        className={cn(
          'w-full resize-y rounded-xl border bg-surface px-3.5 py-3 text-fg placeholder:text-muted',
          error ? 'border-danger' : 'border-border',
          className,
        )}
        {...rest}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          {hint && !error && (
            <p id={hintId} className="text-sm text-muted">
              {hint}
            </p>
          )}
          {error && (
            <p id={errorId} role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
        </div>
        {counter && (
          <span className={cn('text-xs tabular-nums', counter.current > counter.max ? 'font-semibold text-danger' : 'text-muted')}>
            {counter.current}/{counter.max}
          </span>
        )}
      </div>
    </div>
  );
}
