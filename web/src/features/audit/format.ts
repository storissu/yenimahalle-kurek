import { formatDate } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { AuditCategory, AuditEntry } from '@/types/database';

export const AUDIT_CATEGORIES: readonly AuditCategory[] = ['training', 'program', 'attendance', 'member', 'settings'];

/** Club-time calendar day of an instant as "YYYY-MM-DD". */
const dayKey = (iso: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(iso));

/** Newest first, grouped by club-time day: [{ day: '2026-09-21', heading: '21 Eylül 2026 Pazartesi', entries }]. */
export function groupByDay<T extends Pick<AuditEntry, 'at'>>(entries: T[]): Array<{ day: string; heading: string; entries: T[] }> {
  const groups: Array<{ day: string; heading: string; entries: T[] }> = [];
  for (const entry of entries) {
    const day = dayKey(entry.at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else groups.push({ day, heading: formatDate(entry.at), entries: [entry] });
  }
  return groups;
}

/** "başlık, notlar" — the changed fields of an edit in Turkish (unknown keys are ignored, never shown raw). */
export function changedFields(detail: AuditEntry['detail']): string | null {
  const fields = Array.isArray(detail?.fields) ? detail.fields : [];
  const labels: Record<string, string> = tr.audit.fields;
  const names = fields.flatMap((f) => (typeof f === 'string' && Object.hasOwn(labels, f) ? [labels[f] as string] : []));
  return names.length > 0 ? names.join(', ') : null;
}

/** "12 kayıt" for merged entries (one attendance save = many rows); null when there is nothing to add. */
export function countNote(detail: AuditEntry['detail']): string | null {
  const count = typeof detail?.count === 'number' ? detail.count : 0;
  return count > 1 ? tr.audit.records(count) : null;
}

/** Who did it: the coach's name, or a neutral label for the system / an account that no longer exists. */
export const actorLabel = (entry: Pick<AuditEntry, 'actor_name'>): string => entry.actor_name ?? tr.audit.system;
