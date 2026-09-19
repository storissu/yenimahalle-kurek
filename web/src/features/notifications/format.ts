import { formatShortDate, formatTime } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { NotificationType } from '@/types/database';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Club-time calendar day of an instant as "YYYY-MM-DD". */
const dayOf = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(d);

/**
 * "az önce" / "5 dk önce" / "3 sa önce" / "Dün 18:30" / "12 Eyl". Calendar days use club time, so a message
 * from 23:50 last night reads "Dün" even if it is only 20 minutes old... except within the hour, which wins.
 */
export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  const diff = now.getTime() - then.getTime();
  if (diff < MINUTE) return tr.notifications.justNow; // also covers small clock differences (negative diff)
  if (diff < HOUR) return tr.notifications.minutesAgo(Math.floor(diff / MINUTE));
  const today = dayOf(now);
  const thatDay = dayOf(then);
  if (thatDay === today) return tr.notifications.hoursAgo(Math.floor(diff / HOUR));
  const yesterday = dayOf(new Date(now.getTime() - 24 * HOUR));
  if (thatDay === yesterday) return tr.notifications.yesterday(formatTime(then));
  return formatShortDate(then);
}

export type NotificationIconKey = 'calendar-plus' | 'calendar-clock' | 'calendar-x' | 'clock' | 'clipboard' | 'ship';

export function iconKeyFor(type: NotificationType): NotificationIconKey {
  switch (type) {
    case 'training_new':
      return 'calendar-plus';
    case 'training_changed':
      return 'calendar-clock';
    case 'training_cancelled':
      return 'calendar-x';
    case 'deadline_reminder':
    case 'deadline_summary':
      return 'clock';
    case 'program_published':
    case 'program_updated':
      return 'ship';
    default:
      return 'clipboard';
  }
}

/** Only ever navigate inside the app, whatever a stored link says. */
export function safeInternalPath(url: string): string {
  return url.startsWith('/') && !url.startsWith('//') ? url : '/';
}
