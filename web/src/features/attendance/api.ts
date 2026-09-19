import { supabase } from '@/lib/supabase';
import type { AttendanceRecord, ExportRow, MonthRow, MyMonthStatsRow, TrainingCountRow } from '@/types/database';
import type { SavePayloadRow } from './model';
import { monthStartDate, type MonthKey } from '@/lib/months';
import type { Json } from '@/types/database';

export const attendanceKeys = {
  all: ['attendance'] as const,
  training: (trainingId: string) => ['attendance', 'training', trainingId] as const,
  mine: ['attendance', 'mine'] as const,
  member: (memberId: string) => ['attendance', 'member', memberId] as const,
  counts: (ids: string[]) => ['attendance', 'counts', ...ids] as const,
};

export const statsKeys = {
  all: ['stats'] as const,
  leaderboard: (month: MonthKey) => ['stats', 'leaderboard', month] as const,
  mine: (month: MonthKey) => ['stats', 'mine', month] as const,
  table: (month: MonthKey) => ['stats', 'table', month] as const,
};

/** Coach: everything recorded for one training. */
export async function fetchTrainingAttendance(trainingId: string): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase.from('attendance_records').select('*').eq('training_id', trainingId);
  if (error) throw error;
  return data;
}

/** A member's own records (RLS would hide everyone else's), newest first. */
export async function fetchMemberAttendance(memberId: string): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('member_id', memberId)
    .order('recorded_at', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data;
}

export async function saveAttendance(trainingId: string, rows: SavePayloadRow[], complete: boolean): Promise<void> {
  const { error } = await supabase.rpc('save_attendance', {
    p_training_id: trainingId,
    p_rows: rows as unknown as Json,
    p_complete: complete,
  });
  if (error) throw error;
}

export async function fetchLeaderboard(month: MonthKey): Promise<MonthRow[]> {
  const { data, error } = await supabase.rpc('monthly_leaderboard', { p_month: monthStartDate(month) });
  if (error) throw error;
  return data;
}

export async function fetchMyMonthStats(month: MonthKey): Promise<MyMonthStatsRow | undefined> {
  const { data, error } = await supabase.rpc('my_month_stats', { p_month: monthStartDate(month) });
  if (error) throw error;
  return data[0];
}

export async function fetchCoachMonthTable(month: MonthKey): Promise<MonthRow[]> {
  const { data, error } = await supabase.rpc('coach_month_table', { p_month: monthStartDate(month) });
  if (error) throw error;
  return data;
}

export async function fetchAttendanceExport(month: MonthKey): Promise<ExportRow[]> {
  const { data, error } = await supabase.rpc('attendance_export', { p_month: monthStartDate(month) });
  if (error) throw error;
  return data;
}

export async function fetchTrainingCounts(trainingIds: string[]): Promise<TrainingCountRow[]> {
  if (trainingIds.length === 0) return [];
  const { data, error } = await supabase.rpc('training_attendance_counts', { p_training_ids: trainingIds });
  if (error) throw error;
  return data;
}
