import { describe, expect, it, vi } from 'vitest';
import { tr } from '@/strings/tr';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { settingsSchema } from './SettingsPage';

const parse = (over: Record<string, string> = {}) =>
  settingsSchema.safeParse({ default_rsvp_lead_hours: '12', reminder_lead_hours: '3', wind_gust_warn_kmh: '', wave_warn_m: '', ...over });

describe('club settings form', () => {
  it('accepts the defaults and turns empty thresholds into "no limit"', () => {
    const result = parse();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ default_rsvp_lead_hours: 12, reminder_lead_hours: 3, wind_gust_warn_kmh: null, wave_warn_m: null });
  });

  it('accepts thresholds with a decimal comma or dot', () => {
    const result = parse({ wind_gust_warn_kmh: '35', wave_warn_m: '1,2' });
    expect(result.success && result.data.wave_warn_m).toBe(1.2);
    expect(result.success && result.data.wind_gust_warn_kmh).toBe(35);
    expect(parse({ wave_warn_m: '0.8' }).success).toBe(true);
  });

  it.each([
    ['default_rsvp_lead_hours', '169', tr.settings.rsvpRange],
    ['default_rsvp_lead_hours', 'abc', tr.settings.rsvpRange],
    ['default_rsvp_lead_hours', '-1', tr.settings.rsvpRange],
    ['reminder_lead_hours', '0', tr.settings.reminderRange],
    ['reminder_lead_hours', '25', tr.settings.reminderRange],
    ['reminder_lead_hours', '1.5', tr.settings.reminderRange],
    ['wind_gust_warn_kmh', '0', tr.settings.gustRange],
    ['wind_gust_warn_kmh', '500', tr.settings.gustRange],
    ['wind_gust_warn_kmh', 'çok', tr.settings.gustRange],
    ['wave_warn_m', '0,05', tr.settings.waveRange],
    ['wave_warn_m', '11', tr.settings.waveRange],
  ])('rejects %s = %s', (field, value, message) => {
    const result = parse({ [field]: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((i) => i.message)).toContain(message);
  });

  it('allows the boundary values', () => {
    expect(parse({ default_rsvp_lead_hours: '0', reminder_lead_hours: '24', wind_gust_warn_kmh: '1', wave_warn_m: '10' }).success).toBe(true);
  });
});
