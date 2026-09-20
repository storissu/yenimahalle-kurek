/** One accent per boat, taken from the club's boat order. Full class names so Tailwind can see them. */
export const BOAT_STYLES = [
  { border: 'border-boat-1', header: 'bg-boat-1-soft text-boat-1', text: 'text-boat-1' },
  { border: 'border-boat-2', header: 'bg-boat-2-soft text-boat-2', text: 'text-boat-2' },
  { border: 'border-boat-3', header: 'bg-boat-3-soft text-boat-3', text: 'text-boat-3' },
  { border: 'border-boat-4', header: 'bg-boat-4-soft text-boat-4', text: 'text-boat-4' },
  { border: 'border-boat-5', header: 'bg-boat-5-soft text-boat-5', text: 'text-boat-5' },
  { border: 'border-boat-6', header: 'bg-boat-6-soft text-boat-6', text: 'text-boat-6' },
] as const;

export const boatStyle = (position: number) => BOAT_STYLES[position % BOAT_STYLES.length] as (typeof BOAT_STYLES)[number];

/** Position of each boat in the club's order (sort order, then name) — the index its accent colour comes from. */
export function boatPositions(boats: ReadonlyArray<{ id: string; name: string; sort_order: number }>): Map<string, number> {
  const ordered = [...boats].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'tr'));
  return new Map(ordered.map((b, i) => [b.id, i]));
}
