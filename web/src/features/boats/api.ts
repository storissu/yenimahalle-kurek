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
  /** Must always be rowed with exactly `capacity` people (C4X = 4); programs cannot be published otherwise. */
  requires_full_crew: boolean;
  /** Has a dümenci (coxswain) besides the rowers (C4X); programs cannot be published without one. */
  has_coxswain: boolean;
}

export async function createBoat(input: BoatInput, sortOrder: number): Promise<void> {
  const { error } = await supabase.from('boats').insert({ ...input, sort_order: sortOrder });
  if (error) throw error;
}

export async function updateBoat(id: string, input: BoatInput): Promise<void> {
  const { error } = await supabase.from('boats').update(input).eq('id', id);
  if (error) throw error;
}
