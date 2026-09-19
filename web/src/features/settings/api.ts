import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type ClubSettings = Database['public']['Tables']['club_settings']['Row'];

export const settingsKey = ['club-settings'] as const;

export async function fetchClubSettings(): Promise<ClubSettings> {
  const { data, error } = await supabase.from('club_settings').select('*').single();
  if (error) throw error;
  return data;
}

export function useClubSettings() {
  return useQuery({ queryKey: settingsKey, queryFn: fetchClubSettings, staleTime: 10 * 60_000 });
}
