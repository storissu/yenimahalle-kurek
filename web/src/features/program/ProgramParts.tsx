import { CloudSun, NotebookText, Ship, ShipWheel } from 'lucide-react';
import { BoatIcon } from '@/components/ui/BoatIcon';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';
import type { BoatStyle } from './boatStyle';
import { SessionTime } from './SessionTime';
import { matesLabel, type MyAssignment } from './view';

interface NamesProps {
  nameOf: (memberId: string) => string;
  boatName: (boatId: string) => string;
}

interface MyBoatCardProps extends NamesProps {
  assignments: MyAssignment[];
  /** Seats of a boat, for its icon (defaults to a double). */
  capacityOf?: (boatId: string) => number;
  /** The colours of a boat (the same ones its block in the full program uses). Without it the card stays in the app's blue. */
  styleOf?: (boatId: string) => BoatStyle | undefined;
}

/**
 * The signed-in member's own part of the program, big and first: WHEN (the start hour, largest), which boat, with whom.
 * The forecast for that hour sits right below this card (MemberWeather), once — not inside every session.
 * Only three things wear the colour of the boat the member rows in: the card's border, the start time and the boat icon.
 * The inside stays neutral. When they row in more than one boat the border stays blue and each row keeps its own boat's colour.
 */
export function MyBoatCard({ assignments, nameOf, boatName, capacityOf, styleOf }: MyBoatCardProps) {
  const styles = assignments.map((a) => styleOf?.(a.boatId));
  const first = styles[0];
  const card = first && styles.every((st) => st === first) ? first : undefined; // one boat only
  return (
    // a plain div, not <Card>: Card brings its own border classes, which would fight the boat colour
    <div
      className={cn('flex flex-col gap-3 rounded-2xl border-2 bg-surface p-4', card ? card.border : 'border-primary')}
      aria-labelledby="my-program-heading"
      role="region"
    >
      <h2 id="my-program-heading" className="flex items-center gap-2 text-sm font-bold text-primary">
        <Ship aria-hidden="true" size={18} />
        {tr.program.yours}
      </h2>
      <ul className="flex flex-col gap-3">
        {assignments.map((a, i) => {
          const style = styles[i];
          return (
            <li key={a.slotIndex} className="flex items-center gap-4 rounded-xl bg-surface-2 p-3">
              <SessionTime
                startsAt={a.startsAt}
                endsAt={a.endsAt}
                size="lg"
                className={cn('w-[6.5rem] self-stretch border-r border-border pr-4', style ? style.text : 'text-primary')}
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-xl font-extrabold text-fg">
                  <BoatIcon capacity={capacityOf?.(a.boatId) ?? 2} size={24} className={cn('shrink-0', style ? style.text : 'text-primary')} />
                  {boatName(a.boatId)}
                </p>
                <p className="text-base text-fg">{matesLabel(a.mates.map(nameOf))}</p>
                {a.iAmCox ? (
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-fg">
                    <ShipWheel aria-hidden="true" size={16} className="shrink-0" />
                    {tr.program.coxSteers}
                  </p>
                ) : (
                  a.cox && (
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm text-fg">
                      <ShipWheel aria-hidden="true" size={16} className="shrink-0" />
                      <span>
                        {tr.program.cox}: <span className="font-semibold">{nameOf(a.cox)}</span>
                      </span>
                    </p>
                  )
                )}
                {a.seat !== null && a.mates.length > 0 && <p className="text-sm text-muted">{tr.program.yourSeat(a.seat)}</p>}
                {a.notes && <p className="mt-1 text-sm text-muted">{a.notes}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The coach's training note (warm-up, tempo, turning points…): read before the program. */
export function TrainingNote({ notes }: { notes: string | null }) {
  if (!notes) return null;
  return (
    <Card className="flex items-start gap-3">
      <NotebookText aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-primary" />
      <div>
        <h3 className="text-sm font-bold">{tr.program.trainingNotes}</h3>
        <p className="whitespace-pre-line break-words text-sm">{notes}</p>
      </div>
    </Card>
  );
}

/** The coach's weather note. Weather is never the main thing, so it comes AFTER the program, next to the forecast. */
export function WeatherNote({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <Card className="flex items-start gap-3">
      <CloudSun aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-primary" />
      <div>
        <h3 className="text-sm font-bold">{tr.program.weather}</h3>
        <p className="whitespace-pre-line break-words text-sm">{note}</p>
      </div>
    </Card>
  );
}
