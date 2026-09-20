import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { tr } from '@/strings/tr';
import type { Training, TrainingResponse } from '@/types/database';
import { RsvpCard } from './RsvpCard';

// Friday 18 Sep 2026, 12:00 Istanbul. The training is the next morning; the RSVP deadline is 20:00 the same evening.
const NOW = new Date('2026-09-18T09:00:00Z');
const training: Training = {
  id: 't1',
  title: null,
  starts_at: '2026-09-19T05:00:00Z',
  slot_count: 2,
  ends_at: null,
  rsvp_deadline: '2026-09-18T17:00:00Z',
  rsvp_deadline_rule: '12',
  status: 'scheduled',
  cancel_reason: null,
  notes: null,
  deadline_reminder_sent_at: null,
  deadline_summary_sent_at: null,
  created_by: 'c1',
  created_at: '',
  updated_at: '',
};
const answer: TrainingResponse = { training_id: 't1', member_id: 'm1', response: 'attending', note: 'Dokuzdan sonra olur mu?', responded_at: '', set_by_coach: false };

const show = (props: Partial<Parameters<typeof RsvpCard>[0]> = {}) =>
  render(<RsvpCard training={training} answer={answer} now={NOW} onSubmit={vi.fn()} pending={false} error={null} {...props} />);

describe('RsvpCard', () => {
  it('is open before the deadline while the program is not published', () => {
    show();
    expect(screen.getByRole('radio', { name: tr.rsvp.attending })).toBeEnabled();
    expect(screen.getByRole('radio', { name: tr.rsvp.notAttending })).toBeEnabled();
    expect(screen.getByLabelText(new RegExp(tr.rsvp.noteLabel))).toBeInTheDocument();
  });

  it('locks as soon as the program is published, although the deadline is hours away', () => {
    show({ programPublished: true });
    expect(screen.getByRole('heading', { name: tr.rsvp.lockedProgramTitle })).toBeInTheDocument();
    expect(screen.getByText(tr.rsvp.lockedProgramBody)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument(); // no way to change the answer
    expect(screen.queryByLabelText(new RegExp(tr.rsvp.noteLabel))).not.toBeInTheDocument();
  });

  it('still shows the answer and the note it was locked with', () => {
    show({ programPublished: true });
    expect(screen.getByText(tr.rsvp.yourAnswer(tr.rsvp.attending))).toBeInTheDocument();
    expect(screen.getByText('Dokuzdan sonra olur mu?')).toBeInTheDocument();
  });

  it('says the member did not answer when they never did', () => {
    show({ programPublished: true, answer: undefined });
    expect(screen.getByText(tr.rsvp.lockedNoAnswer)).toBeInTheDocument();
  });

  it('after the deadline it keeps the deadline wording, published program or not', () => {
    const late = new Date('2026-09-18T18:00:00Z');
    show({ now: late, programPublished: true });
    expect(screen.getByRole('heading', { name: tr.rsvp.lockedTitle })).toBeInTheDocument();
    expect(screen.getByText(tr.rsvp.lockedBody)).toBeInTheDocument();
  });

  it('a cancelled training shows the cancellation, not the lock', () => {
    show({ training: { ...training, status: 'cancelled', cancel_reason: 'Fırtına' }, programPublished: true });
    expect(screen.getByRole('heading', { name: tr.rsvp.cancelledTitle })).toBeInTheDocument();
  });
});
