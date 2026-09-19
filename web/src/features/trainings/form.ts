// Form model for creating/editing a training: validation rules and conversion between the form's
// Istanbul wall-clock inputs and the UTC instants stored in the database.
// The number of sessions is NOT part of the form: the coach adds sessions while preparing the program,
// and the database derives the training's length from it.
import { z } from 'zod';
import { HOUR_MS, instantToWallTime, previousCalendarDay, todayInClubZone, wallTimeToInstant } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { RsvpDeadlineRule } from '@/types/database';
import type { TrainingLike } from './schedule';

export const DEADLINE_PRESET_HOURS = [12, 24, 48] as const;
/** "The evening before, at 20:00" — the previous calendar day (club time) at this hour. */
export const EVENING_BEFORE_TIME = '20:00';
export type DeadlinePreset = `${(typeof DEADLINE_PRESET_HOURS)[number]}` | 'evening' | 'custom';

export interface TrainingFormValues {
  title: string;
  date: string; // YYYY-MM-DD, club wall time
  time: string; // HH:mm, club wall time
  deadlinePreset: DeadlinePreset;
  deadlineDate: string; // used when preset = custom
  deadlineTime: string;
  notes: string;
}

export interface TrainingPayload {
  title: string | null;
  starts_at: string;
  rsvp_deadline: string;
  /** How the deadline was chosen, so reopening the form shows the same choice. */
  rsvp_deadline_rule: RsvpDeadlineRule;
  notes: string | null;
}

/** The RSVP deadline instant the form currently describes (Invalid Date if incomplete). */
export function computeDeadline(values: Pick<TrainingFormValues, 'date' | 'time' | 'deadlinePreset' | 'deadlineDate' | 'deadlineTime'>): Date {
  if (values.deadlinePreset === 'custom') return wallTimeToInstant(values.deadlineDate, values.deadlineTime);
  if (values.deadlinePreset === 'evening') return wallTimeToInstant(previousCalendarDay(values.date), EVENING_BEFORE_TIME);
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
      deadlinePreset: z.enum(['12', '24', '48', 'evening', 'custom']),
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
    rsvp_deadline: computeDeadline(values).toISOString(),
    rsvp_deadline_rule: values.deadlinePreset,
    notes: values.notes.trim() || null,
  };
}

/** Defaults for a new training: tomorrow 08:00, deadline = club default lead time. */
export function defaultValues(defaultLeadHours: number, now: Date = new Date()): TrainingFormValues {
  const preset = DEADLINE_PRESET_HOURS.find((h) => h === defaultLeadHours);
  return {
    title: '',
    date: todayInClubZone(new Date(now.getTime() + 24 * HOUR_MS)),
    time: '08:00',
    deadlinePreset: preset ? (`${preset}` as DeadlinePreset) : '12',
    deadlineDate: '',
    deadlineTime: EVENING_BEFORE_TIME,
    notes: '',
  };
}

/**
 * Reads a saved training back into the form. The coach's remembered choice (`rsvp_deadline_rule`) is shown as long
 * as it still describes exactly the stored deadline — for an 08:00 training "12 saat önce" and "Bir önceki akşam
 * 20:00" are the same instant, and editing the start time must keep the rule the coach picked. Without a usable
 * memory (older trainings) the deadline is recognised: N hours before the start, else the evening before at 20:00,
 * else a custom time.
 */
export function fromTraining(
  t: Pick<TrainingLike, 'starts_at' | 'rsvp_deadline'> & { title: string | null; notes: string | null; rsvp_deadline_rule?: RsvpDeadlineRule | null },
): TrainingFormValues {
  const start = instantToWallTime(t.starts_at);
  const deadline = instantToWallTime(t.rsvp_deadline);
  const leadHours = (new Date(t.starts_at).getTime() - new Date(t.rsvp_deadline).getTime()) / HOUR_MS;
  const hoursPreset = DEADLINE_PRESET_HOURS.find((h) => h === leadHours);
  const eveningBefore = deadline.date === previousCalendarDay(start.date) && deadline.time === EVENING_BEFORE_TIME;
  const detected: DeadlinePreset = hoursPreset ? (`${hoursPreset}` as DeadlinePreset) : eveningBefore ? 'evening' : 'custom';

  const remembered = t.rsvp_deadline_rule ?? null;
  const rememberedStillFits =
    remembered !== null &&
    remembered !== 'custom' &&
    computeDeadline({ date: start.date, time: start.time, deadlinePreset: remembered, deadlineDate: '', deadlineTime: '' }).getTime() === new Date(t.rsvp_deadline).getTime();

  return {
    title: t.title ?? '',
    date: start.date,
    time: start.time,
    deadlinePreset: rememberedStillFits && remembered ? remembered : detected,
    deadlineDate: deadline.date,
    deadlineTime: deadline.time,
    notes: t.notes ?? '',
  };
}
