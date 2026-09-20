import { CloudSun, NotebookText, Ship } from 'lucide-react';
import { BoatIcon } from '@/components/ui/BoatIcon';
import { Card } from '@/components/ui/Card';
import { tr } from '@/strings/tr';
import type { Training } from '@/types/database';
import { SessionTime } from './SessionTime';
import { matesLabel, type MyAssignment } from './view';

interface NamesProps {
  nameOf: (memberId: string) => string;
  boatName: (boatId: string) => string;
}

interface MyBoatCardProps extends NamesProps {
  assignments: MyAssignment[];
  training: Pick<Training, 'starts_at'>;
  /** Seats of a boat, for its icon (defaults to a double). */
  capacityOf?: (boatId: string) => number;
}

/**
 * The signed-in member's own part of the program, big and first: WHEN (the start hour, largest), which boat, with whom.
 * The forecast for that hour sits right below this card (MemberWeather), once — not inside every session.
 */
export function MyBoatCard({ assignments, training, nameOf, boatName, capacityOf }: MyBoatCardProps) {
  return (
    <Card className="flex flex-col gap-3 border-2 border-primary bg-primary-soft" aria-labelledby="my-program-heading" role="region">
      <h2 id="my-program-heading" className="flex items-center gap-2 text-sm font-bold text-primary">
        <Ship aria-hidden="true" size={18} />
        {tr.program.yours}
      </h2>
      <ul className="flex flex-col gap-3">
        {assignments.map((a) => (
          <li key={a.slotIndex} className="flex items-center gap-4 rounded-xl bg-surface p-3">
            <SessionTime training={training} index={a.slotIndex} size="lg" className="w-[6.5rem] self-stretch border-r border-border pr-4 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-xl font-extrabold text-fg">
                <BoatIcon capacity={capacityOf?.(a.boatId) ?? 2} size={24} className="shrink-0 text-primary" />
                {boatName(a.boatId)}
              </p>
              <p className="text-base text-fg">{matesLabel(a.mates.map(nameOf))}</p>
              {a.notes && <p className="mt-1 text-sm text-muted">{a.notes}</p>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Coach's free-text notes attached to the program. */
export function ProgramNotes({ weatherNote, trainingNotes }: { weatherNote: string | null; trainingNotes: string | null }) {
  if (!weatherNote && !trainingNotes) return null;
  return (
    <div className="flex flex-col gap-3">
      {weatherNote && (
        <Card className="flex items-start gap-3">
          <CloudSun aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-primary" />
          <div>
            <h3 className="text-sm font-bold">{tr.program.weather}</h3>
            <p className="whitespace-pre-line break-words text-sm">{weatherNote}</p>
          </div>
        </Card>
      )}
      {trainingNotes && (
        <Card className="flex items-start gap-3">
          <NotebookText aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-primary" />
          <div>
            <h3 className="text-sm font-bold">{tr.program.trainingNotes}</h3>
            <p className="whitespace-pre-line break-words text-sm">{trainingNotes}</p>
          </div>
        </Card>
      )}
    </div>
  );
}
