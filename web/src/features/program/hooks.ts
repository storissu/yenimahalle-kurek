import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchBoats, boatsKey } from '../boats/api';
import { fetchMemberNames, memberNamesKey } from '../members/api';
import { tr } from '@/strings/tr';
import { fetchProgram, programKeys, saveProgram } from './api';
import type { SavePayload } from './model';

export function useProgram(trainingId: string | undefined) {
  return useQuery({
    queryKey: programKeys.detail(trainingId ?? ''),
    queryFn: () => fetchProgram(trainingId as string),
    enabled: Boolean(trainingId),
  });
}

export function useSaveProgram(trainingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, publish }: { payload: SavePayload; publish: boolean }) => saveProgram(trainingId, payload, publish),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: programKeys.all }),
  });
}

export function useBoats() {
  return useQuery({ queryKey: boatsKey, queryFn: fetchBoats });
}

/** id → display name for everyone a member may see (active members). Falls back to "Eski üye". */
export function useMemberNames() {
  const query = useQuery({ queryKey: memberNamesKey, queryFn: fetchMemberNames, staleTime: 5 * 60_000 });
  const names = useMemo(() => new Map((query.data ?? []).map((m) => [m.id, m.full_name])), [query.data]);
  const nameOf = (id: string) => names.get(id) ?? tr.program.formerMember;
  return { query, nameOf };
}
