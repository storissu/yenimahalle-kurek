import { supabase } from '@/lib/supabase';
import { payloadAsJson, type ProgramData, type SavePayload } from './model';

export const programKeys = {
  all: ['program'] as const,
  detail: (trainingId: string) => ['program', trainingId] as const,
  published: ['program', 'published-ids'] as const,
};

/**
 * Ids of the trainings whose program is published. Members can only see published programs (RLS), so for them
 * this is simply "every program they can see". It tells the RSVP screens that answers are locked.
 */
export async function fetchPublishedTrainingIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from('training_programs').select('training_id').eq('status', 'published');
  if (error) throw error;
  return new Set(data.map((row) => row.training_id));
}

/**
 * A training's program. Coaches also get drafts; for members the database returns rows only once the
 * program is published (an unpublished program simply looks like "no program").
 */
export async function fetchProgram(trainingId: string): Promise<ProgramData> {
  const [program, assignments, crew] = await Promise.all([
    supabase.from('training_programs').select('*').eq('training_id', trainingId).maybeSingle(),
    supabase.from('program_assignments').select('*').eq('training_id', trainingId),
    supabase.from('program_crew').select('*').eq('training_id', trainingId),
  ]);
  if (program.error) throw program.error;
  if (assignments.error) throw assignments.error;
  if (crew.error) throw crew.error;
  return { program: program.data, assignments: assignments.data, crew: crew.data };
}

/**
 * Replaces the whole program atomically. `publish=false` saves a draft (and un-publishes a published program).
 * `notify` (only meaningful when publishing) sends the members their notifications.
 */
export async function saveProgram(trainingId: string, payload: SavePayload, publish: boolean, notify: boolean): Promise<void> {
  const { error } = await supabase.rpc('save_program', {
    p_training_id: trainingId,
    p_payload: payloadAsJson(payload),
    p_publish: publish,
    p_notify: notify,
  });
  if (error) throw error;
}
