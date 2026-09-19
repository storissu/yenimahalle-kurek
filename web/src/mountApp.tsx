import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { ToastProvider } from '@/components/ui/Toast';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { queryClient } from '@/lib/queryClient';
import { initPwa } from './pwa';
import { router } from './router';

export function mountApp(container: HTMLElement): void {
  initPwa();

  // A tapped push notification asks an already-open app window to navigate (see sw.ts).
  navigator.serviceWorker?.addEventListener('message', (event: MessageEvent<{ type?: string; url?: unknown }>) => {
    const { type, url } = event.data ?? {};
    if (type === 'NAVIGATE' && typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
      void router.navigate(url);
    }
  });

  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
