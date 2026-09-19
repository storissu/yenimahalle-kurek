import { cn } from '@/lib/cn';

/** Most seats drawn; boats with more still show this many (the number is only a visual cue, the name says the rest). */
const MAX_SEATS = 8;

/**
 * x-positions (in a 24-wide drawing) of the seats of an `n`-person boat, evenly spread along the hull:
 * 1 seat sits in the middle, 2 and 4 are spaced wide, more get closer together.
 */
export function seatPositions(capacity: number): number[] {
  const seats = Math.min(MAX_SEATS, Math.max(1, Math.round(capacity)));
  const step = seats === 1 ? 0 : Math.min(4.4, 15 / (seats - 1));
  return Array.from({ length: seats }, (_, i) => Math.round((12 + (i - (seats - 1) / 2) * step) * 10) / 10);
}

/** What kind of boat a capacity is, for the accessible description and tests. */
export const boatKind = (capacity: number): 'single' | 'double' | 'quad' | 'crew' =>
  capacity === 1 ? 'single' : capacity === 2 ? 'double' : capacity === 4 ? 'quad' : 'crew';

interface BoatIconProps {
  /** Number of rowers the boat takes: 1 = single scull, 2 = double, 4 = quad (C4X), other = that many seats. */
  capacity: number;
  size?: number;
  className?: string;
}

/**
 * A small rowing shell seen from above: a pointed hull with one dot per rower. Chosen by CAPACITY, not by name, so a
 * boat added later gets the right icon by itself. Decorative (`aria-hidden`): the boat's name is always written next to it.
 * Drawn like the other icons (24 px grid, 2 px round strokes, `currentColor`) so it sits quietly beside the name.
 */
export function BoatIcon({ capacity, size = 18, className }: BoatIconProps) {
  const seats = seatPositions(capacity);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-boat={boatKind(capacity)}
      data-seats={seats.length}
      className={cn('shrink-0', className)}
    >
      <path d="M1.5 12C5.5 8.6 18.5 8.6 22.5 12C18.5 15.4 5.5 15.4 1.5 12Z" />
      {seats.map((x) => (
        <circle key={x} cx={x} cy={12} r={seats.length > 4 ? 0.9 : 1.2} fill="currentColor" stroke="none" />
      ))}
    </svg>
  );
}
