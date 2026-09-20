import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { tr } from '@/strings/tr';
import type { Boat } from '@/types/database';
import { SlotBoatCard } from './SlotBoatCard';

const boat = (over: Partial<Boat> = {}): Boat => ({ id: 'mavi', name: 'Mavi', capacity: 2, is_active: true, sort_order: 1, requires_full_crew: false, created_at: '', updated_at: '', ...over }) as Boat;
const nameOf = (id: string) => ({ a: 'Alex', b: 'Ashley' })[id as 'a' | 'b'] ?? '?';

const show = (props: Partial<Parameters<typeof SlotBoatCard>[0]> = {}) => {
  const handlers = { onEdit: vi.fn(), onRemove: vi.fn(), onNotes: vi.fn() };
  render(<SlotBoatCard boat={boat()} position={0} time="09:00" crew={[]} notes="" nameOf={nameOf} {...handlers} {...props} />);
  return handlers;
};

describe('SlotBoatCard (one boat in the hour being edited)', () => {
  it('shows the boat in its colour with the hour it is being edited for, on the card itself', () => {
    show({ position: 1 });
    const card = screen.getByRole('group', { name: 'Mavi' }); // the accessible name stays the plain boat name
    expect(card.className).toContain('border-boat-2');
    expect(within(card).getByRole('heading', { name: 'Mavi' }).parentElement?.className).toContain('text-boat-2');
    expect(within(card).getByText('09:00')).toBeInTheDocument();
    expect(within(card).getByText('0/2')).toBeInTheDocument();
  });

  it('offers "Ekip seç" for an empty boat', () => {
    const { onEdit } = show();
    fireEvent.click(screen.getByRole('button', { name: tr.program.pickCrew }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('lists the crew with a remove button per person, the count, and "Ekibi düzenle"', () => {
    const { onRemove } = show({ crew: ['a', 'b'] });
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tr.program.editCrew })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: tr.program.removeFromBoat('Ashley') }));
    expect(onRemove).toHaveBeenCalledWith('b');
  });

  it('flags an incomplete crew on a boat that needs a full one', () => {
    show({ boat: boat({ id: 'c4x', name: 'C4X', capacity: 4, requires_full_crew: true }), crew: ['a'] });
    expect(screen.getByText(tr.program.fullCrewBadge(4)).className).toContain('text-warning');
    expect(screen.getByText('1/4')).toBeInTheDocument();
  });
});
