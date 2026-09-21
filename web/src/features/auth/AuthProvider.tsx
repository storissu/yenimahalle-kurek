import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { forgetThisDeviceOnServer, syncPushSubscription } from '@/lib/push';
import { loginEmailDomain, supabase } from '@/lib/supabase';
import { toLoginEmail } from '@/lib/username';
import type { Profile } from '@/types/database';
import type { AuthState } from './access';

interface AuthContextValue {
  state: AuthState;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-reads the profile (e.g. after the forced password change). Resolves once fresh data is in. */
  refreshProfile: () => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // undefined = still restoring the session from storage
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession((current) => current ?? data.session));
    // Keep this callback synchronous: awaiting other Supabase calls inside it can deadlock the client.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => fetchProfile(userId as string),
    enabled: Boolean(userId),
    // A coach can change this person's role (or deactivate them) at any time: look again whenever the app comes back to the front.
    refetchOnWindowFocus: 'always',
  });

  const profile = profileQuery.data;
  const state: AuthState = useMemo(() => {
    if (session === undefined) return { status: 'loading' };
    if (!session) return { status: 'signedOut' };
    if (profileQuery.isError && !profile) return { status: 'error' };
    if (profileQuery.isPending) return { status: 'loading' };
    if (!profile || !profile.is_active) return { status: 'blocked' };
    return { status: 'signedIn', profile };
  }, [session, profile, profileQuery.isError, profileQuery.isPending]);

  const activeProfileId = state.status === 'signedIn' ? state.profile.id : undefined;
  useEffect(() => {
    if (activeProfileId) void syncPushSubscription();
  }, [activeProfileId]);

  const signIn = useCallback(async (username: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: toLoginEmail(username, loginEmailDomain),
      password,
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await forgetThisDeviceOnServer(); // needs the session, so before signOut
    await supabase.auth.signOut();
    queryClient.clear(); // never leave one member's cached data on a shared phone
  }, [queryClient]);

  const refreshProfile = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['profile', userId] });
  }, [queryClient, userId]);

  const retry = useCallback(() => void profileQuery.refetch(), [profileQuery]);

  const value = useMemo(
    () => ({ state, signIn, signOut, refreshProfile, retry }),
    [state, signIn, signOut, refreshProfile, retry],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** For screens rendered behind the access gate, where a signed-in profile is guaranteed. */
export function useProfile(): Profile {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('useProfile used outside a signed-in screen');
  return state.profile;
}
