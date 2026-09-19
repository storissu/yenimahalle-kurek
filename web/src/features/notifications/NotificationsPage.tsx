import { Bell, CalendarClock, CalendarPlus, CalendarX, Clock, ClipboardList, Ship, type LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNow } from '@/lib/clock';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';
import { BackLink } from '@/components/layout/BackLink';
import { iconKeyFor, relativeTime, safeInternalPath, type NotificationIconKey } from './format';
import { useMarkAllRead, useMarkRead, useNotifications } from './hooks';

const ICONS: Record<NotificationIconKey, LucideIcon> = {
  'calendar-plus': CalendarPlus,
  'calendar-clock': CalendarClock,
  'calendar-x': CalendarX,
  clock: Clock,
  clipboard: ClipboardList,
  ship: Ship,
};

/** The inbox: every notification the user received, unread ones highlighted. Tapping opens the related page. */
export function NotificationsPage({ backTo, backLabel }: { backTo: string; backLabel: string }) {
  const notifications = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const navigate = useNavigate();
  const now = useNow(60_000);

  const unread = (notifications.data ?? []).filter((n) => n.read_at === null);

  return (
    <>
      <BackLink to={backTo}>{backLabel}</BackLink>
      <PageHeader
        title={tr.notifications.title}
        action={
          unread.length > 0 ? (
            <Button variant="secondary" loading={markAll.isPending} onClick={() => markAll.mutate()}>
              {tr.notifications.markAll}
            </Button>
          ) : undefined
        }
      />

      {notifications.isPending && (
        <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}
      {notifications.isError && <ErrorState message={tr.notifications.loadError} onRetry={() => void notifications.refetch()} />}
      {notifications.isSuccess && notifications.data.length === 0 && (
        <EmptyState icon={Bell} title={tr.notifications.emptyTitle} body={tr.notifications.emptyBody} />
      )}

      {notifications.isSuccess && notifications.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {notifications.data.map((n) => {
            const Icon = ICONS[iconKeyFor(n.type)];
            const isUnread = n.read_at === null;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (isUnread) markRead.mutate([n.id]);
                    void navigate(safeInternalPath(n.url));
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-2xl border p-4 text-left',
                    isUnread ? 'border-primary bg-primary-soft' : 'border-border bg-surface',
                  )}
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-primary">
                    <Icon aria-hidden="true" size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={cn('block', isUnread ? 'font-bold' : 'font-semibold')}>
                        {n.title}
                        {isUnread && <span className="sr-only"> ({tr.notifications.unreadMark})</span>}
                      </span>
                      {isUnread && <span aria-hidden="true" className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}
                    </span>
                    <span className="mt-1 block whitespace-pre-line break-words text-sm text-fg">{n.body}</span>
                    <span className="mt-1.5 block text-xs text-muted">{relativeTime(n.created_at, now)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
