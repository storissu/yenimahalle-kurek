import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNow } from '@/lib/clock';
import { formatTime } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { Training } from '@/types/database';
import { useProfile } from '../auth/AuthProvider';
import { useProgram } from '../program/hooks';
import { sessionRangeLabel } from '../trainings/schedule';
import { FORECAST_HORIZON_MS } from './format';
import { useWeather } from './hooks';
import { SourceLink, WeatherRow } from './SessionWeather';

/**
 * A member's forecast, shown ONCE per training as a small card: the conditions at the hour(s) they row in (their own
 * sessions in the published program), or at the start of the training when they are not in any boat yet. Every other
 * weather display (per session, per row) is gone on purpose — one compact place, at the end of the page (it is never the main thing).
 */
export function MemberWeather({ training }: { training: Pick<Training, 'id' | 'starts_at' | 'status'> }) {
  const me = useProfile();
  const program = useProgram(training.id);
  const weather = useWeather(training.id);
  const now = useNow(60_000);

  if (training.status !== 'scheduled') return null; // a forecast only matters before the training
  if (weather.isPending || program.isPending) return <Skeleton className="h-16" />;

  const rows = weather.data ?? [];
  const mine = [...new Set((program.data?.crew ?? []).filter((c) => c.member_id === me.id).map((c) => c.slot_index))].sort((a, b) => a - b);
  const wanted = mine.length > 0 ? mine : [0];
  const shown = wanted.flatMap((slot) => rows.filter((r) => r.slot_index === slot));

  if (shown.length === 0) {
    const tooFar = Date.parse(training.starts_at) - now.getTime() > FORECAST_HORIZON_MS;
    const message = rows.length > 0 ? tr.weather.mySessionLater : tooFar ? tr.weather.tooFar : weather.isError ? tr.common.errorGeneric : tr.weather.notLoaded;
    return <p className="px-1 text-sm text-muted">{message}</p>;
  }

  const newest = shown.reduce((latest, r) => (r.fetched_at > latest ? r.fetched_at : latest), shown[0]?.fetched_at ?? '');
  return (
    <Card role="region" aria-label={tr.weather.heading} className="flex flex-col gap-2 px-4 py-3">
      {shown.map((row) => (
        <WeatherRow key={row.slot_index} snapshot={row} {...(shown.length > 1 ? { label: sessionRangeLabel(training, row.slot_index) } : {})} />
      ))}
      <p className="text-xs text-muted">
        {tr.weather.forecastAt(formatTime(newest))} · <SourceLink source={shown[0]?.source ?? 'open-meteo'} />
      </p>
    </Card>
  );
}
