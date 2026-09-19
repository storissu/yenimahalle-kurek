// Form model for creating/editing a training: validation rules and conversion between the form's
// Istanbul wall-clock inputs and the UTC instants stored in the database.
import { z } from 'zod';
import { HOUR_MS, instantToWallTime, todayInClubZone, wallTimeToInstant } from '@/lib/time';
import { tr } from '@/strings/tr';
import { MAX_SLOTS, type TrainingLike } from './schedule';

export const DEADLINE_PRESET_HOURS = [12, 24, 48] as const;
export type DeadlinePreset = `${(typeof DEADLINE_PRESET_HOURS)[number]}` | 'custom';

export interface TrainingFormValues {
  title: string;
  date: string; // YYYY-MM-DD, club wall time
  time: string; // HH:mm, club wall time
  slotCount: number;
  deadlinePreset: DeadlinePreset;
  deadlineDate: string; // used when preset = custom
  deadlineTime: string;
  notes: string;
}

export interface TrainingPayload {
  title: string | null;
  starts_at: string;
  slot_count: number;
  rsvp_deadline: string;
  notes: string | null;
}

/** The RSVP deadline instant the form currently describes (Invalid Date if incomplete). */
export function computeDeadline(values: Pick<TrainingFormValues, 'date' | 'time' | 'deadlinePreset' | 'deadlineDate' | 'deadlineTime'>): Date {
  if (values.deadlinePreset === 'custom') return wallTimeToInstant(values.deadlineDate, values.deadlineTime);
  const start = wallTimeToInstant(values.date, values.time);
  return new Date(start.getTime() - Number(values.deadlinePreset) * HOUR_MS);
}

/**
 * `create` mode also forbids a start or deadline in the past. `edit` allows them so a coach can still
 * fix a typo in the notes of a training that is already running or whose deadline has passed.
 */
export function makeTrainingSchema(mode: 'create' | 'edit', now: () => Date = () => new Date()) {
  return z
    .object({
      title: z.string().max(80, tr.trainings.form.titleTooLong),
      date: z.string().min(1, tr.trainings.form.dateRequired),
      time: z.string().min(1, tr.trainings.form.timeRequired),
      slotCount: z.number({ message: tr.trainings.form.sessionsRequired }).int().min(1, tr.trainings.form.sessionsRequired).max(MAX_SLOTS, tr.trainings.form.sessionsRequired),
      deadlinePreset: z.enum(['12', '24', '48', 'custom']),
      deadlineDate: z.string(),
      deadlineTime: z.string(),
      notes: z.string().max(500, tr.trainings.form.notesTooLong),
    })
    .superRefine((v, ctx) => {
      const start = wallTimeToInstant(v.date, v.time);
      if (Number.isNaN(start.getTime())) {
        if (v.date && v.time) ctx.addIssue({ code: 'custom', path: ['date'], message: tr.trainings.form.dateInvalid });
        return; // the required-field errors above already explain the rest
      }
      if (mode === 'create' && start <= now()) {
        ctx.addIssue({ code: 'custom', path: ['time'], message: tr.trainings.form.startInPast });
      }

      const deadlinePath = v.deadlinePreset === 'custom' ? 'deadlineDate' : 'deadlinePreset';
      const deadline = computeDeadline(v);
      if (Number.isNaN(deadline.getTime())) {
        ctx.addIssue({ code: 'custom', path: ['deadlineDate'], message: tr.trainings.form.deadlineRequired });
        return;
      }
      if (deadline > start) {
        ctx.addIssue({ code: 'custom', path: [deadlinePath], message: tr.trainings.form.deadlineAfterStart });
      } else if (mode === 'create' && deadline <= now()) {
        ctx.addIssue({ code: 'custom', path: [deadlinePath], message: tr.trainings.form.deadlineInPast });
      }
    });
}

export function toPayload(values: TrainingFormValues): TrainingPayload {
  return {
    title: values.title.trim() || null,
    starts_at: wallTimeToInstant(values.date, values.time).toISOString(),
    slot_count: values.slotCount,
    rsvp_deadline: computeDeadline(values).toISOString(),
    notes: values.notes.trim() || null,
  };
}

/** Defaults for a new training: tomorrow 08:00, one session, deadline = club default lead time. */
export function defaultValues(defaultLeadHours: number, now: Date = new Date()): TrainingFormValues {
  const preset = DEADLINE_PRESET_HOURS.find((h) => h === defaultLeadHours);
  return {
    title: '',
    date: todayInClubZone(new Date(now.getTime() + 24 * HOUR_MS)),
    time: '08:00',
    slotCount: 1,
    deadlinePreset: preset ? (`${preset}` as DeadlinePreset) : '12',
    deadlineDate: '',
    deadlineTime: '20:00',
    notes: '',
  };
}

export function fromTraining(t: Pick<TrainingLike, 'starts_at' | 'slot_count' | 'rsvp_deadline'> & { title: string | null; notes: string | null }): TrainingFormValues {
  const start = instantToWallTime(t.starts_at);
  const deadline = instantToWallTime(t.rsvp_deadline);
  const leadHours = (new Date(t.starts_at).getTime() - new Date(t.rsvp_deadline).getTime()) / HOUR_MS;
  const preset = DEADLINE_PRESET_HOURS.find((h) => h === leadHours);
  return {
    title: t.title ?? '',
    date: start.date,
    time: start.time,
    slotCount: t.slot_count,
    deadlinePreset: preset ? (`${preset}` as DeadlinePreset) : 'custom',
    deadlineDate: deadline.date,
    deadlineTime: deadline.time,
    notes: t.notes ?? '',
  };
}
