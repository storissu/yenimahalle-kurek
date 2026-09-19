import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyStatus, decideOutcome, MAX_ATTEMPTS, payloadFor, pushOptions } from '../functions/_shared/push.ts';
import {
  forecastUrl,
  HOUR_MS,
  marineUrl,
  mergeSeries,
  metNoUrl,
  parseMetNo,
  parseOpenMeteoForecast,
  parseOpenMeteoMarine,
  snapshotFor,
  snapshotsForTrainings,
  wmoFromMetSymbol,
} from '../functions/_shared/weather.ts';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
// Real responses captured for 41.285318, 31.407823 on 2026-09-19.
const forecast = parseOpenMeteoForecast(fixture('open-meteo-forecast.json'));
const marine = parseOpenMeteoMarine(fixture('open-meteo-marine.json'));
const metNo = parseMetNo(fixture('met-no-compact.json'));
const H = (iso: string) => Date.parse(iso);

describe('request URLs', () => {
  it('asks Open-Meteo for UTC hourly data with gusts in km/h', () => {
    const url = forecastUrl(41.285318, 31.407823);
    expect(url).toContain('latitude=41.285318&longitude=31.407823');
    for (const field of ['wind_gusts_10m', 'precipitation_probability', 'weather_code', 'temperature_2m']) expect(url).toContain(field);
    expect(url).toContain('wind_speed_unit=kmh');
    expect(url).toContain('timezone=UTC');
  });

  it('asks the marine API for waves, and MET Norway with at most 4 decimals', () => {
    expect(marineUrl(41.285318, 31.407823)).toContain('hourly=wave_height,wave_period,wave_direction');
    expect(metNoUrl(41.285318, 31.407823)).toBe('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=41.2853&lon=31.4078');
  });
});

describe('parsing real Open-Meteo responses', () => {
  it('reads 48 hourly points in UTC', () => {
    expect(forecast.size).toBe(48);
    expect(marine.size).toBe(48);
    expect(forecast.has(H('2026-09-19T00:00:00Z'))).toBe(true);
    expect(forecast.has(H('2026-09-20T23:00:00Z'))).toBe(true);
  });

  it('exposes the numbers under our field names (values from the captured response)', () => {
    expect(forecast.get(H('2026-09-19T06:00:00Z'))).toMatchObject({ temperature: 20.1, windKmh: 2.2, gustKmh: 12.6, weatherCode: 2, precipProb: 0 });
    expect(marine.get(H('2026-09-19T06:00:00Z'))).toMatchObject({ waveHeight: 0.26, wavePeriod: 3.7, waveDir: 18 });
  });

  it('tolerates garbage and missing values', () => {
    for (const bad of [null, {}, { hourly: {} }, { hourly: { time: 'x' } }, 'text']) expect(parseOpenMeteoForecast(bad).size).toBe(0);
    const partial = parseOpenMeteoForecast({ hourly: { time: ['2026-09-19T05:00', 'nonsense'], temperature_2m: [18.5, 1], wind_gusts_10m: [null, 3] } });
    expect(partial.size).toBe(1);
    expect(partial.get(H('2026-09-19T05:00:00Z'))).toMatchObject({ temperature: 18.5, gustKmh: null, windKmh: null });
  });
});

describe('parsing the MET Norway fallback', () => {
  it('reads hourly instants, converting wind m/s → km/h and mapping the symbol to a WMO code', () => {
    const point = metNo.get(H('2026-09-19T16:00:00Z'));
    expect(point).toMatchObject({ temperature: 21.2, windKmh: 21.6, windDir: 45.3, cloudPct: 90.6 });
    expect(point?.gustKmh).toBeUndefined(); // the compact feed has no gusts
    expect(point?.weatherCode).toBe(3); // "cloudy"
  });

  it.each([
    ['clearsky_day', 0],
    ['fair_night', 1],
    ['partlycloudy_night', 2],
    ['cloudy', 3],
    ['fog', 45],
    ['lightrain', 61],
    ['heavyrainshowers_day', 82],
    ['snow', 73],
    ['rainandthunder', 95],
    ['heavyrainandthunder', 96],
    ['something_new', null],
  ])('symbol %s → WMO %s', (symbol, code) => {
    expect(wmoFromMetSymbol(symbol)).toBe(code);
  });

  it('ignores non-hourly and broken entries', () => {
    expect(parseMetNo({ properties: { timeseries: [{ time: '2026-09-19T16:30:00Z', data: { instant: { details: { air_temperature: 1 } } } }, { time: 'x' }, {}] } }).size).toBe(0);
    expect(parseMetNo(null).size).toBe(0);
  });
});

describe('merging providers', () => {
  it('combines forecast and waves per hour, and never lets a missing value erase a known one', () => {
    const merged = mergeSeries(forecast, marine);
    expect(merged.get(H('2026-09-19T06:00:00Z'))).toMatchObject({ windKmh: 2.2, waveHeight: 0.26 });
    const filled = mergeSeries(new Map([[1, { temperature: 5 }]]), new Map([[1, { temperature: null, windKmh: 9 }]]));
    expect(filled.get(1)).toMatchObject({ temperature: 5, windKmh: 9 });
  });
});

describe('snapshotFor (one session)', () => {
  const series = mergeSeries(forecast, marine);

  it('describes the session\'s start hour and takes the worse of this and the next hour for gusts/waves/rain', () => {
    const row = snapshotFor('t1', 0, H('2026-09-19T06:00:00Z'), series, 'open-meteo', new Date('2026-09-19T05:00:00Z'));
    expect(row).toMatchObject({
      training_id: 't1',
      slot_index: 0,
      source: 'open-meteo',
      forecast_for: '2026-09-19T06:00:00.000Z',
      temperature_c: 20.1,
      wind_kmh: 2.2,
      gust_kmh: 12.6, // max(12.6 at 06:00, 10.8 at 07:00)
      wave_height_m: 0.26, // max(0.26, 0.24)
      wave_period_s: 3.7,
      weather_code: 2,
      fetched_at: '2026-09-19T05:00:00.000Z',
    });
  });

  it('takes the hour the session starts in, even when it starts mid-hour', () => {
    const row = snapshotFor('t1', 0, H('2026-09-19T06:30:00Z'), series, 'open-meteo');
    expect(row?.forecast_for).toBe('2026-09-19T06:00:00.000Z');
  });

  it('takes the worse gust of the two hours when the next hour is windier', () => {
    const custom = new Map([[3 * HOUR_MS, { gustKmh: 10 }], [4 * HOUR_MS, { gustKmh: 41.6 }]]);
    expect(snapshotFor('t', 0, 3 * HOUR_MS, custom, 'open-meteo')?.gust_kmh).toBe(41.6);
  });

  it('returns null when the forecast does not cover the hour', () => {
    expect(snapshotFor('t', 0, H('2027-01-01T05:00:00Z'), series, 'open-meteo')).toBeNull();
  });

  it('rounds sensibly and keeps unknown fields null (fallback provider has no gusts or waves)', () => {
    const row = snapshotFor('t', 0, H('2026-09-19T16:00:00Z'), metNo, 'met.no');
    expect(row).toMatchObject({ source: 'met.no', wind_kmh: 21.6, gust_kmh: null, wave_height_m: null, precip_prob: null });
  });
});

describe('snapshotsForTrainings', () => {
  const series = mergeSeries(forecast, marine);
  it('makes one row per covered session and skips hours without data', () => {
    const rows = snapshotsForTrainings(
      [
        { id: 'a', starts_at: '2026-09-19T05:00:00Z', slot_count: 3 }, // 05,06,07 UTC: all covered
        { id: 'b', starts_at: '2026-09-20T22:00:00Z', slot_count: 3 }, // 22,23 covered; 00 next day not
      ],
      series,
      'open-meteo',
    );
    expect(rows.filter((r) => r.training_id === 'a').map((r) => r.slot_index)).toEqual([0, 1, 2]);
    expect(rows.filter((r) => r.training_id === 'b').map((r) => r.slot_index)).toEqual([0, 1]);
  });

  it('still forecasts the first hour of a training whose length is not planned yet (0 sessions)', () => {
    const rows = snapshotsForTrainings([{ id: 'c', starts_at: '2026-09-19T05:00:00Z', slot_count: 0 }], series, 'open-meteo');
    expect(rows.map((r) => r.slot_index)).toEqual([0]);
  });
});

describe('push decisions', () => {
  it('is done when there is nothing to push to, or when any device received it', () => {
    expect(decideOutcome(0, [], 0)).toEqual({ done: true, error: null, countAttempt: false });
    expect(decideOutcome(2, ['retry', 'ok'], 3)).toEqual({ done: true, error: null, countAttempt: false });
  });

  it('is done when every device is gone (expired subscriptions)', () => {
    expect(decideOutcome(2, ['gone', 'gone'], 0)).toEqual({ done: true, error: 'subscriptions-expired', countAttempt: false });
  });

  it('retries transient failures and gives up after the maximum number of attempts', () => {
    expect(decideOutcome(1, ['retry'], 0)).toEqual({ done: false, error: 'retry', countAttempt: true });
    expect(decideOutcome(2, ['gone', 'retry'], 1)).toEqual({ done: false, error: 'retry', countAttempt: true });
    expect(decideOutcome(1, ['retry'], MAX_ATTEMPTS - 1)).toEqual({ done: true, error: 'gave-up', countAttempt: true });
  });

  it('treats 404/410 as a dead subscription and everything else as retryable', () => {
    expect(classifyStatus(410)).toBe('gone');
    expect(classifyStatus(404)).toBe('gone');
    for (const s of [undefined, 429, 500, 503]) expect(classifyStatus(s)).toBe('retry');
  });
});

describe('push payload', () => {
  const row = { id: 'n1', type: 'training_cancelled', title: 'Antrenman iptal edildi', body: '...', url: '/uye/antrenmanlar/t1', training_id: 't1' };

  it('carries title, body and in-app link, tagged per kind and training so newer replaces older', () => {
    expect(payloadFor(row)).toEqual({ title: row.title, body: row.body, url: '/uye/antrenmanlar/t1', tag: 'training_cancelled:t1' });
  });

  it('never lets a notification open another site', () => {
    for (const url of ['https://evil.example', '//evil.example', 'javascript:1', '']) expect(payloadFor({ ...row, url }).url).toBe('/');
  });

  it('uses high urgency for time-critical messages only', () => {
    expect(pushOptions('training_cancelled').urgency).toBe('high');
    expect(pushOptions('deadline_reminder').urgency).toBe('high');
    expect(pushOptions('program_published').urgency).toBe('normal');
    expect(pushOptions('training_new').TTL).toBe(21_600);
  });
});
