import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useNow } from '@/lib/clock';
import { formatShortDate, formatTime, HOUR_MS } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { Training, WeatherSnapshot } from '@/types/database';
import { useProfile } from '../auth/AuthProvider';
import { useProgram } from '../program/hooks';
import { myAssignments } from '../program/view';
import { useClubSettings } from '../settings/api';
import { sessionRangeLabel, spanLabel } from '../trainings/schedule';
import { FORECAST_HORIZON_MS } from './format';
import { useWeather } from './hooks';
import { SourceLink, WeatherRow } from './SessionWeather';

/** The forecast hour (UTC ms) that describes an instant: the hour it falls in, exactly as refresh-weather stores it in `forecast_for`. */
const hourOf = (iso: string): number => Math.floor(Date.parse(iso) / HOUR_MS) * HOUR_MS;

/**
 * A member's forecast, shown ONCE per training as a small card: the conditions at the START of the session(s) they row in
 * (their own sessions in the published program), or at the start of the training when they are not in any boat yet. The card
 * says which date and time that is ("22 Eyl, 08:15 tahmini"), and the row shown is the one whose forecast hour IS that start —
 * matched by the hour, never by the session's number, so a row left over from an earlier time can never be shown for a new one.
 * Every other weather display (per session, per row) is gone on purpose — one compact place, at the end of the page (it is never the main thing).
 */
export function MemberWeather({ training }: { training: Pick<Training, 'id' | 'starts_at' | 'status'> }) {
  const me = useProfile();
  const program = useProgram(training.id);
  const weather = useWeather(training.id);
  const settings = useClubSettings();
  const now = useNow(60_000);

  if (training.status !== 'scheduled') return null; // a forecast only matters before the training
  if (weather.isPending || program.isPending) return <Skeleton className="h-16" />;

  const rows = weather.data ?? [];
  // My sessions, each with its own start (every boat has its own schedule); nobody's boat yet → the start of the training.
  const mine = program.data ? myAssignments(program.data, me.id) : [];
  const targets =
    mine.length > 0
      ? mine.map((a) => ({ slot: a.slotIndex, startsAt: a.startsAt, label: spanLabel(a.startsAt, a.endsAt) }))
      : [{ slot: 0, startsAt: training.starts_at, label: sessionRangeLabel(training, 0) }];
  const shown = targets.flatMap((target) => {
    const row: WeatherSnapshot | undefined = rows.find((r) => hourOf(r.forecast_for) === hourOf(target.startsAt));
    return row ? [{ ...target, row }] : [];
  });

  if (shown.length === 0) {
    const tooFar = Date.parse(training.starts_at) - now.getTime() > FORECAST_HORIZON_MS;
    const message = rows.length > 0 ? tr.weather.mySessionLater : tooFar ? tr.weather.tooFar : weather.isError ? tr.common.errorGeneric : tr.weather.notLoaded;
    return <p className="px-1 text-sm text-muted">{message}</p>;
  }

  const first = shown[0]!;
  const many = shown.length > 1;
  const newest = shown.reduce((latest, s) => (s.row.fetched_at > latest ? s.row.fetched_at : latest), first.row.fetched_at);
  const site = settings.data?.site_name;
  return (
    <Card role="region" aria-label={tr.weather.heading} className="flex flex-col gap-2 px-4 py-3">
      <p className="text-sm font-bold tabular-nums">
        {many ? tr.weather.forecastForDay(formatShortDate(first.startsAt)) : tr.weather.forecastFor(formatShortDate(first.startsAt), formatTime(first.startsAt))}
      </p>
      {shown.map((s) => (
        <WeatherRow key={s.slot} snapshot={s.row} {...(many ? { label: s.label } : {})} />
      ))}
      <p className="text-xs text-muted">
        {site && `${tr.weather.location(site)} · `}
        {tr.weather.updatedAt(formatTime(newest))} · <SourceLink source={first.row.source} />
      </p>
    </Card>
  );
}
