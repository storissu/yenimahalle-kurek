// Writes coach actions that happen in Edge Functions (account creation, password reset, (de)activation)
// into the audit log. Everything that happens inside the database is logged by triggers instead
// (see supabase/migrations/*_audit_log.sql). Passwords and phone numbers are never part of an entry.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface MemberAuditEntry {
  action: 'member.create' | 'member.reset_password' | 'member.activate' | 'member.deactivate';
  /** The account the action was about. */
  memberId: string;
  /** The coach who did it. */
  actorId: string;
  summary: string;
  detail?: Record<string, unknown>;
}

/** Arguments of the database function log_audit(). */
export function auditRpcArgs(entry: MemberAuditEntry): Record<string, unknown> {
  return {
    p_category: 'member',
    p_action: entry.action,
    p_entity: 'profile',
    p_entity_id: entry.memberId,
    p_summary: entry.summary,
    p_detail: entry.detail ?? {},
    p_actor: entry.actorId,
  };
}

/** Best effort: a failing audit write is reported in the function logs but never undoes the action itself. */
export async function logAudit(admin: SupabaseClient, entry: MemberAuditEntry): Promise<void> {
  const { error } = await admin.rpc('log_audit', auditRpcArgs(entry));
  if (error) console.error('audit log failed', entry.action, error.message);
}
