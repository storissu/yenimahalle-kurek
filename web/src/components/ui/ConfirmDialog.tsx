import type { ReactNode } from 'react';
import { tr } from '@/strings/tr';
import { Button } from './Button';
import { Dialog } from './Dialog';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Plain text or richer content (e.g. a list of warnings). */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Two-button confirmation as a sheet. Escape / backdrop / close button all mean "cancel". */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = tr.common.cancel,
  tone = 'primary',
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} title={title}>
      {children && <div className="flex flex-col gap-3 text-sm">{children}</div>}
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm} loading={pending}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
