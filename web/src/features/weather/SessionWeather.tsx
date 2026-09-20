import { Waves, Wind } from 'lucide-react';
import { tr } from '@/strings/tr';
import type { WeatherSnapshot } from '@/types/database';
import { sourceName, summarizeWeather } from './format';
import { WEATHER_ICONS } from './weatherIcons';

/**
 * One session's forecast as a single compact line: sky + temperature, wind (+gust), waves, rain when likely. `label` is
 * the session's time, given only when several sessions are listed together. No card, no heading: the caller frames it.
 */
export function WeatherRow({ snapshot, label }: { snapshot: WeatherSnapshot; label?: string }) {
  const w = summarizeWeather(snapshot);
  const Icon = WEATHER_ICONS[w.icon];
  return (
    <div {...(label ? { role: 'group', 'aria-label': tr.weather.forSession(label) } : {})} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {label && <span className="min-w-[6.5rem] font-bold tabular-nums">{label}</span>}
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
    </div>
  );
}

/** Attribution of the forecast data (kept wherever a forecast is shown). */
export function SourceLink({ source }: { source: string }) {
  return (
    <a href={source === 'met.no' ? 'https://www.met.no/' : 'https://open-meteo.com/'} target="_blank" rel="noopener noreferrer" className="underline">
      {sourceName(source)}
    </a>
  );
}
