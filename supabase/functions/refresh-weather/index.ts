// POST {} | { training_id }   (pg_cron with x-cron-secret, or a signed-in coach)
// Fetches the forecast (+ sea waves) for the club's site once and stores one snapshot row per session of
// every upcoming training in weather_snapshots. Open-Meteo is primary; MET Norway is the fallback.
// No API keys needed. Optional secret: WEATHER_USER_AGENT (MET Norway requires an identifying User-Agent).
import { requireCoach } from '../_shared/auth.ts';
import { hasValidCronSecret, serviceClient } from '../_shared/cron.ts';
import { handle, HttpError, json } from '../_shared/http.ts';
import {
  FORECAST_DAYS,
  forecastSlots,
  forecastUrl,
  HOUR_MS,
  marineUrl,
  mergeSeries,
  metNoUrl,
  parseMetNo,
  parseOpenMeteoForecast,
  parseOpenMeteoMarine,
  snapshotsForTrainings,
  type Series,
  type Source,
} from '../_shared/weather.ts';

const USER_AGENT = Deno.env.get('WEATHER_USER_AGENT') ?? 'yenimahalle-kurek-club-app/1.0 (https://github.com/storissu/yenimahalle-kurek)';

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.json();
}

async function loadSeries(lat: number, lng: number): Promise<{ series: Series; source: Source }> {
  let base: Series | null = null;
  let source: Source = 'open-meteo';
  try {
    base = parseOpenMeteoForecast(await getJson(forecastUrl(lat, lng)));
    if (base.size === 0) throw new Error('empty forecast');
  } catch (error) {
    console.error('Open-Meteo forecast failed, trying MET Norway:', (error as Error).message);
    try {
      base = parseMetNo(await getJson(metNoUrl(lat, lng)));
      source = 'met.no';
    } catch (fallbackError) {
      console.error('MET Norway failed too:', (fallbackError as Error).message);
    }
  }
  if (!base || base.size === 0) throw new HttpError(502, 'Hava durumu servisine ulaşılamadı');

  // Sea state is only available from Open-Meteo Marine; its absence just leaves waves empty.
  let waves: Series = new Map();
  try {
    waves = parseOpenMeteoMarine(await getJson(marineUrl(lat, lng)));
  } catch (error) {
    console.error('Marine forecast unavailable:', (error as Error).message);
  }
  return { series: mergeSeries(base, waves), source };
}

Deno.serve(
  handle(async (req) => {
    const admin = hasValidCronSecret(req) ? serviceClient() : (await requireCoach(req)).admin;
    const body = await req.json().catch(() => ({}));
    const trainingId = typeof body?.training_id === 'string' ? body.training_id : null;

    const { data: settings, error: settingsError } = await admin.from('club_settings').select('site_lat, site_lng').single();
    if (settingsError || !settings) throw new HttpError(500, 'Kulüp ayarları okunamadı');

    let query = admin
      .from('trainings')
      .select('id, starts_at, slot_count')
      .eq('status', 'scheduled')
      .lt('starts_at', new Date(Date.now() + FORECAST_DAYS * 24 * HOUR_MS).toISOString());
    if (trainingId) query = query.eq('id', trainingId);
    const { data: trainings, error: trainingsError } = await query;
    if (trainingsError) throw new HttpError(500, 'Antrenmanlar okunamadı');

    const now = Date.now();
    const upcoming = (trainings ?? []).filter((t) => Date.parse(t.starts_at) + forecastSlots(t) * HOUR_MS > now);
    if (upcoming.length === 0) return json({ updated: 0 });

    const { series, source } = await loadSeries(Number(settings.site_lat), Number(settings.site_lng));
    const rows = snapshotsForTrainings(upcoming, series, source);

    if (rows.length > 0) {
      const { error } = await admin.from('weather_snapshots').upsert(rows, { onConflict: 'training_id,slot_index' });
      if (error) {
        console.error('upsert failed', error.message);
        throw new HttpError(500, 'Hava durumu kaydedilemedi');
      }
    }
    // A training that lost sessions must not keep their old forecasts.
    for (const t of upcoming) {
      await admin.from('weather_snapshots').delete().eq('training_id', t.id).gte('slot_index', forecastSlots(t));
    }
    return json({ updated: rows.length, trainings: upcoming.length, source });
  }),
);
