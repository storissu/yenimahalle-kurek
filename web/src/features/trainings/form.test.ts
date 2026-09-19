import { describe, expect, it } from 'vitest';
import { tr } from '@/strings/tr';
import { computeDeadline, defaultValues, fromTraining, makeTrainingSchema, toPayload, type TrainingFormValues } from './form';

// "Now" is Friday 18 Sep 2026, 12:00 in Istanbul (09:00Z).
const NOW = new Date('2026-09-18T09:00:00Z');
const create = makeTrainingSchema('create', () => NOW);
const edit = makeTrainingSchema('edit', () => NOW);

const valid: TrainingFormValues = {
  title: 'Sabah antrenmanı',
  date: '2026-09-19',
  time: '08:00',
  deadlinePreset: '12',
  deadlineDate: '',
  deadlineTime: '20:00',
  notes: '',
};

const errorsOf = (schema: typeof create, values: TrainingFormValues) => {
  const result = schema.safeParse(values);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('training form validation', () => {
  it('accepts a normal future training', () => {
    expect(errorsOf(create, valid)).toEqual([]);
  });

  it('requires date and time', () => {
    expect(errorsOf(create, { ...valid, date: '' })).toContain(`date: ${tr.trainings.form.dateRequired}`);
    expect(errorsOf(create, { ...valid, time: '' })).toContain(`time: ${tr.trainings.form.timeRequired}`);
  });

  it('rejects an impossible date', () => {
    expect(errorsOf(create, { ...valid, date: '2026-02-31' })).toContain(`date: ${tr.trainings.form.dateInvalid}`);
  });

  it('does not ask for a number of sessions (the program decides how long the training is)', () => {
    expect(Object.keys(valid)).not.toContain('slotCount');
    expect(Object.keys(toPayload(valid))).not.toContain('slot_count');
  });

  it('limits title and notes length', () => {
    expect(errorsOf(create, { ...valid, title: 'x'.repeat(81) })).toContain(`title: ${tr.trainings.form.titleTooLong}`);
    expect(errorsOf(create, { ...valid, notes: 'x'.repeat(501) })).toContain(`notes: ${tr.trainings.form.notesTooLong}`);
  });

  describe('start in the past', () => {
    const past = { ...valid, date: '2026-09-18', time: '08:00', deadlinePreset: 'custom' as const, deadlineDate: '2026-09-18', deadlineTime: '07:00' };
    it('is rejected when creating', () => {
      expect(errorsOf(create, past)).toContain(`time: ${tr.trainings.form.startInPast}`);
    });
    it('is allowed when editing (fixing a note on a running training)', () => {
      expect(errorsOf(edit, past)).toEqual([]);
    });
  });

  describe('deadline', () => {
    it('presets are computed backwards from the start', () => {
      expect(computeDeadline(valid).toISOString()).toBe('2026-09-18T17:00:00.000Z'); // 20:00 on the 18th
      expect(computeDeadline({ ...valid, deadlinePreset: '24' }).toISOString()).toBe('2026-09-18T05:00:00.000Z');
      expect(computeDeadline({ ...valid, deadlinePreset: '48' }).toISOString()).toBe('2026-09-17T05:00:00.000Z');
    });

    describe('"the evening before at 20:00"', () => {
      it('is 20:00 club time on the previous calendar day, whatever the start time', () => {
        // Tuesday 08:00 → Monday 20:00
        expect(computeDeadline({ ...valid, date: '2026-09-22', deadlinePreset: 'evening' }).toISOString()).toBe('2026-09-21T17:00:00.000Z');
        // a late-morning training gets the same evening, not "N hours before"
        expect(computeDeadline({ ...valid, date: '2026-09-22', time: '11:30', deadlinePreset: 'evening' }).toISOString()).toBe('2026-09-21T17:00:00.000Z');
      });

      it('crosses month and year boundaries', () => {
        expect(computeDeadline({ ...valid, date: '2026-10-01', deadlinePreset: 'evening' }).toISOString()).toBe('2026-09-30T17:00:00.000Z');
        expect(computeDeadline({ ...valid, date: '2027-01-01', deadlinePreset: 'evening' }).toISOString()).toBe('2026-12-31T17:00:00.000Z');
        expect(computeDeadline({ ...valid, date: '2028-03-01', deadlinePreset: 'evening' }).toISOString()).toBe('2028-02-29T17:00:00.000Z'); // leap year
      });

      it('is accepted when creating, unless that evening has already passed', () => {
        expect(errorsOf(create, { ...valid, date: '2026-09-22', deadlinePreset: 'evening' })).toEqual([]);
        // tomorrow (19th) 08:00: the evening before is today (18th) 20:00 — still ahead of "now" (12:00)
        expect(errorsOf(create, { ...valid, deadlinePreset: 'evening' })).toEqual([]);
        // a training today at 18:00 → yesterday's 20:00 is gone
        expect(errorsOf(create, { ...valid, date: '2026-09-18', time: '18:00', deadlinePreset: 'evening' })).toContain(`deadlinePreset: ${tr.trainings.form.deadlineInPast}`);
      });

      it('needs a real date', () => {
        expect(errorsOf(create, { ...valid, date: '', deadlinePreset: 'evening' }).join()).toContain(tr.trainings.form.dateRequired);
      });
    });

    it('a preset that would already have passed is rejected when creating', () => {
      // 08:00 tomorrow − 24 h = 08:00 today, which is before "now" (12:00)
      expect(errorsOf(create, { ...valid, deadlinePreset: '24' })).toContain(`deadlinePreset: ${tr.trainings.form.deadlineInPast}`);
    });

    it('a custom deadline must be filled in', () => {
      expect(errorsOf(create, { ...valid, deadlinePreset: 'custom', deadlineDate: '' })).toContain(`deadlineDate: ${tr.trainings.form.deadlineRequired}`);
    });

    it('a custom deadline may not be after the start', () => {
      const late = { ...valid, deadlinePreset: 'custom' as const, deadlineDate: '2026-09-19', deadlineTime: '08:30' };
      expect(errorsOf(create, late)).toContain(`deadlineDate: ${tr.trainings.form.deadlineAfterStart}`);
    });

    it('a custom deadline exactly at the start is fine', () => {
      const atStart = { ...valid, deadlinePreset: 'custom' as const, deadlineDate: '2026-09-19', deadlineTime: '08:00' };
      expect(errorsOf(create, atStart)).toEqual([]);
    });

    it('a past custom deadline is allowed when editing (coach closes RSVP early)', () => {
      const closed = { ...valid, deadlinePreset: 'custom' as const, deadlineDate: '2026-09-10', deadlineTime: '10:00' };
      expect(errorsOf(create, closed)).toContain(`deadlineDate: ${tr.trainings.form.deadlineInPast}`);
      expect(errorsOf(edit, closed)).toEqual([]);
    });
  });
});

describe('toPayload', () => {
  it('converts club wall time to UTC instants and trims text', () => {
    expect(toPayload({ ...valid, title: '  Sabah  ', notes: '  ' })).toEqual({
      title: 'Sabah',
      starts_at: '2026-09-19T05:00:00.000Z',
      rsvp_deadline: '2026-09-18T17:00:00.000Z',
      rsvp_deadline_rule: '12',
      notes: null,
    });
  });

  it('turns an empty title into null', () => {
    expect(toPayload({ ...valid, title: '' }).title).toBeNull();
  });
});

describe('fromTraining', () => {
  const row = { title: null, notes: 'Not', starts_at: '2026-09-19T05:00:00Z', rsvp_deadline: '2026-09-18T17:00:00Z' };

  it('reads wall-clock values back and recognises a preset deadline', () => {
    expect(fromTraining(row)).toMatchObject({ title: '', date: '2026-09-19', time: '08:00', deadlinePreset: '12', notes: 'Not' });
  });

  it('falls back to a custom deadline when it is not an exact preset', () => {
    expect(fromTraining({ ...row, rsvp_deadline: '2026-09-18T18:30:00Z' })).toMatchObject({
      deadlinePreset: 'custom',
      deadlineDate: '2026-09-18',
      deadlineTime: '21:30',
    });
  });

  it('recognises "the evening before at 20:00" when it is not an exact N-hours preset', () => {
    // 11:30 start, deadline the evening before at 20:00 (15.5 h earlier)
    const evening = { ...row, starts_at: '2026-09-19T08:30:00Z', rsvp_deadline: '2026-09-18T17:00:00Z' };
    expect(fromTraining(evening)).toMatchObject({ deadlinePreset: 'evening', date: '2026-09-19', time: '11:30' });
    expect(toPayload(fromTraining(evening)).rsvp_deadline).toBe('2026-09-18T17:00:00.000Z');
  });

  it('remembers how the coach chose the deadline: an 08:00 training with a 20:00 deadline reopens as the evening rule if that was chosen', () => {
    // 08:00 start, 20:00 the evening before is also exactly 12 h earlier: the stored rule decides which one is shown
    expect(fromTraining({ ...row, rsvp_deadline_rule: 'evening' }).deadlinePreset).toBe('evening');
    expect(fromTraining({ ...row, rsvp_deadline_rule: '12' }).deadlinePreset).toBe('12');
    expect(fromTraining({ ...row, rsvp_deadline_rule: null }).deadlinePreset).toBe('12'); // older training: recognised
    expect(toPayload({ ...valid, deadlinePreset: 'evening' }).rsvp_deadline_rule).toBe('evening');
  });

  it('ignores a remembered rule that no longer matches the stored deadline (edited some other way)', () => {
    expect(fromTraining({ ...row, rsvp_deadline: '2026-09-18T18:30:00Z', rsvp_deadline_rule: 'evening' }).deadlinePreset).toBe('custom');
    expect(fromTraining({ ...row, rsvp_deadline_rule: '24' }).deadlinePreset).toBe('12');
    expect(fromTraining({ ...row, rsvp_deadline_rule: 'custom' }).deadlinePreset).toBe('12'); // "custom" never overrides a recognisable preset
  });

  it('a remembered evening rule keeps its meaning when the start time moves (the 20:00 stays 20:00)', () => {
    const values = fromTraining({ ...row, rsvp_deadline_rule: 'evening' });
    expect(toPayload({ ...values, time: '09:00' }).rsvp_deadline).toBe('2026-09-18T17:00:00.000Z');
    const hours = fromTraining({ ...row, rsvp_deadline_rule: '12' });
    expect(toPayload({ ...hours, time: '09:00' }).rsvp_deadline).toBe('2026-09-18T18:00:00.000Z'); // 12 h before 09:00 = 21:00
  });

  it('does not mistake a different evening time for the preset', () => {
    expect(fromTraining({ ...row, starts_at: '2026-09-19T08:30:00Z', rsvp_deadline: '2026-09-18T18:00:00Z' }).deadlinePreset).toBe('custom');
    expect(fromTraining({ ...row, starts_at: '2026-09-19T08:30:00Z', rsvp_deadline: '2026-09-17T17:00:00Z' }).deadlinePreset).toBe('custom'); // two evenings before
  });

  it('round-trips through toPayload', () => {
    const values = fromTraining(row);
    expect(toPayload(values)).toMatchObject({ starts_at: '2026-09-19T05:00:00.000Z', rsvp_deadline: '2026-09-18T17:00:00.000Z' });
  });
});

describe('defaultValues', () => {
  it('proposes tomorrow 08:00 with the club default deadline', () => {
    expect(defaultValues(12, NOW)).toMatchObject({ date: '2026-09-19', time: '08:00', deadlinePreset: '12' });
    expect(defaultValues(24, NOW).deadlinePreset).toBe('24');
    expect(defaultValues(5, NOW).deadlinePreset).toBe('12'); // not a preset → sensible fallback
  });
});
