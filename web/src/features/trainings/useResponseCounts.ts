import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchMembers, membersKey } from '../members/api';
import { countResponses, type ResponseCounts } from './counts';
import { useResponseSummary } from './hooks';

/** Coach: per-training answer counts. Returns null while loading (callers just skip the line). */
export function useResponseCounts(trainingIds: string[]): ((trainingId: string) => ResponseCounts | undefined) | null {
  const roster = useQuery({ queryKey: membersKey, queryFn: fetchMembers });
  const rows = useResponseSummary(trainingIds);
  const rosterData = roster.data;
  const rowData = rows.data;
  // The id list is rebuilt on every render; a joined string is a stable dependency.
  const idsKey = trainingIds.join(',');

  return useMemo(() => {
    if (!rosterData) return null;
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length > 0 && !rowData) return null;
    const activeIds = rosterData.filter((p) => p.role === 'member' && p.is_active).map((p) => p.id);
    const counts = countResponses(activeIds, rowData ?? [], ids);
    return (id: string) => counts.get(id);
  }, [rosterData, rowData, idsKey]);
}
