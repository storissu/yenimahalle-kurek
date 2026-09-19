import { supabase } from '@/lib/supabase';
import { payloadAsJson, type ProgramData, type SavePayload } from './model';

export const programKeys = {
  all: ['program'] as const,
  detail: (trainingId: string) => ['program', trainingId] as const,
};

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

/** Replaces the whole program atomically. `publish=false` saves a draft (and un-publishes a published program). */
export async function saveProgram(trainingId: string, payload: SavePayload, publish: boolean): Promise<void> {
  const { error } = await supabase.rpc('save_program', {
    p_training_id: trainingId,
    p_payload: payloadAsJson(payload),
    p_publish: publish,
  });
  if (error) throw error;
}
