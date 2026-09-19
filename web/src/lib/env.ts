import { z } from 'zod';

const schema = z.object({
  VITE_SUPABASE_URL: z.url({ message: 'VITE_SUPABASE_URL geçerli bir adres olmalı (https://….supabase.co)' }),
  VITE_SUPABASE_ANON_KEY: z.string().min(20, { message: 'VITE_SUPABASE_ANON_KEY eksik' }),
  // Optional at build time: without it the app works, but push notifications stay disabled.
  VITE_VAPID_PUBLIC_KEY: z.string().optional(),
  VITE_LOGIN_EMAIL_DOMAIN: z.string().min(3).default('kulup.invalid'),
});

export type Env = z.infer<typeof schema>;
export type EnvResult = { ok: true; env: Env } | { ok: false; issues: string[] };

export function parseEnv(raw: Record<string, unknown>): EnvResult {
  // Empty strings in .env files should count as "not set".
  const cleaned = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === '' ? undefined : v]));
  const parsed = schema.safeParse(cleaned);
  if (parsed.success) return { ok: true, env: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => i.message) };
}

export const envResult: EnvResult = parseEnv(import.meta.env);

export function requireEnv(): Env {
  if (!envResult.ok) throw new Error(`Invalid environment: ${envResult.issues.join('; ')}`);
  return envResult.env;
}
