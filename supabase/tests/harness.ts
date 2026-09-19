// Test harness: runs the real migrations on an in-process Postgres (PGlite) with a
// minimal stand-in for Supabase's `auth` schema and roles, so RLS/grant behaviour is
// exercised without Docker. The stand-in mirrors what Supabase provides:
//   * roles anon / authenticated / service_role (service_role bypasses RLS)
//   * auth.users and auth.uid() (reads the `request.jwt.claim.sub` setting)
//   * default privileges that grant everything in `public` to those roles — which is
//     exactly why our migrations revoke/grant explicitly instead of relying on defaults.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

const SUPABASE_STAND_IN = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    created_at timestamptz not null default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STAND_IN);
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  return db;
}

export const ids = {
  coach1: '00000000-0000-4000-8000-0000000000c1',
  coach2: '00000000-0000-4000-8000-0000000000c2',
  exCoach: '00000000-0000-4000-8000-0000000000c3', // deactivated coach
  member1: '00000000-0000-4000-8000-0000000000a1',
  member2: '00000000-0000-4000-8000-0000000000a2',
  exMember: '00000000-0000-4000-8000-0000000000a3', // deactivated member
} as const;

/** Inserts the standard cast as the superuser (bypasses RLS). */
export async function seedPeople(db: PGlite): Promise<void> {
  const people: Array<[string, string, string, 'coach' | 'member', boolean]> = [
    [ids.coach1, 'ayse.antrenor', 'Ayşe Antrenör', 'coach', true],
    [ids.coach2, 'mehmet.antrenor', 'Mehmet Antrenör', 'coach', true],
    [ids.exCoach, 'eski.antrenor', 'Eski Antrenör', 'coach', false],
    [ids.member1, 'ali', 'Ali Yılmaz', 'member', true],
    [ids.member2, 'becca', 'Becca Kaya', 'member', true],
    [ids.exMember, 'eski.uye', 'Eski Üye', 'member', false],
  ];
  for (const [id, username, fullName, role, active] of people) {
    await db.query('insert into auth.users (id, email) values ($1, $2)', [
      id,
      `${username}@kulup.invalid`,
    ]);
    await db.query(
      `insert into public.profiles (id, username, full_name, role, is_active, must_change_password)
       values ($1, $2, $3, $4, $5, false)`,
      [id, username, fullName, role, active],
    );
  }
}

type Who = 'anon' | 'service' | string; // a user id

/** Runs `fn` with the DB session acting as the given user (Supabase "authenticated"), anon, or service role. */
export async function as<T>(db: PGlite, who: Who, fn: () => Promise<T>): Promise<T> {
  if (who === 'anon') {
    await db.exec(`set role anon; select set_config('request.jwt.claim.sub', '', false);`);
  } else if (who === 'service') {
    await db.exec(`set role service_role; select set_config('request.jwt.claim.sub', '', false);`);
  } else {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${who}', false);`);
  }
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
