import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { tr } from '@/strings/tr';
import type { Boat } from '@/types/database';
import { CrewPickerDialog, type RosterMemberInfo } from './CrewPickerDialog';
import type { ProgramDraft, SessionDraft } from './model';

const c4x = { id: 'c4x', name: 'C4X', capacity: 4, is_active: true, sort_order: 3, requires_full_crew: true, has_coxswain: true, created_at: '', updated_at: '' } as Boat;
const session = (over: Partial<SessionDraft>): SessionDraft => ({ id: 0, boatId: 'c4x', start: '08:30', end: '09:30', crew: [], cox: null, ...over });
const roster: RosterMemberInfo[] = [
  { id: 'a', name: 'Alex', answer: 'attending', note: null },
  { id: 'b', name: 'Ashley', answer: 'attending', note: null },
  { id: 'busy', name: 'Meşgul', answer: 'attending', note: null },
  { id: 'free', name: 'Serbest', answer: 'attending', note: null },
];
const boatName = (id: string) => (id === 'mavi' ? 'Mavi' : 'C4X');

function show(mode: 'crew' | 'cox', own: Partial<SessionDraft> = {}) {
  const target = session({ crew: ['a', 'b'], ...own });
  const draft: ProgramDraft = {
    trainingNotes: '',
    sessions: [target, { id: 1, boatId: 'mavi', start: '09:00', end: '10:00', crew: ['busy', 'x'], cox: null }],
  };
  const onToggle = vi.fn();
  render(<CrewPickerDialog target={{ session: target, boat: c4x, position: 2 }} draft={draft} roster={roster} boatName={boatName} mode={mode} coach={{ id: 'coach', name: 'Ayşe Antrenör' }} onToggle={onToggle} onClose={vi.fn()} />);
  return { onToggle };
}
// the accessible name also carries the reason a row is disabled, so match on its beginning
const option = (name: string) => screen.getByRole('checkbox', { name: new RegExp('^' + name.replace(/[()]/g, '.')), hidden: true });

describe('CrewPickerDialog confirm button', () => {
  const done = (name: RegExp | string) => screen.getByRole('button', { name, hidden: true });

  it('says how many rowers are picked so far, and just "Tamam" while nobody is', () => {
    show('crew');
    expect(done(tr.program.pickerDoneCount(2))).toBeInTheDocument(); // the C4X fixture already has two rowers
    cleanup();
    show('crew', { crew: [] });
    expect(done(tr.program.pickerDone)).toBeInTheDocument();
  });

  it('counts the dümenci as one while choosing the dümenci', () => {
    show('cox', { cox: 'coach' });
    expect(done(tr.program.pickerDoneCount(1))).toBeInTheDocument();
    cleanup();
    show('cox');
    expect(done(tr.program.pickerDone)).toBeInTheDocument();
  });
});

describe('CrewPickerDialog choosing the dümenci', () => {
  it('offers the coach themselves first ("Kendim"), then the members, and says what it is for', () => {
    show('cox');
    expect(screen.getByText(tr.program.coxPickerTitle)).toBeInTheDocument();
    expect(screen.getByText(tr.program.coxPickerHint)).toBeInTheDocument();
    expect(option(tr.program.coxMyself)).toBeInTheDocument();
    expect(option('Serbest')).toBeInTheDocument();
    expect(screen.queryByText('2/4')).not.toBeInTheDocument(); // no rower count while choosing the dümenci
  });

  it('chooses the coach (or a member) as the dümenci', () => {
    const { onToggle } = show('cox');
    fireEvent.click(option(tr.program.coxMyself));
    expect(onToggle).toHaveBeenCalledWith('coach');
    fireEvent.click(option('Serbest'));
    expect(onToggle).toHaveBeenCalledWith('free');
  });

  it('does not offer a rower of this very session, nor somebody who is in another boat at that time', () => {
    const { onToggle } = show('cox');
    expect(option('Alex')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByText(tr.program.coxIsRower)).toHaveLength(2);
    expect(option('Meşgul')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(tr.program.inOtherBoat('Mavi', '09:00–10:00'))).toBeInTheDocument();
    fireEvent.click(option('Alex'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('marks the current dümenci as chosen', () => {
    show('cox', { cox: 'coach' });
    expect(option(tr.program.coxMyself)).toHaveAttribute('aria-checked', 'true');
  });
});

describe('CrewPickerDialog choosing the rowers', () => {
  it('does not offer "Kendim" and shows the rower count; the dümenci cannot also be picked as a rower', () => {
    show('crew', { crew: ['a', 'b'], cox: 'free' });
    expect(screen.queryByRole('checkbox', { name: /^Kendim/, hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText('2/4')).toBeInTheDocument();
    expect(option('Serbest')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(tr.program.coxIsCox)).toBeInTheDocument();
  });

  it('still lets anybody free be added as a rower', () => {
    const { onToggle } = show('crew');
    fireEvent.click(option('Serbest'));
    expect(onToggle).toHaveBeenCalledWith('free');
  });
});
