// What a member may write as their own phone number. The same rule the database enforces in update_my_phone():
// digits, spaces and + ( ) . / - only, at least 7 digits, at most 30 characters. Empty means "no number".
export const PHONE_MAX = 30;

export type PhoneCheck = 'ok' | 'invalid' | 'too-long';

export function checkPhone(input: string): PhoneCheck {
  const value = input.trim();
  if (value === '') return 'ok';
  if (value.length > PHONE_MAX) return 'too-long';
  if (!/^[0-9 +()./-]+$/.test(value) || value.replace(/\D/g, '').length < 7) return 'invalid';
  return 'ok';
}
