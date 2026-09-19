// Pure helpers (no Deno/npm imports) so they can be unit-tested with Vitest.
// The same username rules live in the web app (web/src/lib/username.ts) and in the
// database CHECK constraint on profiles.username — keep all three in sync.

/** ASCII only on purpose: avoids Turkish dotted/dotless-i case-folding surprises. */
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

/** Supabase Auth needs an email; members never see or use it. */
export function toLoginEmail(username: string, domain: string): string {
  return `${username}@${domain}`;
}

// No 0/O, 1/l/I: passwords are read aloud or typed from a chat message.
const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALPHABET = LETTERS + DIGITS;

/** Uniform random integer in [0, max) using rejection sampling over crypto randomness. */
export function secureRandomInt(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const value = buf[0] as number;
    if (value < limit) return value % max;
  }
}

/**
 * One-time password: letters + digits (satisfies the project's `letters_digits` policy),
 * guaranteed to contain at least one of each.
 */
export function generatePassword(length = 10, randomInt: (max: number) => number = secureRandomInt): string {
  if (length < 8) throw new Error('Şifre en az 8 karakter olmalı');
  const chars: string[] = [];
  chars.push(LETTERS[randomInt(LETTERS.length)] as string);
  chars.push(DIGITS[randomInt(DIGITS.length)] as string);
  while (chars.length < length) {
    chars.push(ALPHABET[randomInt(ALPHABET.length)] as string);
  }
  // Fisher–Yates shuffle so the guaranteed characters aren't always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}
