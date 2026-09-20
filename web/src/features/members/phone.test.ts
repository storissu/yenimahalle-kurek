import { describe, expect, it } from 'vitest';
import { checkPhone } from './phone';

describe('checkPhone', () => {
  it.each(['0532 111 22 33', '+90 (532) 111-22-33', '0532.111.22.33', '0532/111 22 33', '5321112233', '  0532 111 22 33  '])('accepts %s', (value) => {
    expect(checkPhone(value)).toBe('ok');
  });

  it('accepts an empty field (that removes the number)', () => {
    expect(checkPhone('')).toBe('ok');
    expect(checkPhone('   ')).toBe('ok');
  });

  it.each(['ara beni', 'https://kotu.example', '<b>0532 111 22 33</b>', '12345', '0532 111 22 3x', '++++++++'])('refuses %s', (value) => {
    expect(checkPhone(value)).toBe('invalid');
  });

  it('refuses more than 30 characters', () => {
    expect(checkPhone('0'.repeat(30))).toBe('ok');
    expect(checkPhone('0'.repeat(31))).toBe('too-long');
  });
});
