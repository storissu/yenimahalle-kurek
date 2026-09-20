import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { tr } from '@/strings/tr';
import { MyBoatCard, TrainingNote, WeatherNote } from './ProgramParts';
import { ProgramByBoat } from './ProgramByBoat';
import { boatStyle } from './boatStyle';
import { myAssignments } from './view';
import type { ProgramData } from './model';

// Every boat has its own schedule (08:00 Istanbul = 05:00Z): Mavi 08:00–09:00 and 09:00–10:00, Turuncu 08:15–09:15.
const asg = (id: string, slot: number, boat: string, from: string, to: string, notes: string | null) => ({ id, training_id: 't', slot_index: slot, boat_id: boat, notes, starts_at: `2026-09-22T${from}:00Z`, ends_at: `2026-09-22T${to}:00Z` });
const names: Record<string, string> = { alex: 'Alex', ashley: 'Ashley', john: 'John', jamie: 'Jamie', ali: 'Ali', becca: 'Becca' };
const nameOf = (id: string) => names[id] ?? '?';
const boatName = (id: string) => ({ mavi: 'Mavi', turuncu: 'Turuncu' })[id as 'mavi' | 'turuncu'] ?? '?';

const data: ProgramData = {
  program: null,
  assignments: [
    asg('a1', 0, 'mavi', '05:00', '06:00', null),
    asg('a2', 1, 'mavi', '06:00', '07:00', 'sprint çalışması'),
    asg('a3', 2, 'turuncu', '05:15', '06:15', null),
  ],
  crew: [
    { assignment_id: 'a1', training_id: 't', slot_index: 0, member_id: 'alex', seat: 1 },
    { assignment_id: 'a1', training_id: 't', slot_index: 0, member_id: 'ashley', seat: 2 },
    { assignment_id: 'a2', training_id: 't', slot_index: 1, member_id: 'john', seat: 1 },
    { assignment_id: 'a2', training_id: 't', slot_index: 1, member_id: 'jamie', seat: 2 },
    { assignment_id: 'a3', training_id: 't', slot_index: 2, member_id: 'ali', seat: 1 },
    { assignment_id: 'a3', training_id: 't', slot_index: 2, member_id: 'becca', seat: 2 },
  ],
};

describe('MyBoatCard', () => {
  it('shows each hour with the boat and the crew mates', () => {
    render(<MyBoatCard assignments={myAssignments(data, 'jamie')} nameOf={nameOf} boatName={boatName} />);
    const card = screen.getByRole('region', { name: tr.program.yours });
    expect(within(card).getByText('09:00–10:00')).toBeInTheDocument();
    expect(within(card).getByText('Mavi')).toBeInTheDocument();
    expect(within(card).getByText('John ile')).toBeInTheDocument();
    expect(within(card).getByText('sprint çalışması')).toBeInTheDocument();
  });

  it('draws the boat icon by capacity next to each boat name (double for Mavi, quad for the C4X)', () => {
    const capacities: Record<string, number> = { mavi: 2, turuncu: 2 };
    render(<MyBoatCard assignments={myAssignments(data, 'jamie')} nameOf={nameOf} boatName={boatName} capacityOf={(id) => capacities[id] ?? 4} />);
    const icon = screen.getByRole('region', { name: tr.program.yours }).querySelector('svg[data-boat]') as SVGElement;
    expect(icon).toHaveAttribute('data-boat', 'double');
  });

  it("wears the colour of the boat the member rows in: the card, the time, the boat icon (Turuncu = orange, boat-2)", () => {
    render(<MyBoatCard assignments={myAssignments(data, 'becca')} nameOf={nameOf} boatName={boatName} styleOf={(id) => boatStyle(id === 'turuncu' ? 1 : 0)} />);
    const card = screen.getByRole('region', { name: tr.program.yours });
    expect(card.className).toContain('border-boat-2');
    expect(card.className).toContain('bg-boat-2-soft');
    expect(card.className).not.toContain('bg-primary-soft');
    expect(screen.getByRole('heading', { name: tr.program.yours }).className).toContain('text-boat-2');
    expect(within(card).getByText('08:15–09:15').parentElement?.className).toContain('text-boat-2');
    expect((card.querySelector('svg[data-boat]') as SVGElement).getAttribute('class')).toContain('text-boat-2');
  });

  it("keeps the card itself blue when the member rows in more than one boat, each row still in its own boat's colour", () => {
    const both: ProgramData = { ...data, crew: [...data.crew, { assignment_id: 'a3', training_id: 't', slot_index: 2, member_id: 'jamie', seat: 3 }] };
    render(<MyBoatCard assignments={myAssignments(both, 'jamie')} nameOf={nameOf} boatName={boatName} styleOf={(id) => boatStyle(id === 'turuncu' ? 1 : 0)} />);
    const card = screen.getByRole('region', { name: tr.program.yours });
    expect(card.className).toContain('bg-primary-soft');
    expect(within(card).getByText('09:00–10:00').parentElement?.className).toContain('text-boat-1');
    expect(within(card).getByText('08:15–09:15').parentElement?.className).toContain('text-boat-2');
  });

  it('leads with the start hour, big, and the end hour small beneath it (read out as one range)', () => {
    render(<MyBoatCard assignments={myAssignments(data, 'jamie')} nameOf={nameOf} boatName={boatName} />);
    const card = screen.getByRole('region', { name: tr.program.yours });
    const range = within(card).getByText('09:00–10:00'); // screen-reader text of the time block
    const block = range.parentElement as HTMLElement;
    const start = within(block).getByText('09:00');
    expect(start.className).toContain('text-3xl');
    expect(start.className).toContain('font-extrabold');
    expect(within(block).getByText('–10:00').className).toContain('text-xs');
  });

  it('carries no weather of its own: the forecast has one place, right below the card', () => {
    render(<MyBoatCard assignments={myAssignments(data, 'jamie')} nameOf={nameOf} boatName={boatName} />);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.queryByText(/Tahmin/)).not.toBeInTheDocument();
    expect(screen.queryByText(tr.weather.mySessionLater)).not.toBeInTheDocument();
  });

  it('shows every hour for someone who rows twice, alone when nobody else is in the boat', () => {
    const solo: ProgramData = { ...data, crew: [...data.crew.filter((c) => c.member_id !== 'john' && c.member_id !== 'jamie'), { assignment_id: 'a2', training_id: 't', slot_index: 1, member_id: 'ali', seat: 1 }] };
    render(<MyBoatCard assignments={myAssignments(solo, 'ali')} nameOf={nameOf} boatName={boatName} />);
    expect(screen.getByText('08:15–09:15')).toBeInTheDocument();
    expect(screen.getByText('Becca ile')).toBeInTheDocument();
    expect(screen.getByText('09:00–10:00')).toBeInTheDocument();
    expect(screen.getByText('tek başına')).toBeInTheDocument();
  });
});

describe('ProgramByBoat (the whole published program, grouped by boat)', () => {
  const boats = [
    { id: 'mavi', name: 'Mavi', sort_order: 1, capacity: 2 },
    { id: 'turuncu', name: 'Turuncu', sort_order: 2, capacity: 2 },
  ];
  const phones: Record<string, string | null> = { alex: '0555 111 22 33', ashley: null };
  const contactOf = (id: string) => (id in names ? { id, full_name: names[id] as string, phone: phones[id] ?? null } : null);
  // the contact card links to the member's profile, so it needs a router
  const show = (meId?: string) =>
    render(
      <MemoryRouter>
        <ProgramByBoat data={data} boats={boats} meId={meId} nameOf={nameOf} contactOf={contactOf} />
      </MemoryRouter>,
    );
  // the accessible name of a boat I row in also carries the "Sizin tekneniz" tag, so match on the boat name at the start
  const boatSection = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name}(?: ${tr.program.yourBoat})?$`) });

  it('shows one block per boat with every session: its time range and its crew', () => {
    show();
    const mavi = boatSection('Mavi');
    expect(within(mavi).getByText('08:00–09:00')).toBeInTheDocument();
    expect(within(mavi).getByText('09:00–10:00')).toBeInTheDocument();
    expect(within(mavi).getAllByRole('listitem')).toHaveLength(2);
    for (const name of ['Alex', 'Ashley', 'John', 'Jamie']) expect(within(mavi).getByText(name)).toBeInTheDocument();
    const turuncu = boatSection('Turuncu');
    expect(within(turuncu).getByText('08:15–09:15')).toBeInTheDocument(); // Turuncu's own schedule
    expect(within(turuncu).queryByText('09:00–10:00')).not.toBeInTheDocument();
    expect(within(turuncu).queryByText('08:00–09:00')).not.toBeInTheDocument(); // Mavi's time is not Turuncu's
    expect(within(turuncu).getByText('Ali')).toBeInTheDocument();
    expect(within(turuncu).getByText('Becca')).toBeInTheDocument();
  });

  it('lists the boats in the club order, each in its own colour (the name is always written out too)', () => {
    show();
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(['Mavi', 'Turuncu']);
    expect(headings[0]?.className).toContain('text-boat-1');
    expect(headings[1]?.className).toContain('text-boat-2');
    expect(boatSection('Mavi').className).toContain('border-boat-1');
    expect(boatSection('Turuncu').className).toContain('border-boat-2');
  });

  it('shows the FULL program to a member who is in no boat, with nothing highlighted', () => {
    show('nobody');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    for (const name of ['Alex', 'Ashley', 'John', 'Jamie', 'Ali', 'Becca']) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.queryByText(tr.program.yourSession, { exact: false })).not.toBeInTheDocument();
  });

  it("tints the reader's own session in THEIR boat's colour — and only that one — while the others stay plain and readable", () => {
    show('jamie');
    const mavi = boatSection('Mavi');
    const rows = within(mavi).getAllByRole('listitem');
    expect(rows[0]).not.toHaveAttribute('data-mine'); // Alex + Ashley
    expect(rows[1]).toHaveAttribute('data-mine', 'true'); // John + Jamie
    // Mavi is the club's first boat, so its accent is boat-1 (blue): a soft tint and a bar in that colour, a little taller than the other rows
    expect(rows[1]?.className).toContain('bg-boat-1-soft');
    expect(rows[1]?.className).toContain('border-boat-1');
    expect(rows[1]?.className).toContain('py-4');
    expect(rows[1]?.className).not.toContain('bg-primary');
    expect(rows[0]?.className).not.toContain('boat-1');
    expect(rows[0]?.className).toContain('border-transparent'); // ... and the same left inset, so the names still line up
    // the crew are compact chips of ONE size everywhere; only my own chip is inverse (white on blue) and says whose session it is
    const chip = (row: HTMLElement | undefined, name: string) => within(row as HTMLElement).getByText(name, { exact: false }).closest('span,button') as HTMLElement;
    for (const [row, name] of [[rows[0], 'Ashley'], [rows[1], 'John'], [rows[1], 'Jamie']] as const) {
      expect(chip(row, name).className).toContain('text-sm');
      expect(chip(row, name).className).toContain('min-h-9');
      expect(chip(row, name).className).not.toContain('text-lg');
    }
    expect(chip(rows[1], 'Jamie').className).toContain('bg-boat-1'); // me: the boat's colour itself ...
    expect(chip(rows[1], 'Jamie').className).toContain('text-surface'); // ... with text that reads on it in both themes
    expect(chip(rows[1], 'John').className).toContain('border-boat-1/40'); // the others on my row: white chips with a soft edge in the boat's colour
    expect(chip(rows[0], 'Ashley').className).toContain('bg-surface-2'); // other rows: soft chip
    expect(within(rows[1] as HTMLElement).getByText(`— ${tr.program.yourSession}`, { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText(tr.program.yourSession, { exact: false })).toHaveLength(1);
    // everybody else is still there, unhighlighted
    expect(within(boatSection('Turuncu')).getByText('Ali')).toBeInTheDocument();
    expect(within(boatSection('Turuncu')).getAllByRole('listitem')[0]).not.toHaveAttribute('data-mine');
  });

  it('lists the boats I row in FIRST (tagged "Sizin tekneniz"), the others keep the club order', () => {
    show('becca'); // Becca is in Turuncu only
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['TuruncuSizin tekneniz', 'Mavi']);
    expect(within(boatSection('Turuncu')).getByText(tr.program.yourBoat)).toBeInTheDocument();
    expect(within(boatSection('Mavi')).queryByText(tr.program.yourBoat)).not.toBeInTheDocument();
  });

  it('keeps the club order for someone in no boat, and for the neutral (coach) view — with no tag at all', () => {
    show('nobody');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Mavi', 'Turuncu']);
    expect(screen.queryByText(tr.program.yourBoat)).not.toBeInTheDocument();
  });

  it('a person in two boats sees both first, in club order', () => {
    const both: ProgramData = { ...data, crew: [...data.crew, { assignment_id: 'a3', training_id: 't', slot_index: 0, member_id: 'jamie', seat: 3 }].filter((c) => !(c.assignment_id === 'a3' && c.member_id === 'becca')) };
    render(<ProgramByBoat data={both} boats={boats} meId="jamie" nameOf={nameOf} />);
    expect(screen.getAllByText(tr.program.yourBoat)).toHaveLength(2);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['MaviSizin tekneniz', 'TuruncuSizin tekneniz']);
  });

  it('gives each boat its icon by capacity, and the highlight takes the colour of the boat I row in', () => {
    const withQuad = [...boats, { id: 'c4x', name: 'C4X', sort_order: 3, capacity: 4 }];
    const quad: ProgramData = { ...data, assignments: [...data.assignments, asg('a4', 5, 'c4x', '05:30', '06:30', null)], crew: [...data.crew, { assignment_id: 'a4', training_id: 't', slot_index: 5, member_id: 'jamie', seat: 1 }] };
    render(<ProgramByBoat data={quad} boats={withQuad} meId="jamie" nameOf={nameOf} />);
    expect(boatSection('C4X').querySelector('svg[data-boat]')).toHaveAttribute('data-boat', 'quad');
    expect(boatSection('Mavi').querySelector('svg[data-boat]')).toHaveAttribute('data-boat', 'double');
    // each of my sessions wears ITS boat's colour: Mavi blue (boat-1), the C4X purple (boat-3) — never the other's
    const mavi = boatSection('Mavi').querySelector('li[data-mine="true"]') as HTMLElement;
    const c4x = boatSection('C4X').querySelector('li[data-mine="true"]') as HTMLElement;
    expect(mavi.className).toContain('bg-boat-1-soft');
    expect(mavi.className).not.toContain('boat-3');
    expect(c4x.className).toContain('bg-boat-3-soft');
    expect(c4x.className).toContain('border-boat-3');
    expect(c4x.className).not.toContain('boat-1');
    // the "Sizin tekneniz" tags carry the same colours
    expect(within(boatSection('C4X')).getByText(tr.program.yourBoat).className).toContain('bg-boat-3');
    expect(within(boatSection('Mavi')).getByText(tr.program.yourBoat).className).toContain('bg-boat-1');
  });

  it("Turuncu members get the orange theme, and nobody else's rows (or boats) are tinted", () => {
    show('becca'); // Becca rows in Turuncu only
    const own = boatSection('Turuncu').querySelector('li[data-mine="true"]') as HTMLElement;
    expect(own.className).toContain('bg-boat-2-soft');
    expect(own.className).toContain('border-boat-2');
    const tinted = Array.from(document.querySelectorAll('li')).filter((li) => /-soft(?: |$)/.test(li.className));
    expect(tinted).toEqual([own]); // no other session carries a tint
    expect(within(boatSection('Mavi')).queryByText(tr.program.yourBoat)).not.toBeInTheDocument();
  });

  it('a neutral view (no reader) tints nothing at all', () => {
    show();
    expect(Array.from(document.querySelectorAll('li')).filter((li) => /-soft(?: |$)/.test(li.className))).toHaveLength(0);
  });

  it('puts the time first in every row: start hour big and bold, end hour small, a divider before the crew', () => {
    show();
    const rows = within(boatSection('Mavi')).getAllByRole('listitem');
    const expected = [
      [rows[0], '08:00', '–09:00', '08:00–09:00'],
      [rows[1], '09:00', '–10:00', '09:00–10:00'],
    ] as const;
    for (const [row, start, end, range] of expected) {
      const scoped = within(row as HTMLElement);
      expect(scoped.getByText(start).className).toContain('text-2xl');
      expect(scoped.getByText(start).className).toContain('font-extrabold');
      expect(scoped.getByText(end).className).toContain('text-xs');
      expect(scoped.getByText(range).className).toContain('sr-only'); // read out as one range
    }
    // the time block comes BEFORE the crew, separated from it by a divider
    const first = rows[0] as HTMLElement;
    expect(first.firstElementChild?.textContent).toContain('08:00');
    expect(first.firstElementChild?.className).toContain('border-r');
  });

  it('keeps every name the same size and shape whether a session has one name or four, always after its own time', () => {
    const uneven: ProgramData = {
      ...data,
      crew: [
        { assignment_id: 'a1', training_id: 't', slot_index: 0, member_id: 'alex', seat: 1 },
        { assignment_id: 'a1', training_id: 't', slot_index: 0, member_id: 'ashley', seat: 2 },
        { assignment_id: 'a1', training_id: 't', slot_index: 0, member_id: 'ali', seat: 3 },
        { assignment_id: 'a1', training_id: 't', slot_index: 0, member_id: 'becca', seat: 4 },
        { assignment_id: 'a2', training_id: 't', slot_index: 1, member_id: 'john', seat: 1 },
      ],
    };
    render(
      <MemoryRouter>
        <ProgramByBoat data={uneven} boats={boats} nameOf={nameOf} contactOf={contactOf} />
      </MemoryRouter>,
    );
    const rows = within(boatSection('Mavi')).getAllByRole('listitem');
    const chips = (row: HTMLElement | undefined) => Array.from((row as HTMLElement).querySelectorAll('button, span.min-h-9'));
    expect(chips(rows[0]).map((c) => c.textContent)).toEqual(['Alex', 'Ashley', 'Ali', 'Becca']);
    expect(chips(rows[1]).map((c) => c.textContent)).toEqual(['John']);
    const shape = (c: Element) => c.className.split(/\s+/).filter((cls) => cls !== 'w-full').join(' '); // the grid only stretches the chip to its cell
    expect(new Set([...chips(rows[0]), ...chips(rows[1])].map(shape)).size).toBe(1); // one look for everybody, so the rows stay even
    expect((rows[0] as HTMLElement).querySelector('.grid-cols-2')).not.toBeNull(); // four names: an even 2 × 2 grid
    expect((rows[1] as HTMLElement).querySelector('.grid-cols-2')).toBeNull(); // one name: no grid
    // the time sits first (left) in each row, the crew after it
    expect((rows[0] as HTMLElement).firstElementChild?.textContent).toContain('08:00');
    expect(within(rows[0] as HTMLElement).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(
      ['Alex', 'Ashley', 'Ali', 'Becca'].map((n) => tr.program.contactAbout(n)),
    );
  });

  it('never repeats the weather inside the program: no forecast in any row, mine or not', () => {
    show('jamie');
    expect(screen.queryByText(/Yağmurlu|Açık|Parçalı bulutlu|km\/s/)).not.toBeInTheDocument();
  });

  it('highlights each of my sessions when I row more than once', () => {
    const twice: ProgramData = { ...data, crew: [...data.crew, { assignment_id: 'a3', training_id: 't', slot_index: 0, member_id: 'alex', seat: 3 }].filter((c) => !(c.assignment_id === 'a1' && c.member_id === 'alex')) };
    render(<ProgramByBoat data={twice} boats={boats} meId="alex" nameOf={nameOf} />);
    expect(screen.getAllByText(tr.program.yourSession, { exact: false })).toHaveLength(1);
  });

  it('shows notes for a boat session', () => {
    show();
    expect(within(boatSection('Mavi')).getByText('sprint çalışması')).toBeInTheDocument();
  });

  it("opens a member's phone number from their name — but not for the reader themselves", () => {
    show('jamie');
    expect(screen.queryByRole('button', { name: /Jamie/ })).not.toBeInTheDocument(); // me: plain bold text
    fireEvent.click(screen.getByRole('button', { name: tr.program.contactAbout('Alex') }));
    const link = screen.getByRole('link', { name: new RegExp(`^${tr.contact.call}: Alex`) });
    expect(link).toHaveAttribute('href', 'tel:05551112233');
    expect(link).toHaveTextContent('0555 111 22 33');
  });

  it("offers a link to the member's profile in their contact card", () => {
    show('jamie');
    fireEvent.click(screen.getByRole('button', { name: tr.program.contactAbout('Alex') }));
    expect(screen.getByRole('link', { name: tr.contact.openProfileLabel('Alex') })).toHaveAttribute('href', '/uye/uyeler/alex');
  });

  it('leaves out the profile link when the viewer is a coach (profiles are a member page), but keeps the phone', () => {
    render(
      <MemoryRouter>
        <ProgramByBoat data={data} boats={boats} nameOf={nameOf} contactOf={contactOf} profileLinks={false} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: tr.program.contactAbout('Alex') }));
    expect(screen.getByRole('link', { name: new RegExp(`^${tr.contact.call}: Alex`) })).toHaveAttribute('href', 'tel:05551112233');
    expect(screen.queryByText(tr.contact.openProfile)).not.toBeInTheDocument();
    expect(screen.queryByText(tr.program.yourBoat)).not.toBeInTheDocument(); // neutral view: nobody is "me"
  });

  it('says so when a member has no phone number saved', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: tr.program.contactAbout('Ashley') }));
    expect(screen.getByText(tr.contact.noPhone)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: new RegExp(`^${tr.contact.call}:`) })).not.toBeInTheDocument(); // nothing to dial
    expect(screen.getByRole('link', { name: tr.contact.openProfileLabel('Ashley') })).toBeInTheDocument(); // the profile is still there
  });

  it('shows plain names (no buttons) without a directory, and says so for an empty program', () => {
    const { unmount } = render(<ProgramByBoat data={data} boats={boats} nameOf={nameOf} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();
    render(<ProgramByBoat data={{ program: null, assignments: [], crew: [] }} boats={boats} nameOf={nameOf} />);
    expect(screen.getByText(tr.program.noBoats)).toBeInTheDocument();
  });
});

describe('TrainingNote / WeatherNote', () => {
  it("show the coach's notes, and nothing when there is no note", () => {
    const { container, rerender } = render(
      <>
        <TrainingNote notes="Isınma 10 dk" />
        <WeatherNote note="Rüzgâr batıdan" />
      </>,
    );
    expect(screen.getByText('Isınma 10 dk')).toBeInTheDocument();
    expect(screen.getByText('Rüzgâr batıdan')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: tr.program.weather })).toBeInTheDocument();
    rerender(
      <>
        <TrainingNote notes={null} />
        <WeatherNote note={null} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
