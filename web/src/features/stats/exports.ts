// The two CSV files a coach can export for a month. Built from database rows; pure and testable.
import type { MonthKey } from '@/lib/months';
import type { ExportRow, MonthRow } from '@/types/database';
import { sessionRangeLabel } from '../trainings/schedule';

/** Sıra;Ad Soyad;Seans;Antrenman günü — one line per active member, best first. */
export function summaryCsvRows(rows: MonthRow[]): string[][] {
  return [
    ['Sıra', 'Ad Soyad', 'Seans', 'Antrenman günü'],
    ...rows.map((r) => [r.rank === null ? '' : String(r.rank), r.full_name, String(r.sessions), String(r.training_days)]),
  ];
}

/** "2026-09-19" in club time (spreadsheet-friendly, unlike "19 Eylül"). */
const isoDate = (instant: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(instant));

/** One line per person per session, including absences. */
export function detailCsvRows(rows: ExportRow[]): string[][] {
  return [
    ['Tarih', 'Seans saati', 'Ad Soyad', 'Durum', 'Not'],
    ...rows.map((r) => [
      isoDate(r.starts_at),
      sessionRangeLabel({ starts_at: r.starts_at }, r.slot_index),
      r.full_name,
      r.status === 'present' ? 'Geldi' : 'Gelmedi',
      r.note ?? '',
    ]),
  ];
}

export const summaryFilename = (month: MonthKey) => `yoklama-ozet-${month}.csv`;
export const detailFilename = (month: MonthKey) => `yoklama-detay-${month}.csv`;
