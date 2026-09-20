import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { matchesQuery } from '@/lib/search';
import { tr } from '@/strings/tr';

export interface Candidate {
  id: string;
  name: string;
}

interface WalkInDialogProps {
  open: boolean;
  rangeLabel: string;
  candidates: Candidate[];
  onPick: (memberId: string) => void;
  onClose: () => void;
}

function Body({ candidates, onPick, onClose }: Pick<WalkInDialogProps, 'candidates' | 'onPick' | 'onClose'>) {
  const [query, setQuery] = useState('');
  const shown = candidates.filter((c) => matchesQuery([c.name], query));

  return (
    <>
      <div>
        <label htmlFor="walk-in-search" className="sr-only">
          {tr.attendance.pickerSearch}
        </label>
        <input
          id="walk-in-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr.attendance.pickerSearch}
          autoComplete="off"
          className="min-h-12 w-full rounded-xl border border-border bg-surface px-3.5 text-fg placeholder:text-muted"
        />
      </div>

      {candidates.length === 0 && <p className="text-sm text-muted">{tr.attendance.pickerNone}</p>}
      {candidates.length > 0 && shown.length === 0 && <p className="text-sm text-muted">{tr.members.noResults}</p>}

      <ul className="flex max-h-[45dvh] flex-col gap-2 overflow-y-auto">
        {shown.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onPick(c.id)}
              className="flex min-h-12 w-full items-center rounded-xl border border-border bg-surface px-3.5 text-left font-semibold"
            >
              {c.name}
            </button>
          </li>
        ))}
      </ul>

      <Button size="lg" fullWidth onClick={onClose}>
        {tr.attendance.pickerDone}
      </Button>
    </>
  );
}

/** Adds someone who rowed but was not on the list for this session. Picked people vanish from the list. */
export function WalkInDialog({ open, rangeLabel, candidates, onPick, onClose }: WalkInDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={tr.attendance.pickerTitle(rangeLabel)}>
      {open && <Body candidates={candidates} onPick={onPick} onClose={onClose} />}
    </Dialog>
  );
}
