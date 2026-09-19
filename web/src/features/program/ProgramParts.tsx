import { CloudSun, NotebookText, Ship } from 'lucide-react';
import { BoatIcon } from '@/components/ui/BoatIcon';
import { Card } from '@/components/ui/Card';
import { tr } from '@/strings/tr';
import type { Training, WeatherSnapshot } from '@/types/database';
import { sessionRangeLabel } from '../trainings/schedule';
import { CompactWeather } from '../weather/SessionWeather';
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
  /** The forecast of a session (by index). Omit to show no weather; a function returning undefined says "not available yet". */
  weatherOf?: (slotIndex: number) => WeatherSnapshot | undefined;
}

/**
 * The signed-in member's own part of the program, big and first: when, which boat, with whom — and the forecast for
 * exactly that hour (from the session's forecast row, not the weather now).
 */
export function MyBoatCard({ assignments, training, nameOf, boatName, capacityOf, weatherOf }: MyBoatCardProps) {
  return (
    <Card className="flex flex-col gap-3 border-2 border-primary bg-primary-soft" aria-labelledby="my-program-heading" role="region">
      <h2 id="my-program-heading" className="flex items-center gap-2 text-sm font-bold text-primary">
        <Ship aria-hidden="true" size={18} />
        {tr.program.yours}
      </h2>
      <ul className="flex flex-col gap-3">
        {assignments.map((a) => (
          <li key={a.slotIndex} className="rounded-xl bg-surface p-3">
            <p className="text-lg font-extrabold tabular-nums text-primary">{sessionRangeLabel(training, a.slotIndex)}</p>
            <p className="flex items-center gap-2 text-2xl font-extrabold text-fg">
              <BoatIcon capacity={capacityOf?.(a.boatId) ?? 2} size={26} className="text-primary" />
              {boatName(a.boatId)}
            </p>
            <p className="text-base text-fg">{matesLabel(a.mates.map(nameOf))}</p>
            {a.notes && <p className="mt-1 text-sm text-muted">{a.notes}</p>}
            {weatherOf && <CompactWeather snapshot={weatherOf(a.slotIndex)} range={sessionRangeLabel(training, a.slotIndex)} />}
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
