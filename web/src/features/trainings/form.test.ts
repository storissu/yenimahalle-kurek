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
  slotCount: 2,
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

  it('only allows 1–6 sessions', () => {
    expect(errorsOf(create, { ...valid, slotCount: 0 })).not.toEqual([]);
    expect(errorsOf(create, { ...valid, slotCount: 7 })).not.toEqual([]);
    expect(errorsOf(create, { ...valid, slotCount: Number.NaN })).not.toEqual([]);
    expect(errorsOf(create, { ...valid, slotCount: 6 })).toEqual([]);
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
      slot_count: 2,
      rsvp_deadline: '2026-09-18T17:00:00.000Z',
      notes: null,
    });
  });

  it('turns an empty title into null', () => {
    expect(toPayload({ ...valid, title: '' }).title).toBeNull();
  });
});

describe('fromTraining', () => {
  const row = { title: null, notes: 'Not', starts_at: '2026-09-19T05:00:00Z', slot_count: 3, rsvp_deadline: '2026-09-18T17:00:00Z' };

  it('reads wall-clock values back and recognises a preset deadline', () => {
    expect(fromTraining(row)).toMatchObject({ title: '', date: '2026-09-19', time: '08:00', slotCount: 3, deadlinePreset: '12', notes: 'Not' });
  });

  it('falls back to a custom deadline when it is not an exact preset', () => {
    expect(fromTraining({ ...row, rsvp_deadline: '2026-09-18T18:30:00Z' })).toMatchObject({
      deadlinePreset: 'custom',
      deadlineDate: '2026-09-18',
      deadlineTime: '21:30',
    });
  });

  it('round-trips through toPayload', () => {
    const values = fromTraining(row);
    expect(toPayload(values)).toMatchObject({ starts_at: '2026-09-19T05:00:00.000Z', rsvp_deadline: '2026-09-18T17:00:00.000Z', slot_count: 3 });
  });
});

describe('defaultValues', () => {
  it('proposes tomorrow 08:00 with the club default deadline', () => {
    expect(defaultValues(12, NOW)).toMatchObject({ date: '2026-09-19', time: '08:00', slotCount: 1, deadlinePreset: '12' });
    expect(defaultValues(24, NOW).deadlinePreset).toBe('24');
    expect(defaultValues(5, NOW).deadlinePreset).toBe('12'); // not a preset → sensible fallback
  });
});
