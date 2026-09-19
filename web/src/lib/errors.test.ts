import { describe, expect, it } from 'vitest';
import { tr } from '@/strings/tr';
import { errorMessage, isNetworkError, isUniqueViolation, loginErrorMessage, passwordChangeErrorMessage } from './errors';

describe('error messages (Turkish)', () => {
  it('maps sign-in failures', () => {
    expect(loginErrorMessage({ code: 'invalid_credentials' })).toBe(tr.auth.invalidCredentials);
    expect(loginErrorMessage({ code: 'user_banned' })).toBe(tr.auth.accountDisabled);
    expect(loginErrorMessage({ code: 'over_request_rate_limit' })).toBe(tr.auth.tooManyAttempts);
    expect(loginErrorMessage({ status: 429 })).toBe(tr.auth.tooManyAttempts);
    expect(loginErrorMessage({ code: 'something_else' })).toBe(tr.common.errorGeneric);
  });

  it('recognises connectivity problems', () => {
    expect(isNetworkError({ name: 'AuthRetryableFetchError' })).toBe(true);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError({ code: 'invalid_credentials' })).toBe(false);
    expect(loginErrorMessage({ name: 'AuthRetryableFetchError', status: 0 })).toBe(tr.common.errorNetwork);
  });

  it('maps password change failures', () => {
    expect(passwordChangeErrorMessage({ code: 'same_password' })).toBe(tr.auth.passwordSame);
    expect(passwordChangeErrorMessage({ code: 'weak_password' })).toBe(tr.auth.passwordWeak);
    expect(passwordChangeErrorMessage(new Error('boom'))).toBe(tr.common.errorGeneric);
  });

  it('passes through Turkish messages written by our Edge Functions', () => {
    const fromFunction = Object.assign(new Error('Bu kullanıcı adı zaten kullanılıyor'), { name: 'FunctionError', status: 409 });
    expect(errorMessage(fromFunction)).toBe('Bu kullanıcı adı zaten kullanılıyor');
  });

  it('passes through database business-rule messages (SQLSTATE P0001) but hides raw database errors', () => {
    expect(errorMessage({ code: 'P0001', message: 'Yanıt süresi doldu. Değişiklik için antrenörünüzle görüşün.' })).toBe(
      'Yanıt süresi doldu. Değişiklik için antrenörünüzle görüşün.',
    );
    expect(errorMessage({ code: '23514', message: 'new row violates check constraint "trainings_slot_count_range"' })).toBe(tr.common.errorGeneric);
    expect(errorMessage({ code: 'PGRST301', message: 'JWT expired' })).toBe(tr.common.errorGeneric);
  });

  it('explains permission errors and never leaks arbitrary exception text', () => {
    expect(errorMessage({ code: '42501', message: 'permission denied for table profiles' })).toBe(tr.common.forbidden);
    expect(errorMessage(new Error('TypeError: x is undefined'))).toBe(tr.common.errorGeneric);
    expect(errorMessage('weird')).toBe(tr.common.errorGeneric);
  });

  it('recognises unique violations', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '23514' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
