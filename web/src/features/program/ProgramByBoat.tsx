import { Ship } from 'lucide-react';
import { Fragment, useId, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';
import type { Boat, Training } from '@/types/database';
import type { DirectoryEntry } from '../members/api';
import { ContactDialog, type Contact } from '../members/ContactDialog';
import { sessionRangeLabel } from '../trainings/schedule';
import type { ProgramData } from './model';
import { buildByBoat, isMineSession } from './view';

/** One accent per boat, taken from the club's boat order. Full class names so Tailwind can see them. */
export const BOAT_STYLES = [
  { border: 'border-boat-1', header: 'bg-boat-1-soft text-boat-1' },
  { border: 'border-boat-2', header: 'bg-boat-2-soft text-boat-2' },
  { border: 'border-boat-3', header: 'bg-boat-3-soft text-boat-3' },
  { border: 'border-boat-4', header: 'bg-boat-4-soft text-boat-4' },
  { border: 'border-boat-5', header: 'bg-boat-5-soft text-boat-5' },
  { border: 'border-boat-6', header: 'bg-boat-6-soft text-boat-6' },
] as const;

export const boatStyle = (position: number) => BOAT_STYLES[position % BOAT_STYLES.length] as (typeof BOAT_STYLES)[number];

interface ProgramByBoatProps {
  data: ProgramData;
  training: Pick<Training, 'starts_at'>;
  boats: ReadonlyArray<Pick<Boat, 'id' | 'name' | 'sort_order'>>;
  /** The reader: their own sessions are highlighted. Omit for a neutral (coach) view. */
  meId?: string;
  nameOf: (memberId: string) => string;
  /** Lets a name open a contact card. Omit to show plain names. */
  contactOf?: (memberId: string) => DirectoryEntry | null;
}

/**
 * The whole published program, grouped by boat:
 *
 *   Turuncu            08:00–09:00  Ahmet – Gülden
 *                      09:00–10:00  Öykü – Çiğdem
 *   Mavi               07:00–08:00  Ahmet – Gülden  …
 *
 * Every boat has its own colour AND its name, every session shows its time range and crew, and the reader's own
 * sessions stand out (tinted row, bar, "Siz" badge and a screen-reader label).
 */
export function ProgramByBoat({ data, training, boats, meId, nameOf, contactOf }: ProgramByBoatProps) {
  const headingPrefix = useId();
  const [contact, setContact] = useState<Contact | null>(null);

  const ordered = useMemo(() => [...boats].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'tr')), [boats]);
  const position = useMemo(() => new Map(ordered.map((b, i) => [b.id, i])), [ordered]);
  const nameOfBoat = useMemo(() => new Map(boats.map((b) => [b.id, b.name])), [boats]);
  const schedules = useMemo(() => buildByBoat(data, new Map(ordered.map((b, i) => [b.id, i]))), [data, ordered]);

  if (schedules.length === 0) {
    return <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted">{tr.program.noBoats}</p>;
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {schedules.map((boat) => {
          const style = boatStyle(position.get(boat.boatId) ?? 0);
          const name = nameOfBoat.get(boat.boatId) ?? '?';
          const headingId = `${headingPrefix}-${boat.boatId}`;
          return (
            <section key={boat.boatId} aria-labelledby={headingId} className={cn('overflow-hidden rounded-2xl border-2 bg-surface', style.border)}>
              <h3 id={headingId} className={cn('flex items-center gap-2 px-4 py-2.5 text-base font-extrabold', style.header)}>
                <Ship aria-hidden="true" size={18} className="shrink-0" />
                {name}
              </h3>
              <ul className="divide-y divide-border">
                {boat.sessions.map((session) => {
                  const mine = isMineSession(session, meId);
                  return (
                    <li key={session.slotIndex} className={cn('px-4 py-3', mine && 'border-l-4 border-primary bg-primary-soft')}>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="w-28 shrink-0 text-sm font-bold tabular-nums">{sessionRangeLabel(training, session.slotIndex)}</span>
                        <span className={cn('min-w-0 flex-1 text-[15px]', mine && 'font-semibold')}>
                          {session.crew.map((id, i) => {
                            const entry = contactOf?.(id) ?? null;
                            return (
                              <Fragment key={id}>
                                {i > 0 && (
                                  <>
                                    <span aria-hidden="true"> – </span>
                                    <span className="sr-only">, </span>
                                  </>
                                )}
                                {id === meId ? (
                                  <span className="font-bold text-primary">{nameOf(id)}</span>
                                ) : entry ? (
                                  <button
                                    type="button"
                                    onClick={() => setContact({ name: entry.full_name, phone: entry.phone })}
                                    aria-label={tr.program.contactAbout(entry.full_name)}
                                    className="inline min-h-6 rounded-sm text-left underline decoration-dotted underline-offset-4"
                                  >
                                    {entry.full_name}
                                  </button>
                                ) : (
                                  <span>{nameOf(id)}</span>
                                )}
                              </Fragment>
                            );
                          })}
                        </span>
                        {mine && (
                          <Badge tone="primary">
                            {tr.program.you}
                            <span className="sr-only"> — {tr.program.yourSession}</span>
                          </Badge>
                        )}
                      </div>
                      {session.notes && <p className="mt-1 text-sm text-muted">{session.notes}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      <ContactDialog contact={contact} onClose={() => setContact(null)} />
    </>
  );
}
