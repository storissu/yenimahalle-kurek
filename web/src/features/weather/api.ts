import { invokeFunction } from '@/lib/functions';
import { supabase } from '@/lib/supabase';
import type { WeatherSnapshot } from '@/types/database';

export const weatherKeys = {
  all: ['weather'] as const,
  forTraining: (trainingId: string) => ['weather', trainingId] as const,
};

/** Forecast rows of a training, one per session, in session order. */
export async function fetchWeather(trainingId: string): Promise<WeatherSnapshot[]> {
  const { data, error } = await supabase.from('weather_snapshots').select('*').eq('training_id', trainingId).order('slot_index');
  if (error) throw error;
  return data;
}

/** Asks the server to fetch a fresh forecast now (coaches only). The cron job also does it every 3 hours. */
export async function refreshWeather(trainingId: string): Promise<{ updated: number }> {
  return invokeFunction('refresh-weather', { training_id: trainingId });
}
