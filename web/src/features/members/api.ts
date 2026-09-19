import { invokeFunction } from '@/lib/functions';
import { supabase } from '@/lib/supabase';
import type { Profile, UserRole } from '@/types/database';

export const membersKey = ['members'] as const;

/** Every account, coaches first, then alphabetical in Turkish collation (Ç, Ğ, İ, Ö, Ş, Ü sort correctly). */
export async function fetchMembers(): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('*');
  if (error) throw error;
  return sortMembers(data);
}

export function sortMembers(list: Profile[]): Profile[] {
  return [...list].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'coach' ? -1 : 1;
    return a.full_name.localeCompare(b.full_name, 'tr');
  });
}

export interface NewMemberInput {
  full_name: string;
  username: string;
  role: UserRole;
  phone?: string;
}

export interface Credentials {
  username: string;
  password: string;
}

export const createMember = (input: NewMemberInput) =>
  invokeFunction<Credentials & { id: string }>('admin-create-member', { ...input });

export const resetPassword = (userId: string) => invokeFunction<Credentials>('admin-reset-password', { user_id: userId });

export const setMemberActive = (userId: string, isActive: boolean) =>
  invokeFunction<{ ok: true; is_active: boolean }>('admin-set-active', { user_id: userId, is_active: isActive });

export const memberNamesKey = ['member-directory'] as const;

/** What every signed-in user may see of an active member: name and phone number — no username, role or status. */
export interface DirectoryEntry {
  id: string;
  full_name: string;
  phone: string | null;
}

export async function fetchMemberNames(): Promise<DirectoryEntry[]> {
  const { data, error } = await supabase.from('member_directory').select('id, full_name, phone');
  if (error) throw error;
  return data;
}
