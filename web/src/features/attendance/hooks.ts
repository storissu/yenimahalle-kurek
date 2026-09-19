import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MonthKey } from '@/lib/months';
import { useProfile } from '../auth/AuthProvider';
import { trainingKeys } from '../trainings/api';
import {
  attendanceKeys,
  fetchAttendanceExport,
  fetchCoachMonthTable,
  fetchLeaderboard,
  fetchMemberAttendance,
  fetchMyMonthStats,
  fetchTrainingAttendance,
  fetchTrainingCounts,
  saveAttendance,
  statsKeys,
} from './api';
import type { SavePayloadRow } from './model';

/** Coach: what has been recorded for one training. */
export function useTrainingAttendance(trainingId: string | undefined) {
  return useQuery({
    queryKey: attendanceKeys.training(trainingId ?? ''),
    queryFn: () => fetchTrainingAttendance(trainingId as string),
    enabled: Boolean(trainingId),
  });
}

/** The signed-in member's own records. */
export function useMyAttendance() {
  const me = useProfile();
  return useQuery({ queryKey: attendanceKeys.mine, queryFn: () => fetchMemberAttendance(me.id) });
}

/** Coach: one member's records. */
export function useMemberAttendance(memberId: string | undefined) {
  return useQuery({
    queryKey: attendanceKeys.member(memberId ?? ''),
    queryFn: () => fetchMemberAttendance(memberId as string),
    enabled: Boolean(memberId),
  });
}

/** Coach: "5 kişi · 9 seans" per training, for lists. */
export function useTrainingCounts(trainingIds: string[]) {
  return useQuery({
    queryKey: attendanceKeys.counts(trainingIds),
    queryFn: () => fetchTrainingCounts(trainingIds),
    enabled: trainingIds.length > 0,
  });
}

export function useSaveAttendance(trainingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rows, complete }: { rows: SavePayloadRow[]; complete: boolean }) => saveAttendance(trainingId, rows, complete),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: attendanceKeys.all }),
        queryClient.invalidateQueries({ queryKey: statsKeys.all }),
        queryClient.invalidateQueries({ queryKey: trainingKeys.all }), // status may have become "completed"
      ]),
  });
}

export const useLeaderboard = (month: MonthKey) => useQuery({ queryKey: statsKeys.leaderboard(month), queryFn: () => fetchLeaderboard(month) });
export const useMyMonthStats = (month: MonthKey) => useQuery({ queryKey: statsKeys.mine(month), queryFn: () => fetchMyMonthStats(month) });
export const useCoachMonthTable = (month: MonthKey) => useQuery({ queryKey: statsKeys.table(month), queryFn: () => fetchCoachMonthTable(month) });

/** Loaded on demand (export button), not on page load. */
export const loadExport = (month: MonthKey) => fetchAttendanceExport(month);
