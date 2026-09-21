import type { ReactNode } from 'react';

/**
 * The action row at the end of a long dialog (e.g. "Tamam" under a member list). It sticks to the bottom edge of the dialog
 * while the content scrolls behind it, so the action is always in reach; at the end of the content it simply sits in place
 * (nothing is ever covered). The negative margins cancel the dialog's own padding so the bar spans the full width and rests
 * flush at the bottom; the bar's own padding puts it back (including the phone's safe area).
 */
export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 -mb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-border bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
      {children}
    </div>
  );
}
