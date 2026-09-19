import { applyUpdate, useUpdateAvailable } from '@/pwa';
import { tr } from '@/strings/tr';
import { Button } from '@/components/ui/Button';

/** Shown when a new version of the app has been downloaded and is waiting to take over. */
export function UpdateBanner() {
  const updateAvailable = useUpdateAvailable();
  if (!updateAvailable) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-primary px-4 py-3 text-primary-fg shadow-lg"
    >
      <span className="text-sm font-semibold">{tr.common.updateAvailable}</span>
      <Button variant="secondary" onClick={applyUpdate}>
        {tr.common.updateAction}
      </Button>
    </div>
  );
}
