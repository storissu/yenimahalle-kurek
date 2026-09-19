import { TriangleAlert } from 'lucide-react';
import { tr } from '@/strings/tr';
import { Button } from './Button';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message = tr.common.errorGeneric, onRetry }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl bg-danger-soft px-6 py-8 text-center">
      <TriangleAlert aria-hidden="true" className="text-danger" size={28} />
      <p className="text-sm font-medium text-danger">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {tr.common.retry}
        </Button>
      )}
    </div>
  );
}
