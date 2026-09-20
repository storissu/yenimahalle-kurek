import { MapPin } from 'lucide-react';
import { Fragment, useId, useMemo, useState } from 'react';
import { BoatIcon } from '@/components/ui/BoatIcon';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';
import type { Boat } from '@/types/database';
import type { DirectoryEntry } from '../members/api';
import { ContactDialog, type Contact } from '../members/ContactDialog';
import { boatPositions, boatStyle, type BoatStyle } from './boatStyle';
import type { ProgramData } from './model';
import { SessionTime } from './SessionTime';
import { buildByBoat, isMineSession } from './view';

interface ProgramByBoatProps {
  data: ProgramData;
  boats: ReadonlyArray<Pick<Boat, 'id' | 'name' | 'sort_order' | 'capacity'>>;
  /** The reader: their own sessions stand out, and the boats they row in come first. Omit for a neutral (coach) view. */
  meId?: string;
  nameOf: (memberId: string) => string;
  /** Lets a name open a contact card / profile. Omit to show plain names. */
  contactOf?: (memberId: string) => DirectoryEntry | null;
  /** Add "Profili aç" to the contact card (the profile page is a member page). Coaches turn it off. Default: on. */
  profileLinks?: boolean;
}

/**
 * One member of a session: a compact chip (same height, same type size, same spacing for everybody, so 1–4 names always
 * line up the same way). On the white card a chip is a soft pill. On the reader's own row (`boat` = that boat's colours) the
 * others are white chips with a soft edge in the boat's colour, and the reader's own chip is the boat's colour itself, with
 * a pin — that one is what "Siz" used to spell out.
 */
const CHIP = 'inline-flex min-h-9 max-w-full items-center gap-1 rounded-lg px-2.5 py-1 text-left text-sm font-semibold leading-tight [overflow-wrap:anywhere]';

function CrewChip({ name, boat, me, fill, onOpen }: { name: string; boat?: BoatStyle; me?: boolean; fill?: boolean; onOpen?: () => void }) {
  const shape = cn(CHIP, fill && 'w-full');
  const tone = me
    ? cn('border border-transparent font-extrabold', boat?.solid ?? 'bg-primary text-primary-fg')
    : boat
      ? cn('border bg-surface text-fg', boat.outline)
      : 'border border-border bg-surface-2 text-fg';
  if (me) {
    return (
      <span className={cn(shape, tone)}>
        <MapPin aria-hidden="true" size={14} className="shrink-0" />
        {name}
        <span className="sr-only"> — {tr.program.yourSession}</span>
      </span>
    );
  }
  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} aria-label={tr.program.contactAbout(name)} className={cn(shape, tone)}>
        {name}
      </button>
    );
  }
  return <span className={cn(shape, tone)}>{name}</span>;
}

/**
 * The whole published program, grouped by boat — every boat with its OWN schedule:
 *
 *   Turuncu    08:15   [Ahmet] [Gülden]
 *              –09:15
 *              09:15   [Öykü] [Çiğdem]
 *   Mavi       08:00   [Ahmet] [Gülden]  …
 *
 * Every boat has its own colour, icon AND name. Every session is a row with its start big on the left (the first
 * thing the eye lands on), a thin divider, then the crew. The reader's own sessions get a soft tint and a bar in THEIR boat's
 * colour (Mavi blue, Turuncu orange, C4X purple …; only those rows) and the boats they row in come first, so "where am I?" is answered at a glance. Weather is NOT repeated here: it has one place
 * of its own (see MemberWeather).
 */
export function ProgramByBoat({ data, boats, meId, nameOf, contactOf, profileLinks = true }: ProgramByBoatProps) {
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
                {rowInThisBoat && <span className={cn('ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold', style.solid)}>{tr.program.yourBoat}</span>}
              </h3>
              <ul className="divide-y divide-border">
                {boat.sessions.map((session) => {
                  const mine = isMineSession(session, meId);
                  const many = session.crew.length > 2; // 3–4 names sit in an even two-column grid; one or two flow next to each other
                  return (
                    <li
                      key={session.slotIndex}
                      data-mine={mine ? 'true' : undefined}
                      className={cn('flex items-center gap-3 border-l-4 px-3 py-3', mine ? cn('py-4', style.soft, style.border) : 'border-transparent')}
                    >
                      <SessionTime
                        startsAt={session.startsAt}
                        endsAt={session.endsAt}
                        strong={mine}
                        className={cn('w-[4.75rem] self-stretch border-r pr-3', mine ? cn(style.text, style.outline) : 'border-border')}
                      />
                      <div className="min-w-0 flex-1">
                        <div className={cn('gap-1.5', many ? 'grid grid-cols-2' : 'flex flex-wrap items-center')}>
                          {session.crew.map((id, i) => {
                            const entry = contactOf?.(id) ?? null;
                            return (
                              <Fragment key={id}>
                                {i > 0 && <span className="sr-only">, </span>}
                                {id === meId ? (
                                  <CrewChip name={nameOf(id)} boat={mine ? style : undefined} me fill={many} />
                                ) : entry ? (
                                  <CrewChip
                                    name={entry.full_name}
                                    boat={mine ? style : undefined}
                                    fill={many}
                                    onOpen={() =>
                                      setContact({
                                        ...(profileLinks ? { id } : {}),
                                        name: entry.full_name,
                                        phone: entry.phone,
                                      })
                                    }
                                  />
                                ) : (
                                  <CrewChip name={nameOf(id)} boat={mine ? style : undefined} fill={many} />
                                )}
                              </Fragment>
                            );
                          })}
                        </div>
                        {session.notes && <p className={cn('mt-1 text-sm', mine ? 'text-fg' : 'text-muted')}>{session.notes}</p>}
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
