import { supabase } from '@/lib/supabase';
import type { Boat } from '@/types/database';

export const boatsKey = ['boats'] as const;

export async function fetchBoats(): Promise<Boat[]> {
  const { data, error } = await supabase.from('boats').select('*').order('sort_order').order('name');
  if (error) throw error;
  return data;
}

export interface BoatInput {
  name: string;
  capacity: number;
  is_active: boolean;
}

export async function createBoat(input: BoatInput, sortOrder: number): Promise<void> {
  const { error } = await supabase.from('boats').insert({ ...input, sort_order: sortOrder });
  if (error) throw error;
}

export async function updateBoat(id: string, input: BoatInput): Promise<void> {
  const { error } = await supabase.from('boats').update(input).eq('id', id);
  if (error) throw error;
}
