import { useId, useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';

interface TextFieldProps extends ComponentPropsWithRef<'input'> {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Adds a show/hide toggle (for type="password"). */
  revealable?: boolean;
}

export function TextField({ label, hint, error, revealable = false, className, id, type = 'text', ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const [revealed, setRevealed] = useState(false);
  const effectiveType = revealable && revealed ? 'text' : type;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={effectiveType}
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(Boolean(hint) && !error && hintId, Boolean(error) && errorId) || undefined}
          className={cn(
            'min-h-12 w-full rounded-xl border bg-surface px-3.5 text-fg placeholder:text-muted',
            error ? 'border-danger' : 'border-border',
            revealable && 'pr-12',
            className,
          )}
          {...rest}
        />
        {revealable && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? tr.common.hide : tr.common.show}
            aria-pressed={revealed}
            className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted"
          >
            {revealed ? <EyeOff aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />}
          </button>
        )}
      </div>
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
  );
}
