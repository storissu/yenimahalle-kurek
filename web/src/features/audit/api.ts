import { supabase } from '@/lib/supabase';
import type { AuditCategory, AuditEntry } from '@/types/database';

export const auditKeys = {
  all: ['audit'] as const,
  list: (category: AuditCategory | 'all', limit: number) => ['audit', category, limit] as const,
};

export const AUDIT_PAGE_SIZE = 50;

/** Newest entries first (coaches only — RLS returns nothing to anyone else). `limit` grows by a page at a time. */
export async function fetchAudit(category: AuditCategory | 'all', limit: number): Promise<AuditEntry[]> {
  let query = supabase.from('audit_log').select('*').order('at', { ascending: false }).order('id', { ascending: false }).limit(limit);
  if (category !== 'all') query = query.eq('category', category);
  const { data, error } = await query;
  if (error) throw error;
  return data as AuditEntry[];
}
