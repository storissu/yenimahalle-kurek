import { describe, expect, it, vi } from 'vitest';
import { tr } from '@/strings/tr';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('./AuthProvider', () => ({ useAuth: () => ({}), useProfile: () => ({}) }));

import { newPasswordSchema } from './ChangePasswordPage';

const messages = (password: string, confirm = password) => {
  const result = newPasswordSchema.safeParse({ password, confirm });
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe('new password rules (match the Supabase policy)', () => {
  it('accepts 8+ characters with a letter and a digit', () => {
    expect(messages('abcd1234')).toEqual([]);
    expect(messages('Yıldız2026Kürek')).toEqual([]);
  });

  it('rejects short passwords', () => {
    expect(messages('ab12')).toContain(tr.auth.passwordTooShort);
  });

  it('requires both a letter and a digit', () => {
    expect(messages('abcdefgh')).toContain(tr.auth.passwordNeedsLetterAndDigit);
    expect(messages('12345678')).toContain(tr.auth.passwordNeedsLetterAndDigit);
  });

  it('requires the confirmation to match', () => {
    expect(messages('abcd1234', 'abcd12345')).toContain(tr.auth.passwordMismatch);
  });
});
