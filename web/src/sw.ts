/// <reference lib="webworker" />
// Service worker: (1) precaches the app shell so the app opens offline, (2) shows Web Push
// notifications, (3) routes notification taps back into the app.
// It deliberately has NO runtime caching: Supabase API responses are never stored by the worker.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// The page asks a waiting worker to take over when the user taps "Yenile".
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
}

function parsePayload(event: PushEvent): PushPayload {
  if (!event.data) return {};
  try {
    return event.data.json() as PushPayload;
  } catch {
    return { body: event.data.text() };
  }
}

self.addEventListener('push', (event) => {
  const payload = parsePayload(event);
  // iOS/Safari require every push to show a notification (userVisibleOnly), so always show one.
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(payload.title || 'YSK', {
        body: payload.body ?? '',
        icon: '/pwa-192x192.png',
        badge: '/pwa-64x64.png',
        tag: payload.tag,
        data: { url: payload.url || '/' },
      });
      // An open app refreshes its inbox, unread badge and lists right away.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) client.postMessage({ type: 'PUSH_RECEIVED' });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawUrl = (event.notification.data as { url?: string } | undefined)?.url || '/';
  const target = new URL(rawUrl, self.location.origin);
  // Only ever open pages of this app, whatever the payload says.
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows[0];
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: 'NAVIGATE', url: new URL(url).pathname + new URL(url).search });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
