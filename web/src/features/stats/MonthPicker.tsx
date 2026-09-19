import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthLabel, shiftMonth, type MonthKey } from '@/lib/months';
import { tr } from '@/strings/tr';

interface MonthPickerProps {
  month: MonthKey;
  /** The newest month that may be shown (the current one). */
  max: MonthKey;
  onChange: (month: MonthKey) => void;
}

/** ‹ Eylül 2026 › — steps one calendar month at a time; cannot go past the current month. */
export function MonthPicker({ month, max, onChange }: MonthPickerProps) {
  const atMax = month >= max;
  const button = 'flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface disabled:opacity-40';
  return (
    <div role="group" aria-label={tr.stats.monthNav} className="mb-4 flex items-center justify-between gap-2">
      <button type="button" className={button} aria-label={tr.stats.prevMonth} onClick={() => onChange(shiftMonth(month, -1))}>
        <ChevronLeft aria-hidden="true" size={20} />
      </button>
      <p className="text-lg font-bold" aria-live="polite">
        {monthLabel(month)}
      </p>
      <button type="button" className={button} aria-label={tr.stats.nextMonth} disabled={atMax} onClick={() => onChange(shiftMonth(month, 1))}>
        <ChevronRight aria-hidden="true" size={20} />
      </button>
    </div>
  );
}
