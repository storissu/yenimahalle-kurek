import { describe, expect, it } from 'vitest';
import { BOAT_STYLES, boatPositions, boatStyle } from './boatStyle';

describe('boatPositions', () => {
  it("numbers boats in the club's order (sort order, then name), whatever order they arrive in", () => {
    const boats = [
      { id: 'c4x', name: 'C4X', sort_order: 3 },
      { id: 'turuncu', name: 'Turuncu', sort_order: 2 },
      { id: 'mavi', name: 'Mavi', sort_order: 1 },
      { id: 'ay', name: 'Ay', sort_order: 3 },
    ];
    const positions = boatPositions(boats);
    expect([...positions].sort((a, b) => a[1] - b[1]).map(([id]) => id)).toEqual(['mavi', 'turuncu', 'ay', 'c4x']);
  });
});

describe('boatStyle', () => {
  it('gives each boat its accent and wraps around after the last one', () => {
    expect(boatStyle(0).border).toBe('border-boat-1');
    expect(boatStyle(1).text).toBe('text-boat-2');
    expect(boatStyle(BOAT_STYLES.length).border).toBe('border-boat-1');
  });
});
