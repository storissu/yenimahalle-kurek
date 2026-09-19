// Service worker registration + "new version available" state.
import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

let needRefresh = false;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

const HOUR = 60 * 60 * 1000;

export function initPwa(): void {
  // No service worker in `vite dev` (devOptions.enabled = false); test PWA features with build + preview.
  if (!import.meta.env.PROD) return;
  updateServiceWorker = registerSW({
    onNeedRefresh() {
      needRefresh = true;
      notify();
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Installed apps can stay open for days: look for a new version hourly and on return to the app.
      setInterval(() => void registration.update(), HOUR);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update();
      });
    },
    onRegisterError(error) {
      console.error('Service worker registration failed', error);
    },
  });
}

export function applyUpdate(): void {
  void updateServiceWorker?.(true);
}

export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => needRefresh,
    () => false,
  );
}
