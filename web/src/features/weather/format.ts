// Turning forecast numbers into words a coach or member can read at a glance. Pure and tested.
import type { WeatherSnapshot } from '@/types/database';

const numberFmt = (digits: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** 12.6 → "12,6" (Turkish decimal comma). */
export const formatNumber = (value: number, digits = 1): string => numberFmt(digits).format(value);

// Upper bound (km/h, exclusive) of each Beaufort force 0..11; 12 is everything above.
const BEAUFORT_LIMITS = [2, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];

/** Beaufort force (0–12) for a wind speed in km/h. */
export function beaufort(kmh: number): number {
  const index = BEAUFORT_LIMITS.findIndex((limit) => kmh < limit);
  return index === -1 ? 12 : index;
}

const COMPASS_SHORT = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'] as const;
const COMPASS_FROM = ['kuzeyden', 'kuzeydoğudan', 'doğudan', 'güneydoğudan', 'güneyden', 'güneybatıdan', 'batıdan', 'kuzeybatıdan'] as const;

const sector = (degrees: number): number => Math.round((((degrees % 360) + 360) % 360) / 45) % 8;

/** Where the wind comes FROM, short: 225 → "GB". */
export const compassShort = (degrees: number): string => COMPASS_SHORT[sector(degrees)] ?? '';
/** Where the wind comes FROM, in words: 225 → "güneybatıdan". */
export const compassFrom = (degrees: number): string => COMPASS_FROM[sector(degrees)] ?? '';

export type WeatherIcon = 'sun' | 'cloud-sun' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

/** WMO weather code → Turkish description + icon key. */
export function describeWeather(code: number | null): { label: string; icon: WeatherIcon } {
  if (code === null) return { label: 'Bilinmiyor', icon: 'cloud' };
  if (code === 0) return { label: 'Açık', icon: 'sun' };
  if (code === 1) return { label: 'Çoğunlukla açık', icon: 'sun' };
  if (code === 2) return { label: 'Parçalı bulutlu', icon: 'cloud-sun' };
  if (code === 3) return { label: 'Kapalı', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Sisli', icon: 'fog' };
  if (code >= 51 && code <= 57) return { label: 'Çiseleme', icon: 'drizzle' };
  if (code >= 61 && code <= 67) return { label: 'Yağmurlu', icon: 'rain' };
  if (code >= 71 && code <= 77) return { label: 'Karlı', icon: 'snow' };
  if (code >= 80 && code <= 82) return { label: 'Sağanak yağış', icon: 'rain' };
  if (code === 85 || code === 86) return { label: 'Kar sağanağı', icon: 'snow' };
  if (code >= 95 && code <= 99) return { label: 'Gök gürültülü fırtına', icon: 'thunder' };
  return { label: 'Bilinmiyor', icon: 'cloud' };
}

export interface Thresholds {
  wind_gust_warn_kmh: number | null;
  wave_warn_m: number | null;
}

export interface Advisory {
  kind: 'gust' | 'wave';
  value: number;
  threshold: number;
}

/**
 * Which warning thresholds (set by the coaches) this forecast reaches or exceeds. A missing threshold or a
 * missing measurement never warns. This only INFORMS — nothing is ever cancelled automatically.
 */
export function evaluateAdvisory(
  snapshot: Pick<WeatherSnapshot, 'gust_kmh' | 'wave_height_m'>,
  thresholds: Thresholds | null | undefined,
): Advisory[] {
  const found: Advisory[] = [];
  const gustLimit = thresholds?.wind_gust_warn_kmh;
  const waveLimit = thresholds?.wave_warn_m;
  if (gustLimit != null && snapshot.gust_kmh !== null && snapshot.gust_kmh >= gustLimit) {
    found.push({ kind: 'gust', value: snapshot.gust_kmh, threshold: gustLimit });
  }
  if (waveLimit != null && snapshot.wave_height_m !== null && snapshot.wave_height_m >= waveLimit) {
    found.push({ kind: 'wave', value: snapshot.wave_height_m, threshold: waveLimit });
  }
  return found;
}

/** "Open-Meteo" / "MET Norway" for the attribution line. */
export const sourceName = (source: string): string => (source === 'met.no' ? 'MET Norway' : 'Open-Meteo');

/** The forecast only reaches 16 days ahead. */
export const FORECAST_HORIZON_MS = 16 * 24 * 3_600_000;
