import { describe, expect, it } from 'vitest';
import type { WeatherSnapshot } from '@/types/database';
import { beaufort, compassFrom, compassShort, describeWeather, evaluateAdvisory, formatNumber, sourceName, summarizeWeather } from './format';

describe('formatNumber', () => {
  it('uses the Turkish decimal comma and drops needless zeros', () => {
    expect(formatNumber(12.6)).toBe('12,6');
    expect(formatNumber(0.26, 2)).toBe('0,26');
    expect(formatNumber(15)).toBe('15');
    expect(formatNumber(15.04)).toBe('15');
  });
});

describe('beaufort', () => {
  it.each([
    [0, 0],
    [1.9, 0],
    [2, 1],
    [11.9, 2],
    [12, 3],
    [19, 3],
    [20, 4],
    [28.9, 4],
    [29, 5],
    [50, 7],
    [61.9, 7],
    [62, 8],
    [117, 11],
    [118, 12],
    [200, 12],
  ])('%s km/h → force %s', (kmh, force) => {
    expect(beaufort(kmh)).toBe(force);
  });
});

describe('compass (where the wind comes FROM)', () => {
  it.each([
    [0, 'K', 'kuzeyden'],
    [45, 'KD', 'kuzeydoğudan'],
    [90, 'D', 'doğudan'],
    [180, 'G', 'güneyden'],
    [225, 'GB', 'güneybatıdan'],
    [270, 'B', 'batıdan'],
    [315, 'KB', 'kuzeybatıdan'],
    [359, 'K', 'kuzeyden'],
    [22, 'K', 'kuzeyden'],
    [23, 'KD', 'kuzeydoğudan'],
    [-45, 'KB', 'kuzeybatıdan'],
    [405, 'KD', 'kuzeydoğudan'],
  ])('%s° → %s / %s', (deg, short, long) => {
    expect(compassShort(deg)).toBe(short);
    expect(compassFrom(deg)).toBe(long);
  });
});

describe('describeWeather (WMO codes)', () => {
  it.each([
    [0, 'Açık', 'sun'],
    [2, 'Parçalı bulutlu', 'cloud-sun'],
    [3, 'Kapalı', 'cloud'],
    [45, 'Sisli', 'fog'],
    [53, 'Çiseleme', 'drizzle'],
    [63, 'Yağmurlu', 'rain'],
    [81, 'Sağanak yağış', 'rain'],
    [73, 'Karlı', 'snow'],
    [95, 'Gök gürültülü fırtına', 'thunder'],
    [null, 'Bilinmiyor', 'cloud'],
    [1234, 'Bilinmiyor', 'cloud'],
  ])('code %s → %s', (code, label, icon) => {
    expect(describeWeather(code)).toEqual({ label, icon });
  });
});

describe('evaluateAdvisory (coach-set thresholds)', () => {
  const snapshot = { gust_kmh: 38, wave_height_m: 1.4 };

  it('warns for each threshold that is reached or exceeded', () => {
    expect(evaluateAdvisory(snapshot, { wind_gust_warn_kmh: 30, wave_warn_m: 1.2 })).toEqual([
      { kind: 'gust', value: 38, threshold: 30 },
      { kind: 'wave', value: 1.4, threshold: 1.2 },
    ]);
    expect(evaluateAdvisory(snapshot, { wind_gust_warn_kmh: 38, wave_warn_m: 2 })).toEqual([{ kind: 'gust', value: 38, threshold: 38 }]); // exactly at the limit counts
  });

  it('stays quiet below the limits, without limits, or without measurements', () => {
    expect(evaluateAdvisory(snapshot, { wind_gust_warn_kmh: 50, wave_warn_m: 2 })).toEqual([]);
    expect(evaluateAdvisory(snapshot, { wind_gust_warn_kmh: null, wave_warn_m: null })).toEqual([]);
    expect(evaluateAdvisory(snapshot, null)).toEqual([]);
    expect(evaluateAdvisory({ gust_kmh: null, wave_height_m: null }, { wind_gust_warn_kmh: 1, wave_warn_m: 0.1 })).toEqual([]);
  });
});

describe('sourceName', () => {
  it('names the provider for the attribution line', () => {
    expect(sourceName('open-meteo')).toBe('Open-Meteo');
    expect(sourceName('met.no')).toBe('MET Norway');
  });
});

describe('summarizeWeather (the compact forecast of one session)', () => {
  const snapshot = (over: Partial<WeatherSnapshot> = {}): WeatherSnapshot => ({
    training_id: 't', slot_index: 0, fetched_at: '2026-09-21T14:30:00Z', source: 'open-meteo', forecast_for: '2026-09-22T05:00:00Z',
    temperature_c: 21.4, apparent_c: 20, wind_kmh: 14.2, gust_kmh: 24.4, wind_dir_deg: 315, precip_prob: 10, precip_mm: 0, weather_code: 2, cloud_pct: 40,
    wave_height_m: 0.64, wave_period_s: 4, wave_dir_deg: 300, ...over,
  });

  it('prints each measurement as a short Turkish piece, rounded', () => {
    expect(summarizeWeather(snapshot())).toEqual({
      label: 'Parçalı bulutlu',
      icon: describeWeather(2).icon,
      temperature: '21°',
      wind: 'KB 14 km/s',
      gust: 'hamle 24 km/s',
      wave: 'dalga 0,6 m',
      rain: null, // 10 % is not worth mentioning
    });
  });

  it('mentions rain from 20 % on, or when any is measurable', () => {
    expect(summarizeWeather(snapshot({ precip_prob: 20 })).rain).toBe('yağış %20');
    expect(summarizeWeather(snapshot({ precip_prob: 5, precip_mm: 0.4 })).rain).toBe('yağış %5');
    expect(summarizeWeather(snapshot({ precip_prob: 19, precip_mm: 0 })).rain).toBeNull();
    expect(summarizeWeather(snapshot({ precip_prob: null, precip_mm: 2 })).rain).toBeNull(); // no probability to print
  });

  it('leaves out what the source did not give (no marine data, no direction)', () => {
    const s = summarizeWeather(snapshot({ temperature_c: null, wind_kmh: 9, wind_dir_deg: null, gust_kmh: null, wave_height_m: null }));
    expect(s).toMatchObject({ temperature: null, wind: '9 km/s', gust: null, wave: null });
  });
});
