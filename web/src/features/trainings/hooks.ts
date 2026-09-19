import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { serverNow } from '@/lib/clock';
import type { RsvpResponse, Training, TrainingResponse } from '@/types/database';
import { useProfile } from '../auth/AuthProvider';
import {
  cancelTraining,
  coachSetRsvp,
  createTraining,
  fetchMyResponses,
  fetchOlderTrainings,
  fetchResponsesFor,
  fetchServerTime,
  fetchTraining,
  fetchTrainingResponses,
  fetchTrainings,
  responseKeys,
  setRsvp,
  trainingKeys,
  updateTraining,
} from './api';
import type { TrainingPayload } from './form';

export function useTrainings() {
  return useQuery({ queryKey: trainingKeys.list, queryFn: () => fetchTrainings(serverNow()) });
}

/** Trainings older than the default window; only fetched once the user asks for them. */
export function useOlderTrainings(enabled: boolean) {
  return useQuery({ queryKey: trainingKeys.older, queryFn: () => fetchOlderTrainings(serverNow()), enabled });
}

/** One training; starts from the already-loaded list when possible so detail pages open instantly. */
export function useTraining(id: string | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: trainingKeys.detail(id ?? ''),
    queryFn: () => fetchTraining(id as string),
    enabled: Boolean(id),
    initialData: () => queryClient.getQueryData<Training[]>(trainingKeys.list)?.find((t) => t.id === id),
    initialDataUpdatedAt: () => queryClient.getQueryState(trainingKeys.list)?.dataUpdatedAt,
  });
}

/** The signed-in member's own answers. */
export function useMyResponses() {
  const me = useProfile();
  return useQuery({ queryKey: responseKeys.mine, queryFn: () => fetchMyResponses(me.id) });
}

/** Coach: every answer for one training. */
export function useTrainingResponses(trainingId: string | undefined) {
  return useQuery({
    queryKey: responseKeys.forTraining(trainingId ?? ''),
    queryFn: () => fetchTrainingResponses(trainingId as string),
    enabled: Boolean(trainingId),
  });
}

/** Coach: answers for several trainings (list summaries). */
export function useResponseSummary(trainingIds: string[]) {
  return useQuery({
    queryKey: responseKeys.summary(trainingIds),
    queryFn: () => fetchResponsesFor(trainingIds),
    enabled: trainingIds.length > 0,
  });
}

/** Keeps the phone's idea of "now" aligned with the server (see lib/clock.ts). */
export function useServerClockSync() {
  return useQuery({
    queryKey: ['server-time'],
    queryFn: fetchServerTime,
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Member answers a training. Optimistic: the UI updates at once and rolls back if the server refuses. */
export function useSetRsvp(trainingId: string) {
  const queryClient = useQueryClient();
  const me = useProfile();

  return useMutation({
    mutationFn: ({ response, note }: { response: RsvpResponse; note: string }) => setRsvp(trainingId, response, note),
    onMutate: async ({ response, note }) => {
      await queryClient.cancelQueries({ queryKey: responseKeys.mine });
      const previous = queryClient.getQueryData<TrainingResponse[]>(responseKeys.mine);
      const optimistic: TrainingResponse = {
        training_id: trainingId,
        member_id: me.id,
        response,
        note: note.trim() || null,
        responded_at: serverNow().toISOString(),
        set_by_coach: false,
      };
      queryClient.setQueryData<TrainingResponse[]>(responseKeys.mine, (current = []) => [
        ...current.filter((r) => r.training_id !== trainingId),
        optimistic,
      ]);
      return { previous };
    },
    onError: (_error, _vars, context) => {
      queryClient.setQueryData(responseKeys.mine, context?.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: responseKeys.all });
      // The deadline may have moved or the training been cancelled meanwhile.
      void queryClient.invalidateQueries({ queryKey: trainingKeys.all });
    },
  });
}

/** Coach records an answer on a member's behalf. */
export function useCoachSetRsvp(trainingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, response, note }: { memberId: string; response: RsvpResponse; note: string }) =>
      coachSetRsvp(trainingId, memberId, response, note),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: responseKeys.all }),
  });
}

export function useSaveTraining(id?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TrainingPayload) => (id ? updateTraining(id, payload) : createTraining(payload)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: trainingKeys.all }),
  });
}

export function useCancelTraining(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => cancelTraining(id, reason),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: trainingKeys.all }), queryClient.invalidateQueries({ queryKey: responseKeys.all })]),
  });
}
