import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchBoats, boatsKey } from '../boats/api';
import { fetchMemberNames, memberNamesKey, type DirectoryEntry } from '../members/api';
import { tr } from '@/strings/tr';
import { trainingKeys } from '../trainings/api';
import { refreshWeather, weatherKeys } from '../weather/api';
import { fetchProgram, fetchPublishedTrainingIds, programKeys, saveProgram } from './api';
import type { SavePayload } from './model';

export function useProgram(trainingId: string | undefined) {
  return useQuery({
    queryKey: programKeys.detail(trainingId ?? ''),
    queryFn: () => fetchProgram(trainingId as string),
    enabled: Boolean(trainingId),
  });
}

/** Which trainings have a published program (answers to those are locked). */
export function usePublishedTrainingIds() {
  return useQuery({ queryKey: programKeys.published, queryFn: fetchPublishedTrainingIds, staleTime: 30_000 });
}

export function useSaveProgram(trainingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, publish, notify }: { payload: SavePayload; publish: boolean; notify: boolean }) => saveProgram(trainingId, payload, publish, notify),
    onSuccess: () => {
      // The program decides how many sessions the training has, so the forecast rows (one per session) change too.
      void refreshWeather(trainingId)
        .then(() => queryClient.invalidateQueries({ queryKey: weatherKeys.all }))
        .catch(() => undefined);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: programKeys.all }),
        queryClient.invalidateQueries({ queryKey: trainingKeys.all }),
      ]);
    },
  });
}

export function useBoats() {
  return useQuery({ queryKey: boatsKey, queryFn: fetchBoats });
}

/**
 * id → display name (and phone) for everyone a member may see (active members). Falls back to "Eski üye".
 * `contactOf` is null for people who are no longer in the directory (deactivated members).
 */
export function useMemberNames() {
  const query = useQuery({ queryKey: memberNamesKey, queryFn: fetchMemberNames, staleTime: 5 * 60_000 });
  const entries = useMemo(() => new Map((query.data ?? []).map((m) => [m.id, m])), [query.data]);
  const nameOf = (id: string) => entries.get(id)?.full_name ?? tr.program.formerMember;
  const contactOf = (id: string): DirectoryEntry | null => entries.get(id) ?? null;
  return { query, nameOf, contactOf };
}
