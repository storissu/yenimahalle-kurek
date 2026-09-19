import { describe, expect, it } from 'vitest';
import {
  generatePassword,
  isValidUsername,
  normalizeUsername,
  secureRandomInt,
  toLoginEmail,
} from '../functions/_shared/username.ts';

describe('username rules', () => {
  it.each(['ali', 'ayse.yilmaz', 'mehmet_k', 'ali-veli', 'a1b', 'x'.repeat(30)])('accepts %s', (u) => {
    expect(isValidUsername(u)).toBe(true);
  });

  it.each(['ab', 'Ali', 'şükrü', 'ali veli', 'ali@x', '', 'x'.repeat(31), 'ıi̇i'])('rejects %j', (u) => {
    expect(isValidUsername(u)).toBe(false);
  });

  it('normalizes case and whitespace (ASCII only, no locale surprises)', () => {
    expect(normalizeUsername('  ALI.Yilmaz ')).toBe('ali.yilmaz');
    // Turkish capital İ/I must NOT silently become a valid ASCII name via locale rules.
    expect(isValidUsername(normalizeUsername('İbrahim'))).toBe(false);
  });

  it('builds the synthetic login email', () => {
    expect(toLoginEmail('ali', 'kulup.invalid')).toBe('ali@kulup.invalid');
  });
});

describe('generatePassword', () => {
  it('has the requested length and only unambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword(10);
      expect(pw).toHaveLength(10);
      expect(pw).toMatch(/^[a-hj-km-np-zA-HJ-NP-Z2-9]+$/);
    }
  });

  it('always contains at least one letter and one digit (project password policy)', () => {
    for (let i = 0; i < 500; i++) {
      const pw = generatePassword(8);
      expect(pw).toMatch(/[A-Za-z]/);
      expect(pw).toMatch(/[0-9]/);
    }
  });

  it('is not constant', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword(10)));
    expect(seen.size).toBeGreaterThan(45);
  });

  it('refuses passwords shorter than 8', () => {
    expect(() => generatePassword(6)).toThrow();
  });

  it('secureRandomInt stays in range and covers the range', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const n = secureRandomInt(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
      seen.add(n);
    }
    expect(seen.size).toBe(7);
  });
});
