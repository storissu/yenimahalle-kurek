import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { tr } from '@/strings/tr';
import { supabase } from './supabase';

/** Error carrying the (Turkish) message an Edge Function returned, plus its HTTP status. */
export class FunctionError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'FunctionError';
  }
}

/** Calls an Edge Function with the signed-in user's JWT and unwraps its `{ error }` responses. */
export async function invokeFunction<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new FunctionError(payload?.error ?? tr.common.errorGeneric, error.context.status);
    }
    if (error instanceof FunctionsFetchError) throw new FunctionError(tr.common.errorNetwork);
    throw new FunctionError(tr.common.errorGeneric);
  }
  return data as T;
}
