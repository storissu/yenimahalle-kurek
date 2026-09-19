import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { requireEnv } from './env';

// Imported only after main.tsx has verified the environment (see mountApp).
const env = requireEnv();

export const supabase = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // no OAuth / magic links in this app
  },
});

export const loginEmailDomain = env.VITE_LOGIN_EMAIL_DOMAIN;
export const vapidPublicKey = env.VITE_VAPID_PUBLIC_KEY;
