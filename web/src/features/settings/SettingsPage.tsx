import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { BackLink } from '@/components/layout/BackLink';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { tr } from '@/strings/tr';
import { settingsKey, useClubSettings, type ClubSettings } from './api';

/** An optional number input: empty → null, otherwise a finite number (decimal comma accepted). */
const optionalNumber = (min: number, max: number, message: string) =>
  z
    .string()
    .transform((v) => v.trim().replace(',', '.'))
    .refine((v) => v === '' || (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max), message)
    .transform((v) => (v === '' ? null : Number(v)));

const integerInRange = (min: number, max: number, message: string) =>
  z
    .string()
    .transform((v) => v.trim())
    .refine((v) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max, message)
    .transform(Number);

export const settingsSchema = z.object({
  default_rsvp_lead_hours: integerInRange(0, 168, tr.settings.rsvpRange),
  reminder_lead_hours: integerInRange(1, 24, tr.settings.reminderRange),
  wind_gust_warn_kmh: optionalNumber(1, 200, tr.settings.gustRange),
  wave_warn_m: optionalNumber(0.1, 10, tr.settings.waveRange),
});
type FormInput = z.input<typeof settingsSchema>;
type FormOutput = z.output<typeof settingsSchema>;

const show = (n: number | null): string => (n === null ? '' : String(n).replace('.', ','));

function SettingsForm({ settings }: { settings: ClubSettings }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      default_rsvp_lead_hours: String(settings.default_rsvp_lead_hours),
      reminder_lead_hours: String(settings.reminder_lead_hours),
      wind_gust_warn_kmh: show(settings.wind_gust_warn_kmh),
      wave_warn_m: show(settings.wave_warn_m),
    },
  });

  const save = useMutation({
    mutationFn: async (values: FormOutput) => {
      const { error } = await supabase.from('club_settings').update(values).eq('id', true);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKey });
      toast.show(tr.settings.saved, 'success');
    },
  });

  const onSubmit = handleSubmit((values) => save.mutateAsync(values).catch(() => undefined));

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <TextField
        label={tr.settings.rsvpLead}
        hint={tr.settings.rsvpLeadHint}
        inputMode="numeric"
        error={errors.default_rsvp_lead_hours?.message}
        {...register('default_rsvp_lead_hours')}
      />
      <TextField
        label={tr.settings.reminderLead}
        hint={tr.settings.reminderLeadHint}
        inputMode="numeric"
        error={errors.reminder_lead_hours?.message}
        {...register('reminder_lead_hours')}
      />

      <fieldset className="flex flex-col gap-4 rounded-2xl border border-border p-4">
        <legend className="px-1 text-sm font-bold">{tr.weather.heading}</legend>
        <p className="text-sm text-muted">{tr.settings.thresholdHint}</p>
        <TextField
          label={tr.settings.gust}
          hint={tr.settings.thresholdEmpty}
          inputMode="decimal"
          error={errors.wind_gust_warn_kmh?.message}
          {...register('wind_gust_warn_kmh')}
        />
        <TextField
          label={tr.settings.wave}
          hint={tr.settings.thresholdEmpty}
          inputMode="decimal"
          error={errors.wave_warn_m?.message}
          {...register('wave_warn_m')}
        />
      </fieldset>

      <Card className="flex items-start gap-3">
        <MapPin aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-primary" />
        <div>
          <p className="font-semibold">{tr.settings.site}</p>
          <p className="text-sm">{settings.site_name}</p>
          <p className="font-mono text-xs text-muted">
            {settings.site_lat}, {settings.site_lng}
          </p>
          <p className="mt-1 text-xs text-muted">{tr.settings.siteHint}</p>
        </div>
      </Card>

      {save.isError && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {errorMessage(save.error)}
        </p>
      )}
      <Button type="submit" size="lg" fullWidth loading={save.isPending}>
        {save.isPending ? tr.settings.saving : tr.settings.save}
      </Button>
    </form>
  );
}

export function SettingsPage() {
  const settings = useClubSettings();
  return (
    <>
      <BackLink to="/antrenor/diger">{tr.settings.back}</BackLink>
      <PageHeader title={tr.settings.title} />
      {settings.isPending && <Skeleton className="h-64" />}
      {settings.isError && <ErrorState message={tr.settings.loadError} onRetry={() => void settings.refetch()} />}
      {settings.isSuccess && <SettingsForm settings={settings.data} />}
    </>
  );
}
