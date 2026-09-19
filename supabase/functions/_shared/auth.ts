import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';

export interface Caller {
  /** Service-role client: bypasses RLS. Never expose it or its results without checking the caller first. */
  admin: SupabaseClient;
  callerId: string;
  role: 'coach' | 'member';
}

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, `Sunucu yapılandırması eksik: ${name}`);
  return value;
}

export function loginEmailDomain(): string {
  return Deno.env.get('LOGIN_EMAIL_DOMAIN') ?? 'kulup.invalid';
}

/** Validates the bearer token with Supabase Auth and loads the caller's active profile. */
export async function requireUser(req: Request): Promise<Caller> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.toLowerCase().startsWith('bearer ')) throw new HttpError(401, 'Oturum açmanız gerekiyor');

  const url = env('SUPABASE_URL');
  const userClient = createClient(url, env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'Oturum geçersiz veya süresi dolmuş');

  const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profileError) throw new HttpError(500, 'Profil okunamadı');
  if (!profile || !profile.is_active) throw new HttpError(403, 'Hesabınız devre dışı');

  return { admin, callerId: data.user.id, role: profile.role };
}

export async function requireCoach(req: Request): Promise<Caller> {
  const caller = await requireUser(req);
  if (caller.role !== 'coach') throw new HttpError(403, 'Bu işlem için antrenör yetkisi gerekir');
  return caller;
}
