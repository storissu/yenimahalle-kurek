import { serverNow } from '@/lib/clock';
import { supabase } from '@/lib/supabase';
import type { AppNotification } from '@/types/database';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  unread: ['notifications', 'unread'] as const,
};

const LIST_LIMIT = 60;

/** The signed-in user's inbox, newest first (RLS: only their own rows). */
export async function fetchNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase.from('notification_outbox').select('*').order('created_at', { ascending: false }).limit(LIST_LIMIT);
  if (error) throw error;
  return data;
}

export async function fetchUnreadCount(): Promise<number> {
  const { count, error } = await supabase.from('notification_outbox').select('id', { count: 'exact', head: true }).is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function markRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('notification_outbox').update({ read_at: serverNow().toISOString() }).in('id', ids).is('read_at', null);
  if (error) throw error;
}

export async function markAllRead(): Promise<void> {
  const { error } = await supabase.from('notification_outbox').update({ read_at: serverNow().toISOString() }).is('read_at', null);
  if (error) throw error;
}
