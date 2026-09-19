// Captures Chrome/Android's `beforeinstallprompt` so an in-app "Yükle" button can trigger it.
import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function initInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export async function promptInstall(): Promise<void> {
  if (!deferred) return;
  const event = deferred;
  deferred = null;
  notify();
  await event.prompt();
  await event.userChoice;
}

export function useCanPromptInstall(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => deferred !== null,
    () => false,
  );
}
