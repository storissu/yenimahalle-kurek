import type { Profile, UserRole } from '@/types/database';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'error' } // could not load the profile (e.g. offline) — retryable
  | { status: 'blocked' } // signed in, but the profile is missing or deactivated
  | { status: 'signedIn'; profile: Profile };

export type Access =
  | { type: 'allow' }
  | { type: 'wait' }
  | { type: 'error' }
  | { type: 'blocked' }
  | { type: 'redirect'; to: string };

const PUBLIC_PATHS = ['/giris', '/gizlilik'];
const CHANGE_PASSWORD = '/sifre-degistir';

export const homeFor = (role: UserRole): string => (role === 'coach' ? '/antrenor' : '/uye');

const isUnder = (pathname: string, base: string): boolean => pathname === base || pathname.startsWith(`${base}/`);

/**
 * Single source of truth for "who may see which URL". This is UX routing only — the database
 * enforces the real permissions (RLS), so a tampered client still cannot read or write anything.
 */
export function resolveAccess(state: AuthState, pathname: string): Access {
  switch (state.status) {
    case 'loading':
      return { type: 'wait' };
    case 'error':
      return { type: 'error' };
    case 'blocked':
      return { type: 'blocked' };
    case 'signedOut':
      return PUBLIC_PATHS.includes(pathname) ? { type: 'allow' } : { type: 'redirect', to: '/giris' };
  }

  const { profile } = state;
  const home = homeFor(profile.role);

  // A temporary password must be replaced before anything else.
  if (profile.must_change_password) {
    return pathname === CHANGE_PASSWORD ? { type: 'allow' } : { type: 'redirect', to: CHANGE_PASSWORD };
  }
  if (pathname === '/giris' || pathname === '/') return { type: 'redirect', to: home };
  if (isUnder(pathname, '/uye') && profile.role !== 'member') return { type: 'redirect', to: home };
  if (isUnder(pathname, '/antrenor') && profile.role !== 'coach') return { type: 'redirect', to: home };
  return { type: 'allow' };
}
