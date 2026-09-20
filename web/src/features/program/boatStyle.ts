/**
 * One accent per boat, taken from the club's boat order. Full class names so Tailwind can see them.
 *  - border / header / text: the boat's block in the program (colour, tinted heading, coloured text)
 *  - soft:    a light tint of the colour (the reader's own session row / card)
 *  - solid:   the colour itself with text that reads on it in both themes (the reader's own name chip, the "your boat" tag)
 *  - outline: a soft edge in the colour
 */
export const BOAT_STYLES = [
  {
    border: 'border-boat-1',
    header: 'bg-boat-1-soft text-boat-1',
    text: 'text-boat-1',
    soft: 'bg-boat-1-soft',
    solid: 'bg-boat-1 text-surface',
    outline: 'border-boat-1/40',
  },
  {
    border: 'border-boat-2',
    header: 'bg-boat-2-soft text-boat-2',
    text: 'text-boat-2',
    soft: 'bg-boat-2-soft',
    solid: 'bg-boat-2 text-surface',
    outline: 'border-boat-2/40',
  },
  {
    border: 'border-boat-3',
    header: 'bg-boat-3-soft text-boat-3',
    text: 'text-boat-3',
    soft: 'bg-boat-3-soft',
    solid: 'bg-boat-3 text-surface',
    outline: 'border-boat-3/40',
  },
  {
    border: 'border-boat-4',
    header: 'bg-boat-4-soft text-boat-4',
    text: 'text-boat-4',
    soft: 'bg-boat-4-soft',
    solid: 'bg-boat-4 text-surface',
    outline: 'border-boat-4/40',
  },
  {
    border: 'border-boat-5',
    header: 'bg-boat-5-soft text-boat-5',
    text: 'text-boat-5',
    soft: 'bg-boat-5-soft',
    solid: 'bg-boat-5 text-surface',
    outline: 'border-boat-5/40',
  },
  {
    border: 'border-boat-6',
    header: 'bg-boat-6-soft text-boat-6',
    text: 'text-boat-6',
    soft: 'bg-boat-6-soft',
    solid: 'bg-boat-6 text-surface',
    outline: 'border-boat-6/40',
  },
] as const;

export type BoatStyle = (typeof BOAT_STYLES)[number];

export const boatStyle = (position: number) => BOAT_STYLES[position % BOAT_STYLES.length] as BoatStyle;

/** Position of each boat in the club's order (sort order, then name) — the index its accent colour comes from. */
export function boatPositions(boats: ReadonlyArray<{ id: string; name: string; sort_order: number }>): Map<string, number> {
  const ordered = [...boats].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'tr'));
  return new Map(ordered.map((b, i) => [b.id, i]));
}
