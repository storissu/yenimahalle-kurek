import { RefreshCw, TriangleAlert, Waves, Wind } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useNow } from '@/lib/clock';
import { formatTime } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { Training, WeatherSnapshot } from '@/types/database';
import { useClubSettings } from '../settings/api';
import { useRefreshWeather, useWeather } from './hooks';
import { beaufort, compassFrom, compassShort, describeWeather, evaluateAdvisory, formatNumber, FORECAST_HORIZON_MS, type Thresholds } from './format';
import { SourceLink } from './SessionWeather';
import { WEATHER_ICONS } from './weatherIcons';

/** One session's forecast as a compact, readable line: sky, temperature, wind (+gust), rain, waves. */
export function WeatherLine({ snapshot }: { snapshot: WeatherSnapshot }) {
  const sky = describeWeather(snapshot.weather_code);
  const Icon = WEATHER_ICONS[sky.icon];
  const rainy = (snapshot.precip_prob ?? 0) >= 20 || (snapshot.precip_mm ?? 0) > 0;

  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="flex items-center gap-2 font-semibold">
        <Icon aria-hidden="true" size={18} className="shrink-0 text-primary" />
        <span>{sky.label}</span>
        {snapshot.temperature_c !== null && <span>· {formatNumber(snapshot.temperature_c, 0)}°</span>}
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted">
        {snapshot.wind_kmh !== null && (
          <span className="inline-flex items-start gap-1">
            <Wind aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
            <span>
              {snapshot.wind_dir_deg !== null && (
                <>
                  <abbr title={compassFrom(snapshot.wind_dir_deg)} className="no-underline">
                    {compassShort(snapshot.wind_dir_deg)}
                  </abbr>{' '}
                </>
              )}
              {formatNumber(snapshot.wind_kmh, 0)} km/s
              {snapshot.gust_kmh !== null && ` · ${tr.weather.gust(formatNumber(snapshot.gust_kmh, 0))}`}{' '}
              <span className="text-xs">({tr.weather.beaufort(beaufort(snapshot.gust_kmh ?? snapshot.wind_kmh))})</span>
            </span>
          </span>
        )}
        {snapshot.wave_height_m !== null && (
          <span className="inline-flex items-center gap-1">
            <Waves aria-hidden="true" size={14} className="shrink-0" />
            <span>{tr.weather.wave(formatNumber(snapshot.wave_height_m, 1))}</span>
          </span>
        )}
        {rainy && snapshot.precip_prob !== null && <span>{tr.weather.rain(formatNumber(snapshot.precip_prob, 0))}</span>}
      </p>
    </div>
  );
}

interface WeatherStripProps {
  training: Pick<Training, 'id' | 'starts_at' | 'slot_count' | 'status'>;
  /** Coaches see warnings when their thresholds are reached and get a refresh button. */
  coach?: boolean;
}

/** The forecast for every session of a training, with source attribution and (for coaches) advisories. */
export function WeatherStrip({ training, coach = false }: WeatherStripProps) {
  const weather = useWeather(training.id);
  const settings = useClubSettings();
  const refresh = useRefreshWeather(training.id);
  const toast = useToast();
  const now = useNow(60_000);

  if (training.status === 'cancelled') return null;
  if (weather.isPending) return <Skeleton className="h-24" />;

  // Boats start at different times, so there can be a row per boat session: list each forecast HOUR once.
  const seenHours = new Set<string>();
  const rows = (weather.data ?? []).filter((row) => (seenHours.has(row.forecast_for) ? false : Boolean(seenHours.add(row.forecast_for))));
  const tooFar = Date.parse(training.starts_at) - now.getTime() > FORECAST_HORIZON_MS;
  const thresholds: Thresholds | null = settings.data ?? null;
  const newest = rows.reduce<string | null>((latest, r) => (latest === null || r.fetched_at > latest ? r.fetched_at : latest), null);
  const advisories = coach ? rows.flatMap((r) => evaluateAdvisory(r, thresholds).map((a) => ({ ...a, slot: r.slot_index, hour: r.forecast_for }))) : [];

  return (
    <Card className="flex flex-col gap-3" role="region" aria-labelledby={`weather-heading-${training.id}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={`weather-heading-${training.id}`} className="text-sm font-bold text-muted">
          {tr.weather.heading}
        </h2>
        {coach && training.status === 'scheduled' && (
          <Button
            variant="ghost"
            loading={refresh.isPending}
            onClick={() =>
              refresh.mutate(undefined, {
                onSuccess: () => toast.show(tr.weather.refreshed, 'success'),
                onError: () => toast.show(tr.weather.refreshError, 'error'),
              })
            }
          >
            <RefreshCw aria-hidden="true" size={16} />
            {refresh.isPending ? tr.weather.refreshing : tr.weather.refresh}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{tooFar ? tr.weather.tooFar : weather.isError ? tr.common.errorGeneric : tr.weather.notLoaded}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <li key={row.slot_index} className="flex gap-3 py-2 first:pt-0 last:pb-0">
              {rows.length > 1 && <span className="w-24 shrink-0 text-sm font-bold tabular-nums">{formatTime(row.forecast_for)}</span>}
              <WeatherLine snapshot={row} />
            </li>
          ))}
        </ul>
      )}

      {advisories.length > 0 && (
        <div role="alert" className="flex flex-col gap-1 rounded-xl bg-warning-soft p-3 text-sm text-warning">
          <p className="flex items-center gap-2 font-bold">
            <TriangleAlert aria-hidden="true" size={16} />
            {tr.weather.advisoryTitle}
          </p>
          <ul className="list-disc pl-5">
            {advisories.map((a) => (
              <li key={`${a.slot}-${a.kind}`}>
                {rows.length > 1 && <span className="font-semibold tabular-nums">{formatTime(a.hour)}: </span>}
                {a.kind === 'gust'
                  ? tr.weather.advisoryGust(formatNumber(a.value, 0), formatNumber(a.threshold, 0))
                  : tr.weather.advisoryWave(formatNumber(a.value, 1), formatNumber(a.threshold, 1))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length > 0 && newest && (
        <p className="text-xs text-muted">
          {tr.weather.forecastAt(formatTime(newest))} · {tr.weather.attribution}:{' '}
          <SourceLink source={rows[0]?.source ?? 'open-meteo'} />
          {rows.some((r) => r.wave_height_m !== null) && <> · {tr.weather.marineNote}</>}
        </p>
      )}
    </Card>
  );
}
