import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { tr } from '@/strings/tr';
import type { Boat } from '@/types/database';
import { BoatSchedule } from './BoatSchedule';
import type { ProgramDraft, SessionDraft, SessionProblem } from './model';
import { SessionCard } from './SessionCard';

const boat = (over: Partial<Boat> = {}): Boat => ({ id: 'mavi', name: 'Mavi', capacity: 2, is_active: true, sort_order: 1, requires_full_crew: false, has_coxswain: false, created_at: '', updated_at: '', ...over }) as Boat;
const nameOf = (id: string) => ({ a: 'Alex', b: 'Ashley', c: 'Can', d: 'Deniz', k: 'Ayşe Antrenör' })[id as 'a' | 'b' | 'c' | 'd' | 'k'] ?? '?';
const boatName = (id: string) => ({ mavi: 'Mavi', turuncu: 'Turuncu' })[id as 'mavi' | 'turuncu'] ?? '?';
const session = (over: Partial<SessionDraft> = {}): SessionDraft => ({ id: 0, boatId: 'mavi', start: '08:15', end: '09:15', crew: [], cox: null, notes: '', ...over });

const handlers = () => ({
  onStart: vi.fn(),
  onEnd: vi.fn(),
  onEdit: vi.fn(),
  onRemoveMember: vi.fn(),
  onMoveMember: vi.fn(),
  onPickCox: vi.fn(),
  onRemoveCox: vi.fn(),
  onNotes: vi.fn(),
  onMove: vi.fn(),
  onRemove: vi.fn(),
});
const showCard = (props: Partial<Parameters<typeof SessionCard>[0]> = {}) => {
  const h = handlers();
  render(<SessionCard session={session()} boat={boat()} position={0} index={0} count={1} problems={[]} trainingStart="08:00" nameOf={nameOf} boatName={boatName} {...h} {...props} />);
  return h;
};

describe('SessionCard (one session of one boat)', () => {
  it('shows the session\'s own start and end as editable times, and how long it lasts', () => {
    showCard();
    const group = screen.getByRole('group', { name: 'Mavi, 08:15–09:15' });
    expect(within(group).getByLabelText(tr.program.startLabel)).toHaveValue('08:15');
    expect(within(group).getByLabelText(tr.program.endLabel)).toHaveValue('09:15');
    expect(within(group).getByText('1 sa')).toBeInTheDocument();
  });

  it('says which boat it is on the card itself, in the boat\'s colour, with the session\'s number in that boat', () => {
    showCard({ boat: boat({ id: 'turuncu', name: 'Turuncu' }), position: 1, index: 1, count: 3 });
    const chip = screen.getByText('Turuncu · 2. seans');
    expect(chip.className).toContain('text-boat-2');
  });

  it('reports a new start or end (and ignores a cleared field)', () => {
    const h = showCard();
    fireEvent.change(screen.getByLabelText(tr.program.startLabel), { target: { value: '08:30' } });
    expect(h.onStart).toHaveBeenCalledWith('08:30');
    fireEvent.change(screen.getByLabelText(tr.program.endLabel), { target: { value: '10:15' } });
    expect(h.onEnd).toHaveBeenCalledWith('10:15');
    fireEvent.change(screen.getByLabelText(tr.program.endLabel), { target: { value: '' } });
    expect(h.onEnd).toHaveBeenCalledTimes(1);
  });

  it('says a custom length in words', () => {
    showCard({ session: session({ start: '09:00', end: '10:15' }) });
    expect(screen.getByText('1 sa 15 dk')).toBeInTheDocument();
  });

  it('offers "Ekip seç" for an empty session and "Ekibi düzenle" with a crew, with a remove button per person', () => {
    const empty = showCard();
    fireEvent.click(screen.getByRole('button', { name: tr.program.pickCrew }));
    expect(empty.onEdit).toHaveBeenCalledTimes(1);
    const filled = showCard({ session: session({ id: 1, crew: ['a', 'b'] }) });
    expect(screen.getByText('2/2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: tr.program.removeFromBoat('Ashley') }));
    expect(filled.onRemoveMember).toHaveBeenCalledWith('b');
    expect(screen.getAllByRole('button', { name: tr.program.editCrew })).toHaveLength(1);
  });

  it('lets the coach swap teams with a neighbour only where there is one (no "up" on the first, no "down" on the last)', () => {
    const first = showCard({ index: 0, count: 3 });
    expect(screen.getByRole('button', { name: tr.program.swapWithPrevious('08:15–09:15') })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: tr.program.swapWithNext('08:15–09:15') }));
    expect(first.onMove).toHaveBeenCalledWith(1);
  });

  it('removes the session', () => {
    const h = showCard({ index: 1, count: 2 });
    fireEvent.click(screen.getByRole('button', { name: tr.program.removeSession }));
    expect(h.onRemove).toHaveBeenCalledTimes(1);
  });

  it('writes each problem next to the session in words: order, overlap with the boat\'s other session, the same person elsewhere', () => {
    const other = session({ id: 4, boatId: 'turuncu', start: '08:45', end: '09:45' });
    const problems: SessionProblem[] = [
      { kind: 'order' },
      { kind: 'boat-overlap', other: session({ id: 2, start: '09:00', end: '10:00' }) },
      { kind: 'person-overlap', other, memberId: 'a' },
    ];
    showCard({ problems });
    const list = screen.getByRole('alert');
    expect(within(list).getByText(tr.program.problemOrder)).toBeInTheDocument();
    expect(within(list).getByText(tr.program.problemBoatOverlap('09:00–10:00'))).toBeInTheDocument();
    expect(within(list).getByText(tr.program.problemPersonOverlap('Alex', 'Turuncu', '08:45–09:45'))).toBeInTheDocument();
    expect(screen.getByLabelText(tr.program.startLabel)).toHaveAttribute('aria-invalid', 'true');
  });

  it('flags a C4X crew that is not full', () => {
    showCard({ boat: boat({ id: 'c4x', name: 'C4X', capacity: 4, requires_full_crew: true }), session: session({ crew: ['a'] }) });
    expect(screen.getByText(tr.program.fullCrewBadge(4)).className).toContain('text-warning');
    expect(screen.getByText('1/4')).toBeInTheDocument();
  });
});

describe('SessionCard: crew order and the dümenci', () => {
  const c4x = () => boat({ id: 'c4x', name: 'C4X', capacity: 4, requires_full_crew: true, has_coxswain: true });

  it('lists the rowers in their seat order with a number, and lets the coach move each one earlier or later', () => {
    const h = showCard({ boat: c4x(), session: session({ boatId: 'c4x', crew: ['c', 'a', 'd', 'b'] }) });
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['1Can', '2Alex', '3Deniz', '4Ashley'].map((t) => expect.stringContaining(t)));
    fireEvent.click(screen.getByRole('button', { name: tr.program.moveEarlier('Deniz') }));
    expect(h.onMoveMember).toHaveBeenCalledWith('d', -1);
    fireEvent.click(screen.getByRole('button', { name: tr.program.moveLater('Alex') }));
    expect(h.onMoveMember).toHaveBeenCalledWith('a', 1);
  });

  it('cannot move the first rower earlier or the last one later', () => {
    showCard({ session: session({ crew: ['a', 'b'] }) });
    expect(screen.getByRole('button', { name: tr.program.moveEarlier('Alex') })).toBeDisabled();
    expect(screen.getByRole('button', { name: tr.program.moveLater('Ashley') })).toBeDisabled();
    expect(screen.getByRole('button', { name: tr.program.moveLater('Alex') })).toBeEnabled();
  });

  it('shows no numbers or arrows for a single rower', () => {
    showCard({ session: session({ crew: ['a'] }) });
    expect(screen.queryByRole('button', { name: tr.program.moveEarlier('Alex') })).not.toBeInTheDocument();
    expect(screen.queryByText(tr.program.crewOrderHint)).not.toBeInTheDocument();
  });

  it('has a Dümenci section on a boat with one — apart from the rowers and not counted among them', () => {
    const h = showCard({ boat: c4x(), session: session({ boatId: 'c4x', crew: ['a', 'b', 'c', 'd'] }) });
    const group = screen.getByRole('group', { name: tr.program.cox });
    expect(within(group).getByText(tr.program.coxNone)).toBeInTheDocument();
    expect(screen.getByText('4/4')).toBeInTheDocument(); // rowers only
    fireEvent.click(within(group).getByRole('button', { name: tr.program.coxPick }));
    expect(h.onPickCox).toHaveBeenCalled();
  });

  it('shows the chosen dümenci, marks a coach as such, and can change or remove them', () => {
    const h = showCard({ boat: c4x(), session: session({ boatId: 'c4x', crew: ['a', 'b', 'c', 'd'], cox: 'k' }), isCoach: (id) => id === 'k' });
    const group = screen.getByRole('group', { name: tr.program.cox });
    expect(within(group).getByText('Ayşe Antrenör')).toBeInTheDocument();
    expect(within(group).getByText(tr.program.coxCoachTag)).toBeInTheDocument();
    expect(within(group).queryByText(tr.program.coxNone)).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: `${tr.program.coxChange}: Ayşe Antrenör` }));
    expect(h.onPickCox).toHaveBeenCalled();
    fireEvent.click(within(group).getByRole('button', { name: tr.program.coxRemove('Ayşe Antrenör') }));
    expect(h.onRemoveCox).toHaveBeenCalled();
  });

  it('has no Dümenci section on a boat without one, or while nobody rows yet', () => {
    showCard({ session: session({ crew: ['a', 'b'] }) });
    expect(screen.queryByRole('group', { name: tr.program.cox })).not.toBeInTheDocument();
  });
});

describe('BoatSchedule (one boat and its own sequence)', () => {
  const draft: ProgramDraft = {
    weatherNote: '',
    trainingNotes: '',
    sessions: [
      session({ id: 0, start: '08:15', end: '09:15', crew: ['a'] }),
      session({ id: 1, start: '09:15', end: '10:30', crew: ['b'] }),
      session({ id: 2, boatId: 'turuncu', start: '08:00', end: '09:00', crew: ['a'] }), // another boat: never shown here
    ],
  };
  const show = (over: Partial<Parameters<typeof BoatSchedule>[0]> = {}) => {
    const onAdd = vi.fn();
    render(
      <BoatSchedule
        boat={boat()}
        position={0}
        draft={draft}
        trainingStart="08:00"
        problems={new Map()}
        nameOf={nameOf}
        boatName={boatName}
        onAdd={onAdd}
        onStart={vi.fn()}
        onEnd={vi.fn()}
        onEdit={vi.fn()}
        onRemoveMember={vi.fn()}
        onMoveMember={vi.fn()}
        onPickCox={vi.fn()}
        onRemoveCox={vi.fn()}
        onNotes={vi.fn()}
        onMove={vi.fn()}
        onRemove={vi.fn()}
        {...over}
      />,
    );
    return { onAdd };
  };

  it('is one clearly named section in the boat\'s colour with the boat\'s schedule in its header and only ITS sessions', () => {
    show();
    const section = screen.getByRole('group', { name: 'Mavi' });
    expect(section.className).toContain('border-boat-1');
    expect(within(section).getByText('08:15–10:30 · 2 seans')).toBeInTheDocument();
    expect(within(section).getAllByRole('group')).toHaveLength(2); // the two Mavi sessions, not Turuncu's
    expect(within(section).queryByLabelText(tr.program.startLabel, { selector: '[value="08:00"]' })).not.toBeInTheDocument();
  });

  it('adds the next session right where the last one ended, and shows that time on the button', () => {
    const { onAdd } = show();
    const add = screen.getByRole('button', { name: /Seans ekle/ });
    expect(add).toHaveTextContent('10:30'); // the last session ends at 10:30
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('suggests the boat\'s first start for a boat with no sessions yet', () => {
    show({ draft: { ...draft, sessions: [] } });
    expect(screen.getByRole('button', { name: /Seans ekle/ })).toHaveTextContent('08:00');
  });
});
