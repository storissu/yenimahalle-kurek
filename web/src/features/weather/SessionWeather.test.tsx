import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { tr } from '@/strings/tr';
import type { WeatherSnapshot } from '@/types/database';
import { SourceLink, WeatherRow } from './SessionWeather';

const forecast = (over: Partial<WeatherSnapshot> = {}): WeatherSnapshot => ({
  training_id: 't', slot_index: 0, fetched_at: '2026-09-21T14:30:00Z', source: 'open-meteo', forecast_for: '2026-09-22T05:00:00Z',
  temperature_c: 21.4, apparent_c: 20, wind_kmh: 14.2, gust_kmh: 24, wind_dir_deg: 315, precip_prob: 10, precip_mm: 0, weather_code: 2, cloud_pct: 40,
  wave_height_m: 0.6, wave_period_s: 4, wave_dir_deg: 300, ...over,
});

describe('WeatherRow', () => {
  it('is one line of sky, temperature, wind with gust and waves', () => {
    render(<WeatherRow snapshot={forecast()} />);
    expect(screen.getByText(/Parçalı bulutlu · 21°/)).toBeInTheDocument();
    expect(screen.getByText(/KB 14 km\/s · hamle 24 km\/s/)).toBeInTheDocument();
    expect(screen.getByText('dalga 0,6 m')).toBeInTheDocument();
    expect(screen.queryByText(/yağış/)).not.toBeInTheDocument(); // 10 % is not worth mentioning
    expect(screen.queryByRole('group')).not.toBeInTheDocument(); // nothing to name when it stands alone
  });

  it('mentions rain when it is likely, and skips values that are unknown', () => {
    render(<WeatherRow snapshot={forecast({ weather_code: 63, precip_prob: 70, wave_height_m: null, gust_kmh: null })} />);
    expect(screen.getByText('yağış %70')).toBeInTheDocument();
    expect(screen.getByText(/Yağmurlu/)).toBeInTheDocument();
    expect(screen.queryByText(/dalga/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hamle/)).not.toBeInTheDocument();
  });

  it('names its session by time when several are listed together', () => {
    render(<WeatherRow snapshot={forecast()} label="09:00–10:00" />);
    const group = screen.getByRole('group', { name: tr.weather.forSession('09:00–10:00') });
    expect(within(group).getByText('09:00–10:00')).toBeInTheDocument();
    expect(within(group).getByText(/Parçalı bulutlu/)).toBeInTheDocument();
  });
});

describe('SourceLink', () => {
  it('credits the provider with a link', () => {
    const { unmount } = render(<SourceLink source="open-meteo" />);
    expect(screen.getByRole('link', { name: 'Open-Meteo' })).toHaveAttribute('href', 'https://open-meteo.com/');
    unmount();
    render(<SourceLink source="met.no" />);
    expect(screen.getByRole('link', { name: 'MET Norway' })).toHaveAttribute('href', 'https://www.met.no/');
  });
});
