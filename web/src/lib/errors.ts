import { tr } from '@/strings/tr';

interface MaybeAuthError {
  code?: string;
  status?: number;
  name?: string;
  message?: string;
}

/** True for failures caused by connectivity rather than by the request itself. */
export function isNetworkError(error: unknown): boolean {
  const e = error as MaybeAuthError | null;
  if (!e) return false;
  return e.name === 'AuthRetryableFetchError' || e.status === 0 || /failed to fetch|networkerror|load failed/i.test(e.message ?? '');
}

/** Turkish message for a Supabase Auth sign-in failure. */
export function loginErrorMessage(error: unknown): string {
  const e = error as MaybeAuthError | null;
  if (isNetworkError(error)) return tr.common.errorNetwork;
  switch (e?.code) {
    case 'invalid_credentials':
      return tr.auth.invalidCredentials;
    case 'user_banned':
      return tr.auth.accountDisabled;
    case 'over_request_rate_limit':
      return tr.auth.tooManyAttempts;
    default:
      return e?.status === 429 ? tr.auth.tooManyAttempts : tr.common.errorGeneric;
  }
}

/** Turkish message for a failed password change. */
export function passwordChangeErrorMessage(error: unknown): string {
  const e = error as MaybeAuthError | null;
  if (isNetworkError(error)) return tr.common.errorNetwork;
  switch (e?.code) {
    case 'same_password':
      return tr.auth.passwordSame;
    case 'weak_password':
      return tr.auth.passwordWeak;
    default:
      return tr.common.errorGeneric;
  }
}

/**
 * Message safe to show to a user. Passes through only text that WE wrote in Turkish:
 * Edge Function errors (`FunctionError`) and database business-rule errors (SQLSTATE P0001, raised
 * by our RPCs). Anything else (raw Postgres/PostgREST/library text) becomes a generic message.
 */
export function errorMessage(error: unknown): string {
  if (isNetworkError(error)) return tr.common.errorNetwork;
  const e = error as MaybeAuthError | null;
  if (e?.code === '42501') return tr.common.forbidden;
  if (e?.code === 'P0001' && e.message) return e.message;
  if (error instanceof Error && error.name === 'FunctionError' && error.message) return error.message;
  return tr.common.errorGeneric;
}

/** True for a Postgres unique-constraint violation (e.g. duplicate boat name). */
export function isUniqueViolation(error: unknown): boolean {
  return (error as MaybeAuthError | null)?.code === '23505';
}
