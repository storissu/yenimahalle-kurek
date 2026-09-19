import { UserPlus, Users, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { tr } from '@/strings/tr';
import type { Boat } from '@/types/database';

interface SlotBoatCardProps {
  boat: Boat;
  crew: string[];
  notes: string;
  nameOf: (memberId: string) => string;
  onEdit: () => void;
  onRemove: (memberId: string) => void;
  onNotes: (text: string) => void;
}

/** One boat in the selected hour: who is in it, how full it is, and a shortcut to change the crew. */
export function SlotBoatCard({ boat, crew, notes, nameOf, onEdit, onRemove, onNotes }: SlotBoatCardProps) {
  const full = crew.length >= boat.capacity;
  return (
    <Card className="flex flex-col gap-3" role="group" aria-label={boat.name}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-bold">
          {boat.name}
          {!boat.is_active && <Badge tone="danger">{tr.program.boatInactive}</Badge>}
        </h3>
        <Badge tone={full ? 'success' : 'neutral'}>
          <Users aria-hidden="true" size={13} />
          {tr.program.crewCount(crew.length, boat.capacity)}
        </Badge>
      </div>

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

      {crew.length > 0 && (
        <TextField label={tr.program.boatNoteLabel} value={notes} maxLength={200} onChange={(e) => onNotes(e.target.value)} autoComplete="off" />
      )}
    </Card>
  );
}
