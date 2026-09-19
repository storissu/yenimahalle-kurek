import { describe, expect, it } from 'vitest';
import type { ExportRow, MonthRow } from '@/types/database';
import { detailCsvRows, detailFilename, summaryCsvRows, summaryFilename } from './exports';
import { isTied, myPositionText, sortBoard } from './leaderboard';

const row = (over: Partial<MonthRow>): MonthRow => ({ member_id: 'x', full_name: 'X', sessions: 0, training_days: 0, rank: null, ...over });

describe('summaryCsvRows', () => {
  it('has a Turkish header and one line per member, rank blank without sessions', () => {
    const csv = summaryCsvRows([
      row({ member_id: 'a', full_name: 'Ali Yılmaz', sessions: 3, training_days: 2, rank: 1 }),
      row({ member_id: 'b', full_name: 'Becca Kaya', sessions: 0, training_days: 0, rank: null }),
    ]);
    expect(csv).toEqual([
      ['Sıra', 'Ad Soyad', 'Seans', 'Antrenman günü'],
      ['1', 'Ali Yılmaz', '3', '2'],
      ['', 'Becca Kaya', '0', '0'],
    ]);
  });
});

describe('detailCsvRows', () => {
  const base: ExportRow = { training_id: 't', starts_at: '2026-09-22T05:00:00Z', slot_index: 1, member_id: 'a', full_name: 'Ali Yılmaz', status: 'present', note: null };

  it('writes the club-time date, the hour of the session, and Geldi / Gelmedi', () => {
    expect(detailCsvRows([base, { ...base, status: 'absent', note: 'hasta', full_name: 'Becca Kaya' }])).toEqual([
      ['Tarih', 'Seans saati', 'Ad Soyad', 'Durum', 'Not'],
      ['2026-09-22', '09:00–10:00', 'Ali Yılmaz', 'Geldi', ''],
      ['2026-09-22', '09:00–10:00', 'Becca Kaya', 'Gelmedi', 'hasta'],
    ]);
  });

  it('uses the Istanbul date even when UTC is still the previous day', () => {
    expect(detailCsvRows([{ ...base, starts_at: '2026-08-31T21:30:00Z', slot_index: 0 }])[1]).toEqual(['2026-09-01', '00:30–01:30', 'Ali Yılmaz', 'Geldi', '']);
  });
});

describe('filenames', () => {
  it('contain the month', () => {
    expect(summaryFilename('2026-09')).toBe('yoklama-ozet-2026-09.csv');
    expect(detailFilename('2026-09')).toBe('yoklama-detay-2026-09.csv');
  });
});

describe('sortBoard', () => {
  it('orders by rank, then Turkish alphabetical within a shared rank', () => {
    const sorted = sortBoard([
      row({ full_name: 'Zeynep', sessions: 2, rank: 2 }),
      row({ full_name: 'Çağla', sessions: 2, rank: 2 }),
      row({ full_name: 'Ahmet', sessions: 5, rank: 1 }),
      row({ full_name: 'Mert', sessions: 1, rank: 4 }),
    ]);
    expect(sorted.map((r) => r.full_name)).toEqual(['Ahmet', 'Çağla', 'Zeynep', 'Mert']);
  });

  it('does not change the input', () => {
    const input = [row({ full_name: 'B', rank: 2, sessions: 1 }), row({ full_name: 'A', rank: 1, sessions: 2 })];
    sortBoard(input);
    expect(input[0]?.full_name).toBe('B');
  });
});

describe('ties and position text', () => {
  it('recognises shared ranks', () => {
    const rows = [row({ rank: 1 }), row({ rank: 2 }), row({ rank: 2 }), row({ rank: 4 })];
    expect(isTied(rows, 2)).toBe(true);
    expect(isTied(rows, 1)).toBe(false);
    expect(isTied(rows, null)).toBe(false);
  });

  it('describes a member\'s own position', () => {
    expect(myPositionText({ sessions: 3, training_days: 2, rank: 2, participants: 12 })).toBe('2. sıra · 12 kişi arasında');
    expect(myPositionText({ sessions: 0, training_days: 0, rank: null, participants: 12 })).toBe('Bu ay henüz seansınız yok');
    expect(myPositionText(undefined)).toBe('Bu ay henüz seansınız yok');
  });
});
