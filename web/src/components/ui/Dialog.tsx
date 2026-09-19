import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { tr } from '@/strings/tr';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Modal built on the native <dialog>: focus trapping, Escape to close and an inert background
 * come from the browser. Presented as a bottom sheet on phones and a centered card on wider screens.
 */
export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // Clicks on the backdrop land on the <dialog> element itself.
        if (event.target === ref.current) onClose();
      }}
      className="m-0 mt-auto max-h-[90dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-2xl bg-surface p-0 text-fg shadow-xl sm:m-auto sm:max-w-md sm:rounded-2xl"
    >
      {open && (
        <div className="flex flex-col gap-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-lg font-bold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={tr.common.close}
              className="-mr-2 -mt-1 flex h-11 w-11 items-center justify-center rounded-full text-muted"
            >
              <X aria-hidden="true" size={22} />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
