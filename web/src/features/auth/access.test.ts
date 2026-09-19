import { describe, expect, it } from 'vitest';
import type { Profile } from '@/types/database';
import { resolveAccess, type AuthState } from './access';

const base: Profile = {
  id: '1',
  full_name: 'Test Kişi',
  username: 'test',
  role: 'member',
  phone: null,
  is_active: true,
  must_change_password: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const member: AuthState = { status: 'signedIn', profile: base };
const coach: AuthState = { status: 'signedIn', profile: { ...base, role: 'coach' } };
const mustChange: AuthState = { status: 'signedIn', profile: { ...base, must_change_password: true } };
const coachMustChange: AuthState = { status: 'signedIn', profile: { ...base, role: 'coach', must_change_password: true } };

describe('resolveAccess', () => {
  it('waits while the session or profile is loading', () => {
    expect(resolveAccess({ status: 'loading' }, '/uye')).toEqual({ type: 'wait' });
  });

  it('reports retryable errors and blocked accounts regardless of the path', () => {
    expect(resolveAccess({ status: 'error' }, '/uye')).toEqual({ type: 'error' });
    expect(resolveAccess({ status: 'blocked' }, '/antrenor')).toEqual({ type: 'blocked' });
  });

  describe('signed out', () => {
    it.each(['/uye', '/antrenor', '/antrenor/uyeler', '/sifre-degistir', '/', '/bilinmeyen'])('sends %s to the login page', (path) => {
      expect(resolveAccess({ status: 'signedOut' }, path)).toEqual({ type: 'redirect', to: '/giris' });
    });

    it.each(['/giris', '/gizlilik'])('allows the public page %s', (path) => {
      expect(resolveAccess({ status: 'signedOut' }, path)).toEqual({ type: 'allow' });
    });
  });

  describe('signed in with a temporary password', () => {
    it.each(['/uye', '/antrenor', '/giris', '/gizlilik', '/'])('forces the password change before %s', (path) => {
      expect(resolveAccess(mustChange, path)).toEqual({ type: 'redirect', to: '/sifre-degistir' });
      expect(resolveAccess(coachMustChange, path)).toEqual({ type: 'redirect', to: '/sifre-degistir' });
    });

    it('allows the change-password page itself', () => {
      expect(resolveAccess(mustChange, '/sifre-degistir')).toEqual({ type: 'allow' });
    });
  });

  describe('members', () => {
    it('land on the member home from / and /giris', () => {
      expect(resolveAccess(member, '/')).toEqual({ type: 'redirect', to: '/uye' });
      expect(resolveAccess(member, '/giris')).toEqual({ type: 'redirect', to: '/uye' });
    });

    it('may use member pages and shared pages', () => {
      for (const path of ['/uye', '/uye/antrenmanlar', '/uye/profil', '/gizlilik', '/sifre-degistir']) {
        expect(resolveAccess(member, path)).toEqual({ type: 'allow' });
      }
    });

    it('are bounced away from the coach panel', () => {
      for (const path of ['/antrenor', '/antrenor/uyeler', '/antrenor/diger']) {
        expect(resolveAccess(member, path)).toEqual({ type: 'redirect', to: '/uye' });
      }
    });
  });

  describe('coaches', () => {
    it('land on the coach panel from / and /giris', () => {
      expect(resolveAccess(coach, '/')).toEqual({ type: 'redirect', to: '/antrenor' });
      expect(resolveAccess(coach, '/giris')).toEqual({ type: 'redirect', to: '/antrenor' });
    });

    it('may use coach pages', () => {
      for (const path of ['/antrenor', '/antrenor/uyeler', '/antrenor/diger']) {
        expect(resolveAccess(coach, path)).toEqual({ type: 'allow' });
      }
    });

    it('are sent to the coach panel instead of the member area', () => {
      expect(resolveAccess(coach, '/uye')).toEqual({ type: 'redirect', to: '/antrenor' });
    });
  });

  it('does not confuse similarly named prefixes', () => {
    expect(resolveAccess(member, '/antrenorx')).toEqual({ type: 'allow' }); // unknown page -> 404, not the coach area
    expect(resolveAccess(coach, '/uyeler')).toEqual({ type: 'allow' });
  });
});
