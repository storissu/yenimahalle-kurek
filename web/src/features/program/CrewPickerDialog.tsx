import { MessageSquareText } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { BoatIcon } from '@/components/ui/BoatIcon';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';
import type { Boat } from '@/types/database';
import { boatStyle } from './boatStyle';
import { conflictFor, memberSessions, type ProgramDraft, type SessionDraft } from './model';

export interface RosterMemberInfo {
  id: string;
  name: string;
  answer: 'attending' | 'not_attending' | undefined;
  /** The member's RSVP note, e.g. "9'dan sonraya yazar mısınız?". */
  note: string | null;
}

interface CrewPickerDialogProps {
  /** The session being filled, its boat, and `position` = the boat's place in the club order (its accent colour). */
  target: { session: SessionDraft; boat: Boat; position: number } | null;
  draft: ProgramDraft;
  roster: RosterMemberInfo[];
  boatName: (boatId: string) => string;
  onToggle: (memberId: string) => void;
  onClose: () => void;
}

interface PickerBodyProps extends Omit<CrewPickerDialogProps, 'target'> {
  session: SessionDraft;
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

function PickerBody({ session: target, boat, draft, roster, boatName, onToggle, onClose }: PickerBodyProps) {
  // always read the session from the draft: the crew changes while the dialog is open
  const session = draft.sessions.find((s) => s.id === target.id) ?? target;
  const inBoat = session.crew;
  const full = inBoat.length >= boat.capacity;

  const renderRow = (member: RosterMemberInfo) => {
    const checked = inBoat.includes(member.id);
    // somebody who already rows ANOTHER boat while this session is on the water cannot be picked (nobody is in two boats at once)
    const clash = checked ? undefined : conflictFor(draft, session, member.id);
    const disabledReason = checked ? null : clash ? tr.program.inOtherBoat(boatName(clash.boatId), `${clash.start}–${clash.end}`) : full ? tr.program.boatFull : null;
    return <Row key={member.id} member={member} checked={checked} disabledReason={disabledReason} load={memberSessions(draft, member.id).length} onToggle={() => onToggle(member.id)} />;
  };

  const attending = roster.filter((m) => m.answer === 'attending');
  const noAnswer = roster.filter((m) => m.answer === undefined);
  const notAttending = roster.filter((m) => m.answer === 'not_attending');
  const others = [...noAnswer, ...notAttending];
  // People already in this boat must stay visible even if they are in the collapsed group.
  const othersOpen = others.some((m) => inBoat.includes(m.id)) || attending.length === 0;

  return (
    <>
      <p className="-mt-2 flex justify-end">
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
        {session.start}–{session.end} {boat.name} {tr.program.crewCount(inBoat.length, boat.capacity)}
      </span>
    </>
  );
}

/** Multi-select of members for one boat in one hour. Changes apply immediately (no separate "apply"). */
export function CrewPickerDialog({ target, ...rest }: CrewPickerDialogProps) {
  // The title says WHICH boat and WHICH hour, with the hour big: the coach must never wonder what they are editing.
  const title = target ? (
    <>
      <span className={cn('inline-flex items-center gap-1.5', boatStyle(target.position).text)}>
        <BoatIcon capacity={target.boat.capacity} size={22} />
        {target.boat.name}
      </span>
      {' · '}
      <span className="text-2xl font-extrabold tabular-nums">
        {target.session.start}–{target.session.end}
      </span>
    </>
  ) : (
    ''
  );
  return (
    <Dialog open={target !== null} onClose={rest.onClose} title={title}>
      {target && <PickerBody session={target.session} boat={target.boat} {...rest} />}
    </Dialog>
  );
}
