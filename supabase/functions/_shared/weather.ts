// Weather for a training's sessions. Pure functions (no Deno/npm imports) so they can be unit-tested
// against real API responses (supabase/tests/fixtures).
//
// Providers
//   * Open-Meteo forecast + marine (primary): free for non-commercial use, hourly, has wind GUSTS,
//     precipitation probability and sea WAVES. Requested in UTC so hours are unambiguous.
//   * MET Norway locationforecast (fallback when Open-Meteo is unavailable): no gusts, no waves, no
//     precipitation probability — those fields stay null and the app shows what is known.
//
// A session is one hour long. The values describe the hour the session STARTS in; the "risky"
// fields (gusts, waves, rain) take the worse of that hour and the next, so a warning is never missed.

export const HOUR_MS = 3_600_000;
export const FORECAST_DAYS = 16;

export interface HourValues {
  temperature?: number | null;
  apparent?: number | null;
  windKmh?: number | null;
  gustKmh?: number | null;
  windDir?: number | null;
  precipProb?: number | null;
  precipMm?: number | null;
  weatherCode?: number | null;
  cloudPct?: number | null;
  waveHeight?: number | null;
  wavePeriod?: number | null;
  waveDir?: number | null;
}

/** hour start (ms since epoch, UTC) → values */
export type Series = Map<number, HourValues>;

export type Source = 'open-meteo' | 'met.no';

export const forecastUrl = (lat: number, lng: number, days = FORECAST_DAYS): string =>
  'https://api.open-meteo.com/v1/forecast' +
  `?latitude=${lat}&longitude=${lng}` +
  '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
  `&wind_speed_unit=kmh&timezone=UTC&forecast_days=${days}`;

export const marineUrl = (lat: number, lng: number, days = FORECAST_DAYS): string =>
  'https://marine-api.open-meteo.com/v1/marine' +
  `?latitude=${lat}&longitude=${lng}&hourly=wave_height,wave_period,wave_direction&timezone=UTC&forecast_days=${days}`;

export const metNoUrl = (lat: number, lng: number): string =>
  `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** "2026-09-19T05:00" (UTC, no zone suffix, as requested with timezone=UTC) → ms. */
function openMeteoTime(t: unknown): number | null {
  if (typeof t !== 'string') return null;
  const ms = Date.parse(t.endsWith('Z') ? t : `${t}Z`);
  return Number.isNaN(ms) ? null : ms;
}

type OpenMeteoHourly = Record<string, unknown[] | undefined> & { time?: unknown[] };

function readOpenMeteo(json: unknown, fields: Record<string, keyof HourValues>): Series {
  const series: Series = new Map();
  const hourly = (json as { hourly?: OpenMeteoHourly } | null)?.hourly;
  const times = hourly?.time;
  if (!hourly || !Array.isArray(times)) return series;
  times.forEach((t, i) => {
    const ms = openMeteoTime(t);
    if (ms === null) return;
    const values: HourValues = {};
    for (const [apiName, key] of Object.entries(fields)) values[key] = num(hourly[apiName]?.[i]);
    series.set(ms, values);
  });
  return series;
}

export const parseOpenMeteoForecast = (json: unknown): Series =>
  readOpenMeteo(json, {
    temperature_2m: 'temperature',
    apparent_temperature: 'apparent',
    wind_speed_10m: 'windKmh',
    wind_gusts_10m: 'gustKmh',
    wind_direction_10m: 'windDir',
    precipitation_probability: 'precipProb',
    precipitation: 'precipMm',
    weather_code: 'weatherCode',
    cloud_cover: 'cloudPct',
  });

export const parseOpenMeteoMarine = (json: unknown): Series =>
  readOpenMeteo(json, { wave_height: 'waveHeight', wave_period: 'wavePeriod', wave_direction: 'waveDir' });

/** MET Norway symbol_code ("partlycloudy_day", "lightrain", "rainandthunder") → nearest WMO weather code. */
export function wmoFromMetSymbol(symbol: string | undefined): number | null {
  if (!symbol) return null;
  const base = symbol.replace(/_(day|night|polartwilight)$/, '');
  if (base.includes('thunder')) return base.includes('heavy') ? 96 : 95;
  const map: Record<string, number> = {
    clearsky: 0,
    fair: 1,
    partlycloudy: 2,
    cloudy: 3,
    fog: 45,
    lightrain: 61,
    rain: 63,
    heavyrain: 65,
    lightrainshowers: 80,
    rainshowers: 81,
    heavyrainshowers: 82,
    lightsleet: 67,
    sleet: 67,
    heavysleet: 67,
    lightsleetshowers: 85,
    sleetshowers: 85,
    heavysleetshowers: 86,
    lightsnow: 71,
    snow: 73,
    heavysnow: 75,
    lightsnowshowers: 85,
    snowshowers: 85,
    heavysnowshowers: 86,
  };
  return map[base] ?? null;
}

interface MetNoEntry {
  time?: string;
  data?: {
    instant?: { details?: Record<string, unknown> };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: unknown } };
  };
}

export function parseMetNo(json: unknown): Series {
  const series: Series = new Map();
  const entries = (json as { properties?: { timeseries?: MetNoEntry[] } } | null)?.properties?.timeseries;
  if (!Array.isArray(entries)) return series;
  for (const entry of entries) {
    const ms = typeof entry.time === 'string' ? Date.parse(entry.time) : Number.NaN;
    const details = entry.data?.instant?.details;
    if (Number.isNaN(ms) || !details || ms % HOUR_MS !== 0) continue;
    const speed = num(details.wind_speed);
    series.set(ms, {
      temperature: num(details.air_temperature),
      windKmh: speed === null ? null : Math.round(speed * 3.6 * 10) / 10, // m/s → km/h
      windDir: num(details.wind_from_direction),
      cloudPct: num(details.cloud_area_fraction),
      precipMm: num(entry.data?.next_1_hours?.details?.precipitation_amount),
      weatherCode: wmoFromMetSymbol(entry.data?.next_1_hours?.summary?.symbol_code),
    });
  }
  return series;
}

/** Later series win field by field, but a missing value never erases a known one. */
export function mergeSeries(...all: Series[]): Series {
  const merged: Series = new Map();
  for (const series of all) {
    for (const [hour, values] of series) {
      const target = merged.get(hour) ?? {};
      for (const [key, value] of Object.entries(values) as Array<[keyof HourValues, number | null | undefined]>) {
        if (value !== null && value !== undefined) target[key] = value;
        else if (!(key in target)) target[key] = null;
      }
      merged.set(hour, target);
    }
  }
  return merged;
}

export interface SnapshotRow {
  training_id: string;
  slot_index: number;
  source: Source;
  forecast_for: string;
  temperature_c: number | null;
  apparent_c: number | null;
  wind_kmh: number | null;
  gust_kmh: number | null;
  wind_dir_deg: number | null;
  precip_prob: number | null;
  precip_mm: number | null;
  weather_code: number | null;
  cloud_pct: number | null;
  wave_height_m: number | null;
  wave_period_s: number | null;
  wave_dir_deg: number | null;
  fetched_at: string;
}

const round = (v: number | null, digits = 1): number | null => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);
const maxOf = (...v: Array<number | null | undefined>): number | null => {
  const known = v.filter((x): x is number => typeof x === 'number');
  return known.length ? Math.max(...known) : null;
};

/**
 * The row for one session, or null when the forecast has nothing for that hour (too far ahead / in the past).
 * `startMs` is the session's start instant.
 */
export function snapshotFor(
  trainingId: string,
  slotIndex: number,
  startMs: number,
  series: Series,
  source: Source,
  fetchedAt: Date = new Date(),
): SnapshotRow | null {
  const hour = Math.floor(startMs / HOUR_MS) * HOUR_MS;
  const now = series.get(hour);
  if (!now) return null;
  const next = series.get(hour + HOUR_MS);
  const v = (key: keyof HourValues) => now[key] ?? null;
  return {
    training_id: trainingId,
    slot_index: slotIndex,
    source,
    forecast_for: new Date(hour).toISOString(),
    temperature_c: round(v('temperature')),
    apparent_c: round(v('apparent')),
    wind_kmh: round(v('windKmh')),
    gust_kmh: round(maxOf(now.gustKmh, next?.gustKmh)),
    wind_dir_deg: round(v('windDir'), 0),
    precip_prob: round(maxOf(now.precipProb, next?.precipProb), 0),
    precip_mm: round(maxOf(now.precipMm, next?.precipMm)),
    weather_code: v('weatherCode'),
    cloud_pct: round(v('cloudPct'), 0),
    wave_height_m: round(maxOf(now.waveHeight, next?.waveHeight), 2),
    wave_period_s: round(v('wavePeriod')),
    wave_dir_deg: round(v('waveDir'), 0),
    fetched_at: fetchedAt.toISOString(),
  };
}

export interface TrainingWindow {
  id: string;
  starts_at: string;
  slot_count: number;
  /** End of the last session (null until a program exists). */
  ends_at?: string | null;
  /** The program's sessions: each boat session has its own start. Empty when there is no program. */
  sessions?: Array<{ slot_index: number; starts_at: string }>;
}

/**
 * The sessions to forecast, each at ITS OWN start. With a program: one per session number (an older program may let several
 * boats share a number: the earliest start counts). Without one — a training whose length is not planned yet (slot_count 0) —
 * the old hourly grid, and at least its first hour.
 */
export function forecastSessions(t: TrainingWindow): Array<{ slotIndex: number; startMs: number }> {
  if (t.sessions && t.sessions.length > 0) {
    const earliest = new Map<number, number>();
    for (const s of t.sessions) {
      const ms = Date.parse(s.starts_at);
      const known = earliest.get(s.slot_index);
      if (known === undefined || ms < known) earliest.set(s.slot_index, ms);
    }
    return [...earliest].map(([slotIndex, startMs]) => ({ slotIndex, startMs })).sort((a, b) => a.slotIndex - b.slotIndex);
  }
  const start = Date.parse(t.starts_at);
  return Array.from({ length: Math.max(1, t.slot_count) }, (_, slot) => ({ slotIndex: slot, startMs: start + slot * HOUR_MS }));
}

/** When the training is over: the end of its last session, or (no program) start + one hour per session. */
export const trainingEndMs = (t: Pick<TrainingWindow, 'starts_at' | 'slot_count' | 'ends_at'>): number =>
  t.ends_at ? Date.parse(t.ends_at) : Date.parse(t.starts_at) + Math.max(1, t.slot_count) * HOUR_MS;

/** Snapshot rows for every session of every training that the forecast covers. */
export function snapshotsForTrainings(trainings: TrainingWindow[], series: Series, source: Source, fetchedAt: Date = new Date()): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  for (const t of trainings) {
    for (const { slotIndex, startMs } of forecastSessions(t)) {
      const row = snapshotFor(t.id, slotIndex, startMs, series, source, fetchedAt);
      if (row) rows.push(row);
    }
  }
  return rows;
}
