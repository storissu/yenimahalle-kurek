import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { tr } from '@/strings/tr';
import { MyBoatCard, ProgramNotes, ProgramTimeline } from './ProgramTimeline';
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

describe('ProgramTimeline', () => {
  it('lists the hours in order with the boats and crews', () => {
    render(<ProgramTimeline timeline={timeline} training={training} nameOf={nameOf} boatName={boatName} />);
    const first = screen.getByRole('region', { name: tr.program.slotHeading(1, '08:00–09:00') });
    expect(within(first).getByText('Mavi')).toBeInTheDocument();
    expect(within(first).getByText('Turuncu')).toBeInTheDocument();
    expect(within(first).getByText('Alex')).toBeInTheDocument();
    expect(within(first).getByText('Becca')).toBeInTheDocument();
    const second = screen.getByRole('region', { name: tr.program.slotHeading(2, '09:00–10:00') });
    expect(within(second).getByText('John')).toBeInTheDocument();
    expect(within(second).queryByText('Turuncu')).not.toBeInTheDocument();
  });

  it('marks the reader\'s own boat', () => {
    render(<ProgramTimeline timeline={timeline} training={training} meId="jamie" nameOf={nameOf} boatName={boatName} />);
    const second = screen.getByRole('region', { name: tr.program.slotHeading(2, '09:00–10:00') });
    expect(within(second).getByText(tr.program.you)).toBeInTheDocument();
    const first = screen.getByRole('region', { name: tr.program.slotHeading(1, '08:00–09:00') });
    expect(within(first).queryByText(tr.program.you)).not.toBeInTheDocument();
  });

  it('says so when an hour has no boats', () => {
    render(<ProgramTimeline timeline={buildTimeline(data, 3, order)} training={training} nameOf={nameOf} boatName={boatName} />);
    expect(within(screen.getByRole('region', { name: tr.program.slotHeading(3, '10:00–11:00') })).getByText(tr.program.noBoats)).toBeInTheDocument();
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
