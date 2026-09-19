// Authentication for functions that pg_cron (not a person) calls: a shared secret in the
// `x-cron-secret` header, compared in constant time. The same value lives in the function secret
// CRON_SECRET and in the database Vault (see docs/RUNBOOK.md).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function hasValidCronSecret(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET');
  const given = req.headers.get('x-cron-secret');
  return Boolean(expected && expected.length >= 16 && given && safeEqual(expected, given));
}

/** Service-role client (bypasses RLS). Only use after authenticating the caller. */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new HttpError(500, 'Sunucu yapılandırması eksik');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function requireCron(req: Request): SupabaseClient {
  if (!hasValidCronSecret(req)) throw new HttpError(401, 'Yetkisiz');
  return serviceClient();
}
