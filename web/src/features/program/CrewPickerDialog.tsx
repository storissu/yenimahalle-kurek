import { MessageSquareText } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';
import type { Boat } from '@/types/database';
import { assignedInSlot, crewOf, memberSlots, type ProgramDraft } from './model';

export interface RosterMemberInfo {
  id: string;
  name: string;
  answer: 'attending' | 'not_attending' | undefined;
  /** The member's RSVP note, e.g. "9'dan sonraya yazar mısınız?". */
  note: string | null;
}

interface CrewPickerDialogProps {
  target: { slot: number; boat: Boat } | null;
  draft: ProgramDraft;
  roster: RosterMemberInfo[];
  rangeLabel: (slot: number) => string;
  boatName: (boatId: string) => string;
  onToggle: (memberId: string) => void;
  onClose: () => void;
}

interface PickerBodyProps extends Omit<CrewPickerDialogProps, 'target'> {
  slot: number;
  boat: Boat;
}

function Row({ member, checked, disabledReason, load, onToggle }: { member: RosterMemberInfo; checked: boolean; disabledReason: string | null; load: number; onToggle: () => void }) {
  const disabled = disabledReason !== null;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled}
      onClick={() => !disabled && onToggle()}
      className={cn(
        'flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left',
        checked ? 'border-primary bg-primary-soft' : 'border-border bg-surface',
        disabled && 'opacity-60',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-bold', checked ? 'border-primary bg-primary text-primary-fg' : 'border-border')}
      >
        {checked ? '✓' : ''}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{member.name}</span>
        {disabledReason && <span className="block text-sm text-muted">{disabledReason}</span>}
        {member.note && (
          <span className="mt-0.5 flex items-start gap-1.5 text-sm text-warning">
            <MessageSquareText aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
            <span className="break-words">{member.note}</span>
          </span>
        )}
      </span>
      {load > 0 && <Badge>{tr.program.seasonCount(load)}</Badge>}
    </button>
  );
}

function PickerBody({ slot, boat, draft, roster, rangeLabel, boatName, onToggle, onClose }: PickerBodyProps) {
  const inBoat = crewOf(draft, slot, boat.id);
  const elsewhere = assignedInSlot(draft, slot);
  const full = inBoat.length >= boat.capacity;

  const renderRow = (member: RosterMemberInfo) => {
    const checked = inBoat.includes(member.id);
    const otherBoat = elsewhere.get(member.id);
    const disabledReason = checked ? null : otherBoat && otherBoat !== boat.id ? tr.program.inOtherBoat(boatName(otherBoat)) : full ? tr.program.boatFull : null;
    return <Row key={member.id} member={member} checked={checked} disabledReason={disabledReason} load={memberSlots(draft, member.id).length} onToggle={() => onToggle(member.id)} />;
  };

  const attending = roster.filter((m) => m.answer === 'attending');
  const noAnswer = roster.filter((m) => m.answer === undefined);
  const notAttending = roster.filter((m) => m.answer === 'not_attending');
  const others = [...noAnswer, ...notAttending];
  // People already in this boat must stay visible even if they are in the collapsed group.
  const othersOpen = others.some((m) => inBoat.includes(m.id)) || attending.length === 0;

  return (
    <>
      <p className="-mt-2 flex items-center justify-between text-sm text-muted">
        <span>{tr.program.pickerHint}</span>
        <Badge tone={full ? 'success' : 'neutral'}>{tr.program.crewCount(inBoat.length, boat.capacity)}</Badge>
      </p>

      {roster.length === 0 && <p className="text-sm text-muted">{tr.program.noMembersToPick}</p>}

      {attending.length > 0 && (
        <section aria-label={tr.program.attendingGroup} className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">{tr.program.attendingGroup}</h3>
          {attending.map(renderRow)}
        </section>
      )}

      {others.length > 0 && (
        <details open={othersOpen} className="flex flex-col gap-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-bold">{tr.program.otherMembers} ({others.length})</summary>
          <div className="flex flex-col gap-2">
            {noAnswer.map((m) => renderRow({ ...m }))}
            {notAttending.map((m) => renderRow({ ...m }))}
          </div>
        </details>
      )}

      <Button size="lg" fullWidth onClick={onClose}>
        {tr.program.pickerDone}
      </Button>
      <span className="sr-only" aria-live="polite">
        {rangeLabel(slot)} {boat.name} {tr.program.crewCount(inBoat.length, boat.capacity)}
      </span>
    </>
  );
}

/** Multi-select of members for one boat in one hour. Changes apply immediately (no separate "apply"). */
export function CrewPickerDialog({ target, ...rest }: CrewPickerDialogProps) {
  return (
    <Dialog open={target !== null} onClose={rest.onClose} title={target ? tr.program.pickerTitle(target.boat.name, rest.rangeLabel(target.slot)) : ''}>
      {target && <PickerBody slot={target.slot} boat={target.boat} {...rest} />}
    </Dialog>
  );
}
