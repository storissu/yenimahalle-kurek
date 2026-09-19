import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { fetchNotifications, fetchUnreadCount, markAllRead, markRead, notificationKeys } from './api';

export function useNotifications() {
  return useQuery({ queryKey: notificationKeys.list, queryFn: fetchNotifications });
}

/** Unread count for the bell. Refreshes every minute and when the app is reopened / a push arrives. */
export function useUnreadCount() {
  return useQuery({ queryKey: notificationKeys.unread, queryFn: fetchUnreadCount, refetchInterval: 60_000, refetchOnWindowFocus: true });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => markRead(ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

/** Mirrors the unread count on the app icon where the platform supports it (installed PWAs on iOS 16.4+/Android). */
export function useAppBadge(): void {
  const { data } = useUnreadCount();
  useEffect(() => {
    if (data === undefined) return;
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    const apply = data > 0 ? nav.setAppBadge?.(data) : nav.clearAppBadge?.();
    void apply?.catch(() => undefined);
  }, [data]);
}
