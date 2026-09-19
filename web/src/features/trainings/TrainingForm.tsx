import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/TextAreaField';
import { TextField } from '@/components/ui/TextField';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatDayMonth, formatTime, todayInClubZone, wallTimeToInstant } from '@/lib/time';
import { tr } from '@/strings/tr';
import {
  computeDeadline,
  DEADLINE_PRESET_HOURS,
  makeTrainingSchema,
  toPayload,
  type DeadlinePreset,
  type TrainingFormValues,
  type TrainingPayload,
} from './form';

interface TrainingFormProps {
  mode: 'create' | 'edit';
  initial: TrainingFormValues;
  onSubmit: (payload: TrainingPayload) => Promise<void>;
  /** Error from the last save attempt (server side). */
  submitError: unknown;
}

/** Create/edit form. Date and time are club (Istanbul) wall-clock; conversion to UTC is done in `toPayload`. */
export function TrainingForm({ mode, initial, onSubmit, submitError }: TrainingFormProps) {
  const schema = useMemo(() => makeTrainingSchema(mode), [mode]);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<TrainingFormValues>({ resolver: zodResolver(schema), defaultValues: initial });

  const values = useWatch({ control }) as TrainingFormValues;
  const start = wallTimeToInstant(values.date, values.time);
  const deadline = computeDeadline(values);
  const previewValid = !Number.isNaN(start.getTime()) && !Number.isNaN(deadline.getTime());

  const presets: Array<{ id: DeadlinePreset; label: string }> = [
    ...DEADLINE_PRESET_HOURS.map((h) => ({ id: `${h}` as DeadlinePreset, label: tr.trainings.form.deadlinePreset(h) })),
    { id: 'evening', label: tr.trainings.form.deadlineEvening },
    { id: 'custom', label: tr.trainings.form.deadlineCustom },
  ];

  const submit = handleSubmit(async (v) => {
    try {
      await onSubmit(toPayload(v));
    } catch {
      /* shown through submitError */
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <TextField
        label={`${tr.trainings.form.titleLabel} (${tr.common.optional})`}
        hint={tr.trainings.form.titleHint}
        error={errors.title?.message}
        autoComplete="off"
        {...register('title')}
      />

      <div className="grid grid-cols-2 gap-3">
        <TextField
          label={tr.trainings.form.date}
          type="date"
          min={mode === 'create' ? todayInClubZone() : undefined}
          error={errors.date?.message}
          {...register('date')}
        />
        <TextField label={tr.trainings.form.startTime} type="time" step={300} error={errors.time?.message} {...register('time')} />
      </div>

      <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">{tr.trainings.form.sessionsInfo}</p>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">{tr.trainings.form.deadline}</legend>
        <div role="radiogroup" aria-label={tr.trainings.form.deadline} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {presets.map((p) => {
            const selected = values.deadlinePreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setValue('deadlinePreset', p.id, { shouldValidate: true, shouldDirty: true })}
                className={cn(
                  'min-h-11 rounded-xl border-2 px-2 text-sm font-semibold',
                  selected ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-fg',
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <p className="text-sm text-muted">{tr.trainings.form.deadlineHint}</p>
        {errors.deadlinePreset && (
          <p role="alert" className="text-sm font-medium text-danger">
            {errors.deadlinePreset.message}
          </p>
        )}

        {values.deadlinePreset === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <TextField label={tr.trainings.form.deadlineDate} type="date" error={errors.deadlineDate?.message} {...register('deadlineDate')} />
            <TextField label={tr.trainings.form.deadlineTimeLabel} type="time" step={300} {...register('deadlineTime')} />
          </div>
        )}
      </fieldset>

      {previewValid && (
        <p className="rounded-xl bg-primary-soft px-4 py-3 text-sm font-medium text-primary" aria-live="polite">
          {formatDayMonth(start)} · {tr.trainings.form.preview(formatTime(start), `${formatDayMonth(deadline)} ${formatTime(deadline)}`)}
        </p>
      )}

      <TextAreaField
        label={`${tr.trainings.form.notes} (${tr.common.optional})`}
        hint={tr.trainings.form.notesHint}
        counter={{ current: values.notes.length, max: 500 }}
        error={errors.notes?.message}
        {...register('notes')}
      />

      {Boolean(submitError) && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {errorMessage(submitError)}
        </p>
      )}

      <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
        {isSubmitting ? tr.trainings.form.saving : mode === 'create' ? tr.trainings.form.create : tr.trainings.form.save}
      </Button>
    </form>
  );
}
