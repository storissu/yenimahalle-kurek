import { CloudSun, NotebookText, Ship } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { tr } from '@/strings/tr';
import type { Training } from '@/types/database';
import { sessionRangeLabel } from '../trainings/schedule';
import { matesLabel, type MyAssignment } from './view';

interface NamesProps {
  nameOf: (memberId: string) => string;
  boatName: (boatId: string) => string;
}

/** The signed-in member's own part of the program, big and first: when, which boat, with whom. */
export function MyBoatCard({ assignments, training, nameOf, boatName }: { assignments: MyAssignment[]; training: Pick<Training, 'starts_at'> } & NamesProps) {
  return (
    <Card className="flex flex-col gap-3 border-primary bg-primary-soft" aria-labelledby="my-program-heading" role="region">
      <h2 id="my-program-heading" className="flex items-center gap-2 text-sm font-bold text-primary">
        <Ship aria-hidden="true" size={18} />
        {tr.program.yours}
      </h2>
      <ul className="flex flex-col gap-3">
        {assignments.map((a) => (
          <li key={a.slotIndex} className="rounded-xl bg-surface p-3">
            <p className="text-sm font-semibold text-muted">{sessionRangeLabel(training, a.slotIndex)}</p>
            <p className="text-2xl font-extrabold text-fg">{boatName(a.boatId)}</p>
            <p className="text-sm text-fg">{matesLabel(a.mates.map(nameOf))}</p>
            {a.notes && <p className="mt-1 text-sm text-muted">{a.notes}</p>}
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
