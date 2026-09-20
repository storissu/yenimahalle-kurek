import { UserPlus, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { BoatIcon } from '@/components/ui/BoatIcon';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';
import type { Boat } from '@/types/database';
import { boatStyle } from './boatStyle';

interface SlotBoatCardProps {
  boat: Boat;
  /** Position of the boat in the club's order: the accent colour it has everywhere else. */
  position: number;
  /** Start hour of the session being edited ("08:00"), repeated on every card so boat and hour are always read together. */
  time: string;
  crew: string[];
  notes: string;
  nameOf: (memberId: string) => string;
  onEdit: () => void;
  onRemove: (memberId: string) => void;
  onNotes: (text: string) => void;
}

/** One boat in the selected hour: its colour and the hour in the header, who is in it, how full it is, and the crew button. */
export function SlotBoatCard({ boat, position, time, crew, notes, nameOf, onEdit, onRemove, onNotes }: SlotBoatCardProps) {
  const full = crew.length >= boat.capacity;
  // Boats such as the C4X must be rowed with exactly `capacity` people: flag an incomplete crew right here.
  const incomplete = boat.requires_full_crew && crew.length > 0 && crew.length !== boat.capacity;
  const style = boatStyle(position);
  return (
    <div role="group" aria-label={boat.name} className={cn('overflow-hidden rounded-2xl border-2 bg-surface', style.border)}>
      <div className={cn('flex items-center justify-between gap-2 px-4 py-2.5', style.header)}>
        <h3 className="flex items-center gap-2 text-base font-extrabold">
          <BoatIcon capacity={boat.capacity} size={20} />
          {boat.name}
          {!boat.is_active && <Badge tone="danger">{tr.program.boatInactive}</Badge>}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-lg font-extrabold tabular-nums" aria-hidden="true">
            {time}
          </span>
          <Badge tone={incomplete ? 'warning' : full ? 'success' : 'neutral'}>
            <Users aria-hidden="true" size={13} />
            {tr.program.crewCount(crew.length, boat.capacity)}
          </Badge>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {boat.requires_full_crew && (
          <p className={incomplete ? 'text-sm font-semibold text-warning' : 'text-sm text-muted'}>{tr.program.fullCrewBadge(boat.capacity)}</p>
        )}

        {crew.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {crew.map((id) => (
              <li key={id} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-surface-2 pl-3">
                <span className="font-medium">{nameOf(id)}</span>
                <button
                  type="button"
                  onClick={() => onRemove(id)}
                  aria-label={tr.program.removeFromBoat(nameOf(id))}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-muted"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <Button variant={crew.length === 0 ? 'primary' : 'secondary'} onClick={onEdit} fullWidth>
          <UserPlus aria-hidden="true" size={18} />
          {crew.length === 0 ? tr.program.pickCrew : tr.program.editCrew}
        </Button>

        {crew.length > 0 && <TextField label={tr.program.boatNoteLabel} value={notes} maxLength={200} onChange={(e) => onNotes(e.target.value)} autoComplete="off" />}
      </div>
    </div>
  );
}
