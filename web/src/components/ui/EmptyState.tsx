import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon aria-hidden="true" size={24} />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      {body && <p className="max-w-xs text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}
