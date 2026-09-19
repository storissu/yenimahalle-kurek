import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const valid = {
  VITE_SUPABASE_URL: 'https://abcdefghij.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'a'.repeat(40),
};

describe('parseEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const result = parseEnv(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.VITE_LOGIN_EMAIL_DOMAIN).toBe('kulup.invalid');
      expect(result.env.VITE_VAPID_PUBLIC_KEY).toBeUndefined();
    }
  });

  it('reports missing required values in Turkish-friendly form', () => {
    const result = parseEnv({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(' ')).toMatch(/VITE_SUPABASE_URL/);
  });

  it('treats empty strings from .env files as unset', () => {
    const result = parseEnv({ ...valid, VITE_VAPID_PUBLIC_KEY: '', VITE_LOGIN_EMAIL_DOMAIN: '' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.env.VITE_LOGIN_EMAIL_DOMAIN).toBe('kulup.invalid');
  });

  it('rejects a malformed URL', () => {
    expect(parseEnv({ ...valid, VITE_SUPABASE_URL: 'not a url' }).ok).toBe(false);
  });
});
