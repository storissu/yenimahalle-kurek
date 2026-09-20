import { MapPin } from 'lucide-react';
import { Fragment, useId, useMemo, useState } from 'react';
import { BoatIcon } from '@/components/ui/BoatIcon';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';
import type { Boat, Training } from '@/types/database';
import type { DirectoryEntry } from '../members/api';
import { ContactDialog, type Contact } from '../members/ContactDialog';
import { boatPositions, boatStyle } from './boatStyle';
import type { ProgramData } from './model';
import { SessionTime } from './SessionTime';
import { buildByBoat, isMineSession } from './view';

interface ProgramByBoatProps {
  data: ProgramData;
  training: Pick<Training, 'starts_at'>;
  boats: ReadonlyArray<Pick<Boat, 'id' | 'name' | 'sort_order' | 'capacity'>>;
  /** The reader: their own sessions stand out, and the boats they row in come first. Omit for a neutral (coach) view. */
  meId?: string;
  nameOf: (memberId: string) => string;
  /** Lets a name open a contact card / profile. Omit to show plain names. */
  contactOf?: (memberId: string) => DirectoryEntry | null;
  /** Add "Profili aç" to the contact card (the profile page is a member page). Coaches turn it off. Default: on. */
  profileLinks?: boolean;
}

/** "Siz" pill for the reader's own row: white on the solid blue block. */
function MePill() {
  return (
    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary-fg px-2.5 py-0.5 text-xs font-extrabold text-primary">
      <MapPin aria-hidden="true" size={13} />
      {tr.program.you}
      <span className="sr-only"> — {tr.program.yourSession}</span>
    </span>
  );
}

/**
 * The whole published program, grouped by boat:
 *
 *   Turuncu    08:00   Ahmet – Gülden
 *              –09:00
 *              09:00   Öykü – Çiğdem
 *   Mavi       07:00   Ahmet – Gülden  …
 *
 * Every boat has its own colour, icon AND name. Every session is a row with the start hour big on the left (the first
 * thing the eye lands on), a thin divider, then the crew. The reader's own sessions are a solid blue block and the boats
 * they row in come first, so "where am I?" is answered at a glance. Weather is NOT repeated here: it has one place
 * of its own (see MemberWeather).
 */
export function ProgramByBoat({ data, training, boats, meId, nameOf, contactOf, profileLinks = true }: ProgramByBoatProps) {
  const headingPrefix = useId();
  const [contact, setContact] = useState<Contact | null>(null);

  const position = useMemo(() => boatPositions(boats), [boats]);
  const byId = useMemo(() => new Map(boats.map((b) => [b.id, b])), [boats]);
  const schedules = useMemo(() => {
    const list = buildByBoat(data, position);
    const hasMine = (boatId: string) => list.find((s) => s.boatId === boatId)?.sessions.some((s) => isMineSession(s, meId)) ?? false;
    // stable: my boats first, everything else keeps the club order
    return [...list].sort((a, b) => Number(hasMine(b.boatId)) - Number(hasMine(a.boatId)));
  }, [data, position, meId]);

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
                    <li key={session.slotIndex} data-mine={mine ? 'true' : undefined} className={cn('flex items-center gap-3 px-4 py-3', mine && 'bg-primary py-4 text-primary-fg')}>
                      <SessionTime
                        training={training}
                        index={session.slotIndex}
                        onPrimary={mine}
                        className={cn('w-[4.75rem] self-stretch border-r pr-3', mine ? 'border-primary-fg/40' : 'border-border')}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          {session.crew.map((id, i) => {
                            const entry = contactOf?.(id) ?? null;
                            return (
                              <Fragment key={id}>
                                {i > 0 && (
                                  <>
                                    <span aria-hidden="true" className={mine ? undefined : 'text-muted'}>
                                      –
                                    </span>
                                    <span className="sr-only">, </span>
                                  </>
                                )}
                                {id === meId ? (
                                  <span className="whitespace-nowrap text-lg font-extrabold underline decoration-2 underline-offset-4">{nameOf(id)}</span>
                                ) : entry ? (
                                  <button
                                    type="button"
                                    onClick={() => setContact({ ...(profileLinks ? { id } : {}), name: entry.full_name, phone: entry.phone })}
                                    aria-label={tr.program.contactAbout(entry.full_name)}
                                    className={cn(
                                      'inline min-h-6 whitespace-nowrap rounded-sm text-left text-base font-medium underline decoration-dotted underline-offset-4',
                                      mine && 'text-lg font-bold focus-visible:outline-primary-fg',
                                    )}
                                  >
                                    {entry.full_name}
                                  </button>
                                ) : (
                                  <span className={cn('whitespace-nowrap text-base font-medium', mine && 'text-lg font-bold')}>{nameOf(id)}</span>
                                )}
                              </Fragment>
                            );
                          })}
                          {mine && <MePill />}
                        </div>
                        {session.notes && <p className={cn('mt-1 text-sm', mine ? 'text-primary-fg' : 'text-muted')}>{session.notes}</p>}
                      </div>
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
