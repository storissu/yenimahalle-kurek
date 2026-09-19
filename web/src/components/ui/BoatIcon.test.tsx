import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BoatIcon, boatKind, seatPositions } from './BoatIcon';

describe('seatPositions', () => {
  it('puts one seat per rower, centred and evenly spread inside the hull', () => {
    expect(seatPositions(1)).toEqual([12]);
    expect(seatPositions(2)).toEqual([9.8, 14.2]);
    const four = seatPositions(4);
    expect(four).toHaveLength(4);
    expect(four.every((x, i) => i === 0 || x > (four[i - 1] as number))).toBe(true);
    expect((four[0] as number) + (four[3] as number)).toBeCloseTo(24, 5); // symmetric around the middle
  });

  it('never draws more than 8 seats, at least 1, and stays inside the hull for big crews', () => {
    expect(seatPositions(8)).toHaveLength(8);
    expect(seatPositions(20)).toHaveLength(8);
    expect(seatPositions(0)).toEqual([12]);
    for (const x of seatPositions(8)) expect(x).toBeGreaterThan(3);
    for (const x of seatPositions(8)) expect(x).toBeLessThan(21);
  });
});

describe('boatKind', () => {
  it('follows capacity, so a boat added later gets a sensible icon without a name lookup', () => {
    expect([1, 2, 3, 4, 8].map(boatKind)).toEqual(['single', 'double', 'crew', 'quad', 'crew']);
  });
});

describe('BoatIcon', () => {
  it('is decorative (hidden from screen readers) and shows one dot per seat', () => {
    const { container } = render(<BoatIcon capacity={4} />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('data-boat', 'quad');
    expect(svg.querySelectorAll('circle')).toHaveLength(4);
  });

  it('draws the double scull (Mavi, Turuncu) with two seats and the C4X with four', () => {
    expect(render(<BoatIcon capacity={2} />).container.querySelectorAll('circle')).toHaveLength(2);
    expect(render(<BoatIcon capacity={4} />).container.querySelectorAll('circle')).toHaveLength(4);
  });

  it('takes its colour from the surrounding text and accepts a size and class', () => {
    const { container } = render(<BoatIcon capacity={2} size={22} className="text-primary" />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('width', '22');
    expect(svg.getAttribute('class')).toContain('text-primary');
  });
});
