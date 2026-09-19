import { describe, expect, it } from 'vitest';
import { isValidUsername, normalizeUsername, toLoginEmail } from './username';

describe('username helpers', () => {
  it('accepts the documented format only', () => {
    for (const ok of ['ali', 'ayse.yilmaz', 'mehmet_k', 'ali-veli', 'x'.repeat(30)]) expect(isValidUsername(ok)).toBe(true);
    for (const bad of ['ab', 'Ali', 'şükrü', 'ali veli', '', 'x'.repeat(31), 'ali@kulup']) expect(isValidUsername(bad)).toBe(false);
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(normalizeUsername('  Ali.Yilmaz ')).toBe('ali.yilmaz');
  });

  it('never turns Turkish capitals into a valid username by accident', () => {
    expect(isValidUsername(normalizeUsername('İbrahim'))).toBe(false);
    expect(isValidUsername(normalizeUsername('ISIK'))).toBe(true); // plain ASCII: fine
  });

  it('maps a username to its login email, normalizing first', () => {
    expect(toLoginEmail(' Ali ', 'kulup.invalid')).toBe('ali@kulup.invalid');
  });
});
