import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramData } from './model';
import { summarizeProgram } from './view';

const state: { data: ProgramData | undefined } = { data: undefined };
vi.mock('./hooks', () => ({ useProgram: () => ({ isPending: state.data === undefined, data: state.data }) }));

import { PublishedProgramCard } from './PublishedProgramCard';

// 08:00 Istanbul, two sessions
const training = { id: 't1', starts_at: '2026-09-23T05:00:00Z', slot_count: 2 };
const data: ProgramData = {
  program: null,
  assignments: [
    { id: 'a1', training_id: 't1', slot_index: 0, boat_id: 'mavi', notes: null },
    { id: 'a2', training_id: 't1', slot_index: 1, boat_id: 'mavi', notes: null },
    { id: 'a3', training_id: 't1', slot_index: 0, boat_id: 'turuncu', notes: null },
    { id: 'a4', training_id: 't1', slot_index: 1, boat_id: 'c4x', notes: null }, // no crew: not counted
  ],
  crew: [
    { assignment_id: 'a1', training_id: 't1', slot_index: 0, member_id: 'alex', seat: 1 },
    { assignment_id: 'a1', training_id: 't1', slot_index: 0, member_id: 'ashley', seat: 2 },
    { assignment_id: 'a2', training_id: 't1', slot_index: 1, member_id: 'alex', seat: 1 }, // rows twice: one person
    { assignment_id: 'a3', training_id: 't1', slot_index: 0, member_id: 'ali', seat: 1 },
  ],
};

beforeEach(() => {
  state.data = undefined;
});

describe('summarizeProgram', () => {
  it('counts boats that carry a crew and distinct people', () => {
    expect(summarizeProgram(data)).toEqual({ boats: 2, people: 3 });
    expect(summarizeProgram({ program: null, assignments: [], crew: [] })).toEqual({ boats: 0, people: 0 });
  });
});

describe('PublishedProgramCard (coach dashboard)', () => {
  const show = () =>
    render(
      <MemoryRouter>
        <PublishedProgramCard training={training} />
      </MemoryRouter>,
    );

  it('is one link to the training\'s Program tab with the date, time range, that it is live, and the size', () => {
    state.data = data;
    show();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/antrenor/antrenmanlar/t1?sekme=program');
    expect(link).toHaveTextContent('08:00–10:00');
    expect(link).toHaveTextContent('Yayında');
    expect(link).toHaveTextContent('2 seans · 2 tekne · 3 kişi');
  });

  it('still shows the date and time while the program is loading (no counts yet)', () => {
    show();
    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('08:00–10:00');
    expect(link).toHaveTextContent('2 seans');
    expect(link).not.toHaveTextContent('tekne');
  });
});
