// Mirrors supabase/functions/_shared/username.ts and the DB CHECK constraint on profiles.username.
// ASCII only on purpose: it avoids Turkish dotted/dotless-i case-folding bugs.

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

/** Supabase Auth requires an email address; members only ever see their username. */
export function toLoginEmail(username: string, domain: string): string {
  return `${normalizeUsername(username)}@${domain}`;
}
