import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tr } from '@/strings/tr';
import type { WeatherSnapshot } from '@/types/database';

// The component needs three things from the outside world (who I am, the program, the forecast); the rest is real.
// Every boat has its own schedule, so a session is a slot number with ITS OWN time (UTC here; Istanbul is +3).
interface MockSession {
  slot: number;
  from: string;
  to: string;
  members: string[];
}
const state = { sessions: [] as MockSession[], rows: [] as WeatherSnapshot[] };
const programData = () => ({
  program: null,
  assignments: state.sessions.map((s) => ({ id: `a${s.slot}`, training_id: 't', slot_index: s.slot, boat_id: 'mavi', notes: null, starts_at: `2026-09-22T${s.from}:00Z`, ends_at: `2026-09-22T${s.to}:00Z` })),
  crew: state.sessions.flatMap((s) => s.members.map((m) => ({ assignment_id: `a${s.slot}`, training_id: 't', slot_index: s.slot, member_id: m, seat: 1 }))),
});
vi.mock('../auth/AuthProvider', () => ({ useProfile: () => ({ id: 'me' }) }));
vi.mock('../program/hooks', () => ({ useProgram: () => ({ isPending: false, data: programData() }) }));
vi.mock('./hooks', () => ({ useWeather: () => ({ isPending: false, isError: false, data: state.rows }) }));

import { MemberWeather } from './MemberWeather';

// 08:00 Istanbul, three sessions of forecast.
const training = { id: 't', starts_at: '2026-09-22T05:00:00Z', status: 'scheduled' as const };
const forecast = (slot: number, over: Partial<WeatherSnapshot> = {}): WeatherSnapshot => ({
  training_id: 't', slot_index: slot, fetched_at: '2026-09-21T14:30:00Z', source: 'open-meteo', forecast_for: '2026-09-22T05:00:00Z',
  temperature_c: 21.4, apparent_c: 20, wind_kmh: 14.2, gust_kmh: 24, wind_dir_deg: 315, precip_prob: 10, precip_mm: 0, weather_code: 2, cloud_pct: 40,
  wave_height_m: 0.6, wave_period_s: 4, wave_dir_deg: 300, ...over,
});

beforeEach(() => {
  state.sessions = [];
  state.rows = [forecast(0, { weather_code: 0, temperature_c: 18.2 }), forecast(1, { weather_code: 63, temperature_c: 23.6 }), forecast(2, { weather_code: 3, temperature_c: 20 })];
});

describe('MemberWeather (one small forecast card per training)', () => {
  it('shows only the hours the member rows in — not every session of the training', () => {
    state.sessions = [{ slot: 1, from: '06:00', to: '07:00', members: ['me'] }, { slot: 0, from: '05:00', to: '06:00', members: ['other'] }];
    render(<MemberWeather training={training} />);
    const card = screen.getByRole('region', { name: tr.weather.heading });
    expect(within(card).getByText(/Yağmurlu · 24°/)).toBeInTheDocument();
    expect(within(card).queryByText(/Açık/)).not.toBeInTheDocument();
    expect(within(card).queryByText(/Kapalı/)).not.toBeInTheDocument();
    // a single hour needs no time label: the hour is already shown on the boat card above
    expect(within(card).queryByRole('group')).not.toBeInTheDocument();
  });

  it('lists each of my sessions labelled with ITS OWN time (boats do not share a schedule) when I row more than once', () => {
    state.sessions = [
      { slot: 0, from: '05:15', to: '06:15', members: ['me'] }, // Turuncu, a quarter past
      { slot: 2, from: '07:00', to: '08:30', members: ['me'] }, // a session of ninety minutes
    ];
    render(<MemberWeather training={training} />);
    expect(screen.getByRole('group', { name: tr.weather.forSession('08:15–09:15') })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: tr.weather.forSession('10:00–11:30') })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: tr.weather.forSession('09:00–10:00') })).not.toBeInTheDocument();
  });

  it("falls back to the training's start hour when I am in no boat", () => {
    render(<MemberWeather training={training} />);
    const card = screen.getByRole('region', { name: tr.weather.heading });
    expect(within(card).getByText(/Açık · 18°/)).toBeInTheDocument();
    expect(within(card).queryByText(/Yağmurlu/)).not.toBeInTheDocument();
  });

  it('credits the source and says when the forecast was made — once, not per row', () => {
    state.sessions = [{ slot: 0, from: '05:00', to: '06:00', members: ['me'] }, { slot: 1, from: '06:00', to: '07:00', members: ['me'] }];
    render(<MemberWeather training={training} />);
    expect(screen.getAllByText(/Tahmin: \d\d:\d\d/)).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Open-Meteo' })).toHaveLength(1);
  });

  it('says the forecast for my hour is not there yet when other hours have one but mine does not', () => {
    state.sessions = [{ slot: 5, from: '05:00', to: '06:00', members: ['me'] }];
    render(<MemberWeather training={training} />);
    expect(screen.getByText(tr.weather.mySessionLater)).toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('says nothing is loaded yet without any forecast, and shows nothing for finished or cancelled trainings', () => {
    state.rows = [];
    const { unmount } = render(<MemberWeather training={training} />);
    expect(screen.getByText(/henüz alınmadı|en fazla 16 gün/)).toBeInTheDocument();
    unmount();
    state.rows = [forecast(0)];
    const { container, rerender } = render(<MemberWeather training={{ ...training, status: 'cancelled' }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MemberWeather training={{ ...training, status: 'completed' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
