import { syncServerTime } from '@/lib/clock';
import { supabase } from '@/lib/supabase';
import { HOUR_MS } from '@/lib/time';
import type { RsvpResponse, Training, TrainingResponse } from '@/types/database';
import type { TrainingPayload } from './form';

export const trainingKeys = {
  all: ['trainings'] as const,
  list: ['trainings', 'list'] as const,
  detail: (id: string) => ['trainings', 'detail', id] as const,
};

export const responseKeys = {
  all: ['responses'] as const,
  mine: ['responses', 'mine'] as const,
  forTraining: (trainingId: string) => ['responses', 'training', trainingId] as const,
  summary: (trainingIds: string[]) => ['responses', 'summary', ...trainingIds] as const,
};

/** How far back the lists reach. Older history is paginated in Phase 4. */
const HISTORY_DAYS = 90;
const LIST_LIMIT = 300;

export async function fetchTrainings(now: Date = new Date()): Promise<Training[]> {
  const since = new Date(now.getTime() - HISTORY_DAYS * 24 * HOUR_MS).toISOString();
  const { data, error } = await supabase
    .from('trainings')
    .select('*')
    .gte('starts_at', since)
    .order('starts_at', { ascending: true })
    .limit(LIST_LIMIT);
  if (error) throw error;
  return data;
}

export async function fetchTraining(id: string): Promise<Training | null> {
  const { data, error } = await supabase.from('trainings').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createTraining(payload: TrainingPayload): Promise<Training> {
  const { data, error } = await supabase.from('trainings').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

export async function updateTraining(id: string, payload: TrainingPayload): Promise<Training> {
  const { data, error } = await supabase.from('trainings').update(payload).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function cancelTraining(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_training', { p_training_id: id, p_reason: reason });
  if (error) throw error;
}

/** The signed-in member's own answers (RLS would also hide everyone else's). */
export async function fetchMyResponses(memberId: string): Promise<TrainingResponse[]> {
  const { data, error } = await supabase.from('training_responses').select('*').eq('member_id', memberId);
  if (error) throw error;
  return data;
}

/** Coach: every answer for one training. */
export async function fetchTrainingResponses(trainingId: string): Promise<TrainingResponse[]> {
  const { data, error } = await supabase.from('training_responses').select('*').eq('training_id', trainingId);
  if (error) throw error;
  return data;
}

/** Coach: answers for several trainings at once (list summaries). */
export async function fetchResponsesFor(trainingIds: string[]): Promise<Array<Pick<TrainingResponse, 'training_id' | 'member_id' | 'response'>>> {
  if (trainingIds.length === 0) return [];
  const { data, error } = await supabase
    .from('training_responses')
    .select('training_id, member_id, response')
    .in('training_id', trainingIds);
  if (error) throw error;
  return data;
}

export async function setRsvp(trainingId: string, response: RsvpResponse, note: string): Promise<void> {
  const { error } = await supabase.rpc('set_rsvp', { p_training_id: trainingId, p_response: response, p_note: note });
  if (error) throw error;
}

export async function coachSetRsvp(trainingId: string, memberId: string, response: RsvpResponse, note: string): Promise<void> {
  const { error } = await supabase.rpc('coach_set_rsvp', {
    p_training_id: trainingId,
    p_member_id: memberId,
    p_response: response,
    p_note: note,
  });
  if (error) throw error;
}

/** Asks the database for its time and records the phone's clock offset (see lib/clock.ts). */
export async function fetchServerTime(): Promise<string> {
  const requestedAt = Date.now();
  const { data, error } = await supabase.rpc('server_now');
  const receivedAt = Date.now();
  if (error) throw error;
  syncServerTime(data, requestedAt, receivedAt);
  return data;
}
