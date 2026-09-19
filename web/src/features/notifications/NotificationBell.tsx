import { Bell } from 'lucide-react';
import { Link } from 'react-router';
import { tr } from '@/strings/tr';
import { useUnreadCount } from './hooks';

/** Bell with an unread badge; opens the inbox. `to` is the role-specific inbox path. */
export function NotificationBell({ to }: { to: string }) {
  const { data } = useUnreadCount();
  const unread = data ?? 0;
  return (
    <Link
      to={to}
      aria-label={tr.notifications.bellLabel(unread)}
      className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface"
    >
      <Bell aria-hidden="true" size={20} />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold leading-none text-primary-fg"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}
