import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { tr } from '@/strings/tr';
import { MyBoatCard, ProgramNotes } from './ProgramParts';
import { ProgramByBoat } from './ProgramByBoat';
import { buildTimeline, myAssignments } from './view';
import type { ProgramData } from './model';

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

describe('MyBoatCard', () => {
  it('shows each hour with the boat and the crew mates', () => {
    render(<MyBoatCard assignments={myAssignments(timeline, 'jamie')} training={training} nameOf={nameOf} boatName={boatName} />);
    const card = screen.getByRole('region', { name: tr.program.yours });
    expect(within(card).getByText('09:00–10:00')).toBeInTheDocument();
    expect(within(card).getByText('Mavi')).toBeInTheDocument();
    expect(within(card).getByText('John ile')).toBeInTheDocument();
    expect(within(card).getByText('sprint çalışması')).toBeInTheDocument();
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
    { id: 'mavi', name: 'Mavi', sort_order: 1 },
    { id: 'turuncu', name: 'Turuncu', sort_order: 2 },
  ];
  const phones: Record<string, string | null> = { alex: '0555 111 22 33', ashley: null };
  const contactOf = (id: string) => (id in names ? { id, full_name: names[id] as string, phone: phones[id] ?? null } : null);
  const show = (meId?: string) => render(<ProgramByBoat data={data} training={training} boats={boats} meId={meId} nameOf={nameOf} contactOf={contactOf} />);
  const boatSection = (name: string) => screen.getByRole('region', { name });

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

  it("highlights the reader's own session — and only that one — while the others stay visible", () => {
    show('jamie');
    const mavi = boatSection('Mavi');
    const rows = within(mavi).getAllByRole('listitem');
    expect(rows[0]?.className).not.toContain('bg-primary-soft'); // Alex + Ashley
    expect(rows[1]?.className).toContain('bg-primary-soft'); // John + Jamie
    expect(within(rows[1] as HTMLElement).getByText(tr.program.you)).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText(`— ${tr.program.yourSession}`, { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText(tr.program.you)).toHaveLength(1);
    expect(within(boatSection('Turuncu')).getByText('Ali')).toBeInTheDocument();
    expect(within(boatSection('Turuncu')).getAllByRole('listitem')[0]?.className).not.toContain('bg-primary-soft');
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
    const link = screen.getByRole('link', { name: /Alex/ });
    expect(link).toHaveAttribute('href', 'tel:05551112233');
    expect(link).toHaveTextContent('0555 111 22 33');
  });

  it('says so when a member has no phone number saved', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: tr.program.contactAbout('Ashley') }));
    expect(screen.getByText(tr.contact.noPhone)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Ashley/ })).not.toBeInTheDocument();
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
