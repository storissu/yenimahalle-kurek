import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { tr } from '@/strings/tr';
import { MyBoatCard, ProgramNotes } from './ProgramParts';
import { ProgramByBoat } from './ProgramByBoat';
import { buildTimeline, myAssignments } from './view';
import type { ProgramData } from './model';
import type { WeatherSnapshot } from '@/types/database';

// 08:00 Istanbul, two one-hour sessions.
const training = { starts_at: '2026-09-22T05:00:00Z' };
const names: Record<string, string> = { alex: 'Alex', ashley: 'Ashley', john: 'John', jamie: 'Jamie', ali: 'Ali', becca: 'Becca' };
const nameOf = (id: string) => names[id] ?? '?';
const boatName = (id: string) => ({ mavi: 'Mavi', turuncu: 'Turuncu' })[id as 'mavi' | 'turuncu'] ?? '?';

const data: ProgramData = {
  program: null,
  assignments: [
    { id: 'a1', training_id: 't', slot_index: 0, boat_id: 'mavi', notes: null },
    { id: 'a2', training_id: 't', slot_index: 1, boat_id: 'mavi', notes: 'sprint çalışması' },
    { id: 'a3', training_id: 't', slot_index: 0, boat_id: 'turuncu', notes: null },
  ],
  crew: [
    { assignment_id: 'a1', training_id: 't', slot_index: 0, member_id: 'alex', seat: 1 },
    { assignment_id: 'a1', training_id: 't', slot_index: 0, member_id: 'ashley', seat: 2 },
    { assignment_id: 'a2', training_id: 't', slot_index: 1, member_id: 'john', seat: 1 },
    { assignment_id: 'a2', training_id: 't', slot_index: 1, member_id: 'jamie', seat: 2 },
    { assignment_id: 'a3', training_id: 't', slot_index: 0, member_id: 'ali', seat: 1 },
    { assignment_id: 'a3', training_id: 't', slot_index: 0, member_id: 'becca', seat: 2 },
  ],
};
const order = new Map([['mavi', 1], ['turuncu', 2]]);
const timeline = buildTimeline(data, 2, order);

// Forecast rows as the Edge Function stores them: one per session, for that session's start hour.
const forecast = (slot: number, over: Partial<WeatherSnapshot> = {}): WeatherSnapshot => ({
  training_id: 't', slot_index: slot, fetched_at: '2026-09-21T14:30:00Z', source: 'open-meteo', forecast_for: '2026-09-22T05:00:00Z',
  temperature_c: 21.4, apparent_c: 20, wind_kmh: 14.2, gust_kmh: 24, wind_dir_deg: 315, precip_prob: 10, precip_mm: 0, weather_code: 2, cloud_pct: 40,
  wave_height_m: 0.6, wave_period_s: 4, wave_dir_deg: 300, ...over,
});

describe('MyBoatCard', () => {
  it('shows each hour with the boat and the crew mates', () => {
    render(<MyBoatCard assignments={myAssignments(timeline, 'jamie')} training={training} nameOf={nameOf} boatName={boatName} />);
    const card = screen.getByRole('region', { name: tr.program.yours });
    expect(within(card).getByText('09:00–10:00')).toBeInTheDocument();
    expect(within(card).getByText('Mavi')).toBeInTheDocument();
    expect(within(card).getByText('John ile')).toBeInTheDocument();
    expect(within(card).getByText('sprint çalışması')).toBeInTheDocument();
  });

  it('draws the boat icon by capacity next to each boat name (double for Mavi, quad for the C4X)', () => {
    const capacities: Record<string, number> = { mavi: 2, turuncu: 2 };
    render(<MyBoatCard assignments={myAssignments(timeline, 'jamie')} training={training} nameOf={nameOf} boatName={boatName} capacityOf={(id) => capacities[id] ?? 4} />);
    const icon = screen.getByRole('region', { name: tr.program.yours }).querySelector('svg[data-boat]') as SVGElement;
    expect(icon).toHaveAttribute('data-boat', 'double');
  });

  it("shows the forecast for EACH of my sessions' own hour, right under that session", () => {
    const rows = [forecast(0, { temperature_c: 18.2, wind_kmh: 9, gust_kmh: 14, weather_code: 0, wave_height_m: 0.3 }), forecast(1, { temperature_c: 23.6, wind_kmh: 27, gust_kmh: 38, weather_code: 63, precip_prob: 70, wave_height_m: 1.4 })];
    const solo: ProgramData = { ...data, crew: [...data.crew.filter((c) => c.member_id !== 'john' && c.member_id !== 'jamie'), { assignment_id: 'a2', training_id: 't', slot_index: 1, member_id: 'ali', seat: 1 }] };
    render(<MyBoatCard assignments={myAssignments(buildTimeline(solo, 2, order), 'ali')} training={training} nameOf={nameOf} boatName={boatName} weatherOf={(slot) => rows[slot]} />);
    const first = screen.getByRole('group', { name: tr.weather.forSession('08:00–09:00') });
    expect(within(first).getByText(/Açık · 18°/)).toBeInTheDocument();
    expect(within(first).getByText(/KB 9 km\/s · hamle 14 km\/s/)).toBeInTheDocument();
    expect(within(first).getByText('dalga 0,3 m')).toBeInTheDocument();
    const second = screen.getByRole('group', { name: tr.weather.forSession('09:00–10:00') });
    expect(within(second).getByText(/Yağmurlu · 24°/)).toBeInTheDocument(); // 23.6 rounds to 24
    expect(within(second).getByText('yağış %70')).toBeInTheDocument();
    expect(within(second).getByText('dalga 1,4 m')).toBeInTheDocument();
    expect(within(first).getByText(/Tahmin: \d\d:\d\d/)).toBeInTheDocument();
  });

  it('says the forecast is not there yet when the session has no row, and shows nothing when weather is not offered', () => {
    const { unmount } = render(<MyBoatCard assignments={myAssignments(timeline, 'jamie')} training={training} nameOf={nameOf} boatName={boatName} weatherOf={() => undefined} />);
    expect(screen.getByText(tr.weather.mySessionLater)).toBeInTheDocument();
    unmount();
    render(<MyBoatCard assignments={myAssignments(timeline, 'jamie')} training={training} nameOf={nameOf} boatName={boatName} />);
    expect(screen.queryByText(tr.weather.mySessionLater)).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('shows every hour for someone who rows twice, alone when nobody else is in the boat', () => {
    const solo: ProgramData = { ...data, crew: [...data.crew.filter((c) => c.member_id !== 'john' && c.member_id !== 'jamie'), { assignment_id: 'a2', training_id: 't', slot_index: 1, member_id: 'ali', seat: 1 }] };
    render(<MyBoatCard assignments={myAssignments(buildTimeline(solo, 2, order), 'ali')} training={training} nameOf={nameOf} boatName={boatName} />);
    expect(screen.getByText('08:00–09:00')).toBeInTheDocument();
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
        <ProgramByBoat data={data} training={training} boats={boats} meId={meId} nameOf={nameOf} contactOf={contactOf} />
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
    expect(within(turuncu).getByText('08:00–09:00')).toBeInTheDocument();
    expect(within(turuncu).queryByText('09:00–10:00')).not.toBeInTheDocument(); // Turuncu rests in the second hour
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
    expect(screen.queryByText(tr.program.you)).not.toBeInTheDocument();
  });

  it("makes the reader's own session a solid block — and only that one — while the others stay plain and readable", () => {
    show('jamie');
    const mavi = boatSection('Mavi');
    const rows = within(mavi).getAllByRole('listitem');
    expect(rows[0]).not.toHaveAttribute('data-mine'); // Alex + Ashley
    expect(rows[1]).toHaveAttribute('data-mine', 'true'); // John + Jamie
    // solid blue with the "text on blue" colour, larger and bolder than the other rows
    expect(rows[1]?.className).toContain('bg-primary');
    expect(rows[1]?.className).toContain('text-primary-fg');
    expect(rows[1]?.className).toContain('py-4');
    expect(rows[0]?.className).not.toContain('bg-primary');
    expect(within(rows[1] as HTMLElement).getByText('09:00–10:00').className).toContain('text-lg');
    expect(within(rows[0] as HTMLElement).getByText('08:00–09:00').className).not.toContain('text-lg');
    expect(within(rows[1] as HTMLElement).getByText(tr.program.you)).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText(`— ${tr.program.yourSession}`, { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText(tr.program.you)).toHaveLength(1);
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
    render(<ProgramByBoat data={both} training={training} boats={boats} meId="jamie" nameOf={nameOf} />);
    expect(screen.getAllByText(tr.program.yourBoat)).toHaveLength(2);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['MaviSizin tekneniz', 'TuruncuSizin tekneniz']);
  });

  it('gives each boat its icon by capacity, and the highlight does not depend on the boat colour', () => {
    const withQuad = [...boats, { id: 'c4x', name: 'C4X', sort_order: 3, capacity: 4 }];
    const quad: ProgramData = { ...data, assignments: [...data.assignments, { id: 'a4', training_id: 't', slot_index: 0, boat_id: 'c4x', notes: null }], crew: [...data.crew, { assignment_id: 'a4', training_id: 't', slot_index: 0, member_id: 'jamie', seat: 1 }] };
    render(<ProgramByBoat data={quad} training={training} boats={withQuad} meId="jamie" nameOf={nameOf} />);
    expect(boatSection('C4X').querySelector('svg[data-boat]')).toHaveAttribute('data-boat', 'quad');
    expect(boatSection('Mavi').querySelector('svg[data-boat]')).toHaveAttribute('data-boat', 'double');
    // "me" is drawn with the same solid block in every boat, whatever the boat's accent colour
    for (const name of ['C4X', 'Mavi']) {
      const mine = boatSection(name).querySelector('li[data-mine="true"]') as HTMLElement;
      expect(mine.className).toContain('bg-primary');
      expect(mine.className).not.toMatch(/boat-\d/);
    }
  });

  it("shows the forecast for my session's hour inside my row (and only in my rows)", () => {
    const rows: Record<number, WeatherSnapshot> = { 1: forecast(1, { temperature_c: 23.6, wind_kmh: 27, weather_code: 63 }) };
    render(<ProgramByBoat data={data} training={training} boats={boats} meId="jamie" nameOf={nameOf} weatherOf={(slot) => rows[slot]} />);
    const mine = boatSection('Mavi').querySelector('li[data-mine="true"]') as HTMLElement;
    expect(within(mine).getByText(/Yağmurlu · 24° · KB 27 km\/s/)).toBeInTheDocument();
    expect(screen.getAllByText(/Yağmurlu/)).toHaveLength(1);
  });

  it('highlights each of my sessions when I row more than once', () => {
    const twice: ProgramData = { ...data, crew: [...data.crew, { assignment_id: 'a3', training_id: 't', slot_index: 0, member_id: 'alex', seat: 3 }].filter((c) => !(c.assignment_id === 'a1' && c.member_id === 'alex')) };
    render(<ProgramByBoat data={twice} training={training} boats={boats} meId="alex" nameOf={nameOf} />);
    expect(screen.getAllByText(tr.program.you)).toHaveLength(1);
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

  it('says so when a member has no phone number saved', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: tr.program.contactAbout('Ashley') }));
    expect(screen.getByText(tr.contact.noPhone)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: new RegExp(`^${tr.contact.call}:`) })).not.toBeInTheDocument(); // nothing to dial
    expect(screen.getByRole('link', { name: tr.contact.openProfileLabel('Ashley') })).toBeInTheDocument(); // the profile is still there
  });

  it('shows plain names (no buttons) without a directory, and says so for an empty program', () => {
    const { unmount } = render(<ProgramByBoat data={data} training={training} boats={boats} nameOf={nameOf} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();
    render(<ProgramByBoat data={{ program: null, assignments: [], crew: [] }} training={training} boats={boats} nameOf={nameOf} />);
    expect(screen.getByText(tr.program.noBoats)).toBeInTheDocument();
  });
});

describe('ProgramNotes', () => {
  it('shows weather and training notes, and nothing when both are empty', () => {
    const { container, rerender } = render(<ProgramNotes weatherNote="Rüzgâr batıdan" trainingNotes="Isınma 10 dk" />);
    expect(screen.getByText('Rüzgâr batıdan')).toBeInTheDocument();
    expect(screen.getByText('Isınma 10 dk')).toBeInTheDocument();
    rerender(<ProgramNotes weatherNote={null} trainingNotes={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
