import { Waves, Wind } from 'lucide-react';
import { formatTime } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { WeatherSnapshot } from '@/types/database';
import { summarizeWeather } from './format';
import { WEATHER_ICONS } from './weatherIcons';

/**
 * The forecast for ONE session of a member's own program, shown right under that session (in "Sizin programınız"):
 * the conditions at the hour they will be on the water, not the weather now. `snapshot` undefined = no forecast yet.
 */
export function CompactWeather({ snapshot, range }: { snapshot: WeatherSnapshot | undefined; range: string }) {
  if (!snapshot) return <p className="mt-2 text-xs text-muted">{tr.weather.mySessionLater}</p>;
  const w = summarizeWeather(snapshot);
  const Icon = WEATHER_ICONS[w.icon];
  return (
    <div role="group" aria-label={tr.weather.forSession(range)} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-surface-2 px-3 py-2 text-sm">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <Icon aria-hidden="true" size={18} className="shrink-0 text-primary" />
        {w.label}
        {w.temperature && ` · ${w.temperature}`}
      </span>
      {w.wind && (
        <span className="inline-flex items-center gap-1">
          <Wind aria-hidden="true" size={14} className="shrink-0" />
          {w.wind}
          {w.gust && ` · ${w.gust}`}
        </span>
      )}
      {w.wave && (
        <span className="inline-flex items-center gap-1">
          <Waves aria-hidden="true" size={14} className="shrink-0" />
          {w.wave}
        </span>
      )}
      {w.rain && <span>{w.rain}</span>}
      <span className="text-xs text-muted">{tr.weather.forecastAt(formatTime(snapshot.fetched_at))}</span>
    </div>
  );
}

/** A one-line version for inside a highlighted row: sky icon, temperature and wind. Takes the colour of its surroundings. */
export function MiniWeather({ snapshot }: { snapshot: WeatherSnapshot | undefined }) {
  if (!snapshot) return null;
  const w = summarizeWeather(snapshot);
  const Icon = WEATHER_ICONS[w.icon];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
      <Icon aria-hidden="true" size={16} className="shrink-0" />
      <span>
        {w.label}
        {w.temperature && ` · ${w.temperature}`}
        {w.wind && ` · ${w.wind}`}
      </span>
    </span>
  );
}
