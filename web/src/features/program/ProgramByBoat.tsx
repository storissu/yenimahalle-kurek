import { MapPin } from 'lucide-react';
import { Fragment, useId, useMemo, useState } from 'react';
import { BoatIcon } from '@/components/ui/BoatIcon';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';
import type { Boat, Training, WeatherSnapshot } from '@/types/database';
import type { DirectoryEntry } from '../members/api';
import { ContactDialog, type Contact } from '../members/ContactDialog';
import { sessionRangeLabel } from '../trainings/schedule';
import { MiniWeather } from '../weather/SessionWeather';
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
  boats: ReadonlyArray<Pick<Boat, 'id' | 'name' | 'sort_order' | 'capacity'>>;
  /** The reader: their own sessions stand out, and the boats they row in come first. Omit for a neutral (coach) view. */
  meId?: string;
  nameOf: (memberId: string) => string;
  /** Lets a name open a contact card / profile. Omit to show plain names. */
  contactOf?: (memberId: string) => DirectoryEntry | null;
  /** The forecast of a session (by index); shown compactly inside the reader's own rows. */
  weatherOf?: (slotIndex: number) => WeatherSnapshot | undefined;
  /** Add "Profili aç" to the contact card (the profile page is a member page). Coaches turn it off. Default: on. */
  profileLinks?: boolean;
}

/** "Siz" pill for the reader's own row: white on the solid blue block. */
function MePill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary-fg px-2.5 py-0.5 text-xs font-extrabold text-primary">
      <MapPin aria-hidden="true" size={13} />
      {tr.program.you}
      <span className="sr-only"> — {tr.program.yourSession}</span>
    </span>
  );
}

/**
 * The whole published program, grouped by boat:
 *
 *   Turuncu            08:00–09:00  Ahmet – Gülden
 *                      09:00–10:00  Öykü – Çiğdem
 *   Mavi               07:00–08:00  Ahmet – Gülden  …
 *
 * Every boat has its own colour, icon AND name; every session shows its time range and crew. The reader's own sessions
 * are a solid, larger block (with the forecast for that hour) so "where am I?" is answered at a glance, and the boats
 * they row in are listed first. Everything else stays as readable as before.
 */
export function ProgramByBoat({ data, training, boats, meId, nameOf, contactOf, weatherOf, profileLinks = true }: ProgramByBoatProps) {
  const headingPrefix = useId();
  const [contact, setContact] = useState<Contact | null>(null);

  const ordered = useMemo(() => [...boats].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'tr')), [boats]);
  const position = useMemo(() => new Map(ordered.map((b, i) => [b.id, i])), [ordered]);
  const byId = useMemo(() => new Map(boats.map((b) => [b.id, b])), [boats]);
  const schedules = useMemo(() => {
    const list = buildByBoat(data, new Map(ordered.map((b, i) => [b.id, i])));
    const hasMine = (boatId: string) => list.find((s) => s.boatId === boatId)?.sessions.some((s) => isMineSession(s, meId)) ?? false;
    // stable: my boats first, everything else keeps the club order
    return [...list].sort((a, b) => Number(hasMine(b.boatId)) - Number(hasMine(a.boatId)));
  }, [data, ordered, meId]);

  if (schedules.length === 0) {
    return <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted">{tr.program.noBoats}</p>;
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {schedules.map((boat) => {
          const style = boatStyle(position.get(boat.boatId) ?? 0);
          const info = byId.get(boat.boatId);
          const name = info?.name ?? '?';
          const headingId = `${headingPrefix}-${boat.boatId}`;
          const rowInThisBoat = boat.sessions.some((s) => isMineSession(s, meId));
          return (
            <section key={boat.boatId} aria-labelledby={headingId} className={cn('overflow-hidden rounded-2xl border-2 bg-surface', style.border)}>
              <h3 id={headingId} className={cn('flex items-center gap-2 px-4 py-2.5 text-base font-extrabold', style.header)}>
                <BoatIcon capacity={info?.capacity ?? 2} size={20} />
                {name}
                {rowInThisBoat && (
                  <span className="ml-auto rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-fg">{tr.program.yourBoat}</span>
                )}
              </h3>
              <ul className="divide-y divide-border">
                {boat.sessions.map((session) => {
                  const mine = isMineSession(session, meId);
                  return (
                    <li key={session.slotIndex} data-mine={mine ? 'true' : undefined} className={cn('px-4 py-3', mine && 'bg-primary py-4 text-primary-fg')}>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className={cn('w-28 shrink-0 text-sm font-bold tabular-nums', mine && 'text-lg font-extrabold')}>{sessionRangeLabel(training, session.slotIndex)}</span>
                        <span className={cn('min-w-0 flex-1 text-[15px]', mine && 'text-lg font-bold')}>
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
                                  <span className="font-extrabold underline decoration-2 underline-offset-4">{nameOf(id)}</span>
                                ) : entry ? (
                                  <button
                                    type="button"
                                    onClick={() => setContact({ ...(profileLinks ? { id } : {}), name: entry.full_name, phone: entry.phone })}
                                    aria-label={tr.program.contactAbout(entry.full_name)}
                                    className={cn('inline min-h-6 rounded-sm text-left underline decoration-dotted underline-offset-4', mine && 'focus-visible:outline-primary-fg')}
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
                        {mine && <MePill />}
                      </div>
                      {mine && weatherOf && (
                        <div className="mt-1.5">
                          <MiniWeather snapshot={weatherOf(session.slotIndex)} />
                        </div>
                      )}
                      {session.notes && <p className={cn('mt-1 text-sm', mine ? 'text-primary-fg' : 'text-muted')}>{session.notes}</p>}
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
