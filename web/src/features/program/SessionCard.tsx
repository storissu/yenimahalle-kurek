import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ShipWheel, TriangleAlert, Trash2, UserPlus, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { BoatIcon } from '@/components/ui/BoatIcon';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';
import type { Boat } from '@/types/database';
import { boatStyle } from './boatStyle';
import { durationLabel, type SessionDraft, type SessionProblem } from './model';

interface SessionCardProps {
  session: SessionDraft;
  boat: Boat;
  /** Position of the boat in the club's order: the accent colour it has everywhere else. */
  position: number;
  /** Position of the session within its boat (0-based) and how many the boat has: decides which arrows are offered. */
  index: number;
  count: number;
  problems: SessionProblem[];
  /** "HH:MM" — the earliest a session may start (the training's start). */
  trainingStart: string;
  nameOf: (memberId: string) => string;
  boatName: (boatId: string) => string;
  onStart: (time: string) => void;
  onEnd: (time: string) => void;
  /** Coaches are named as such when they steer (a coach can be the dümenci). */
  isCoach?: (memberId: string) => boolean;
  onEdit: () => void;
  onRemoveMember: (memberId: string) => void;
  /** Moves a rower one place towards the front (-1) or the back (+1) of the boat. */
  onMoveMember: (memberId: string, direction: -1 | 1) => void;
  onPickCox: () => void;
  onRemoveCox: () => void;
  onNotes: (text: string) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

function TimeInput({ label, value, onChange, invalid }: { label: string; value: string; onChange: (time: string) => void; invalid: boolean }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        className={cn(
          'min-h-12 w-full min-w-0 rounded-xl border-2 bg-surface px-2.5 text-xl font-extrabold tabular-nums text-fg',
          invalid ? 'border-danger' : 'border-border',
        )}
      />
    </label>
  );
}

function problemText(problem: SessionProblem, trainingStart: string, nameOf: (id: string) => string, boatName: (id: string) => string): string {
  const other = problem.other;
  const range = other ? `${other.start}–${other.end}` : '';
  switch (problem.kind) {
    case 'order':
      return tr.program.problemOrder;
    case 'long':
      return tr.program.problemLong;
    case 'early':
      return tr.program.problemEarly(trainingStart);
    case 'boat-overlap':
      return tr.program.problemBoatOverlap(range);
    case 'person-overlap':
      return tr.program.problemPersonOverlap(problem.memberId ? nameOf(problem.memberId) : '?', other ? boatName(other.boatId) : '?', range);
  }
}

/**
 * ONE session of ONE boat: its own start and end (an hour by default, freely adjustable), who rows it — in seat order, which
 * the coach can change — and, on boats that have one, its dümenci (a separate role, not a seat); a note, and the ways to reorder
 * (swap teams with the neighbouring session) or remove it. The times belong to this boat's schedule only.
 */
export function SessionCard({
  session,
  boat,
  position,
  index,
  count,
  problems,
  trainingStart,
  nameOf,
  boatName,
  isCoach = () => false,
  onStart,
  onEnd,
  onEdit,
  onRemoveMember,
  onMoveMember,
  onPickCox,
  onRemoveCox,
  onNotes,
  onMove,
  onRemove,
}: SessionCardProps) {
  const range = `${session.start}–${session.end}`;
  const crew = session.crew;
  const full = crew.length >= boat.capacity;
  // Boats such as the C4X must be rowed with exactly `capacity` people: flag an incomplete crew right here.
  const incomplete = boat.requires_full_crew && crew.length > 0 && crew.length !== boat.capacity;
  const duration = durationLabel(session.start, session.end);
  const badTime = problems.some((p) => p.kind === 'order' || p.kind === 'long' || p.kind === 'early');
  const style = boatStyle(position);

  return (
    <div role="group" aria-label={`${boat.name}, ${range}`} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-3">
      {/* Which boat this is, on the card itself: the boat's header may be far out of view while scrolling. */}
      <p className={cn('inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold', style.header)}>
        <BoatIcon capacity={boat.capacity} size={14} />
        {boat.name} · {tr.program.sessionOrdinal(index + 1)}
      </p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <TimeInput label={tr.program.startLabel} value={session.start} onChange={onStart} invalid={badTime} />
        <span aria-hidden="true" className="pb-3 text-xl font-bold text-muted">
          –
        </span>
        <TimeInput label={tr.program.endLabel} value={session.end} onChange={onEnd} invalid={badTime} />
      </div>
      <div className="-mt-1 flex flex-wrap items-center gap-2">
        {duration && <Badge>{duration}</Badge>}
        <Badge tone={incomplete ? 'warning' : full ? 'success' : 'neutral'}>
          <Users aria-hidden="true" size={13} />
          {tr.program.crewCount(crew.length, boat.capacity)}
        </Badge>
        {boat.requires_full_crew && <span className={incomplete ? 'text-sm font-semibold text-warning' : 'text-sm text-muted'}>{tr.program.fullCrewBadge(boat.capacity)}</span>}
      </div>

      {problems.length > 0 && (
        <div role="alert" className="flex flex-col gap-1 rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          {problems.map((problem, i) => (
            <p key={i} className="flex items-start gap-2">
              <TriangleAlert aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
              {problemText(problem, trainingStart, nameOf, boatName)}
            </p>
          ))}
        </div>
      )}

      {crew.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-bold">
            {tr.program.rowersHeading}
            {crew.length > 1 && <span className="block text-xs font-normal text-muted">{tr.program.crewOrderHint}</span>}
          </p>
          <ul className="flex flex-col gap-1.5">
            {crew.map((id, i) => (
              <li key={id} className="flex min-h-11 items-center gap-1 rounded-xl bg-surface pl-2">
                {crew.length > 1 && (
                  <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-bold tabular-nums text-muted">
                    {i + 1}
                  </span>
                )}
                <span className="min-w-0 flex-1 pl-1 font-medium [overflow-wrap:anywhere]">{nameOf(id)}</span>
                {crew.length > 1 && (
                  <>
                    <button
                      type="button"
                      disabled={i === 0}
                      onClick={() => onMoveMember(id, -1)}
                      aria-label={tr.program.moveEarlier(nameOf(id))}
                      className="flex h-11 w-9 shrink-0 items-center justify-center rounded-xl text-muted disabled:opacity-30"
                    >
                      <ChevronUp aria-hidden="true" size={20} />
                    </button>
                    <button
                      type="button"
                      disabled={i === crew.length - 1}
                      onClick={() => onMoveMember(id, 1)}
                      aria-label={tr.program.moveLater(nameOf(id))}
                      className="flex h-11 w-9 shrink-0 items-center justify-center rounded-xl text-muted disabled:opacity-30"
                    >
                      <ChevronDown aria-hidden="true" size={20} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveMember(id)}
                  aria-label={tr.program.removeFromBoat(nameOf(id))}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button variant={crew.length === 0 ? 'primary' : 'secondary'} onClick={onEdit} fullWidth>
        <UserPlus aria-hidden="true" size={18} />
        {crew.length === 0 ? tr.program.pickCrew : tr.program.editCrew}
      </Button>

      {boat.has_coxswain && crew.length > 0 && (
        <div role="group" aria-label={tr.program.cox} className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <ShipWheel aria-hidden="true" size={16} />
            {tr.program.cox}
          </p>
          {session.cox ? (
            <div className="flex min-h-11 items-center gap-1 rounded-xl bg-surface pl-3">
              <button type="button" onClick={onPickCox} aria-label={`${tr.program.coxChange}: ${nameOf(session.cox)}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left">
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{nameOf(session.cox)}</span>
                {isCoach(session.cox) && <Badge tone="primary">{tr.program.coxCoachTag}</Badge>}
              </button>
              <button
                type="button"
                onClick={onRemoveCox}
                aria-label={tr.program.coxRemove(nameOf(session.cox))}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
          ) : (
            <Button variant="secondary" onClick={onPickCox} fullWidth>
              <ShipWheel aria-hidden="true" size={18} />
              {tr.program.coxPick}
            </Button>
          )}
          {!session.cox && <p className="text-sm font-semibold text-warning">{tr.program.coxNone}</p>}
        </div>
      )}

      {crew.length > 0 && <TextField label={tr.program.boatNoteLabel} value={session.notes} maxLength={200} onChange={(e) => onNotes(e.target.value)} autoComplete="off" />}

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label={tr.program.swapWithPrevious(range)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-muted disabled:opacity-40"
          >
            <ArrowUp aria-hidden="true" size={18} />
          </button>
          <button
            type="button"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            aria-label={tr.program.swapWithNext(range)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-muted disabled:opacity-40"
          >
            <ArrowDown aria-hidden="true" size={18} />
          </button>
        </div>
        <Button variant="ghost" onClick={onRemove} disabled={count === 1 && crew.length === 0} className="text-danger">
          <Trash2 aria-hidden="true" size={16} />
          {tr.program.removeSession}
        </Button>
      </div>
    </div>
  );
}
