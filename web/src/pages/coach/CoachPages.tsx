import { CalendarX, ChevronRight, History, Pencil, Plus, Settings, Ship, Users, XCircle } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { BackLink } from '@/components/layout/BackLink';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { AttendancePanel } from '@/features/attendance/AttendancePanel';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { WeatherStrip } from '@/features/weather/WeatherStrip';
import { useTrainingCounts } from '@/features/attendance/hooks';
import { useProfile } from '@/features/auth/AuthProvider';
import { InstallBanner } from '@/features/install/InstallBanner';
import { CoachProgramView } from '@/features/program/CoachProgramView';
import { ProgramEditor } from '@/features/program/ProgramEditor';
import { useClubSettings } from '@/features/settings/api';
import { CancelTrainingDialog } from '@/features/trainings/CancelTrainingDialog';
import { defaultValues, fromTraining } from '@/features/trainings/form';
import { useSaveTraining, useTraining, useTrainings } from '@/features/trainings/hooks';
import { ResponsesPanel } from '@/features/trainings/ResponsesPanel';
import { endsAt, partitionTrainings, startsAt } from '@/features/trainings/schedule';
import { TrainingCard } from '@/features/trainings/TrainingCard';
import { TrainingForm } from '@/features/trainings/TrainingForm';
import { TrainingList } from '@/features/trainings/TrainingList';
import { TrainingSummary } from '@/features/trainings/TrainingSummary';
import { useResponseCounts } from '@/features/trainings/useResponseCounts';
import { serverNow, useNow } from '@/lib/clock';
import { tr } from '@/strings/tr';
import type { ResponseCounts } from '@/features/trainings/counts';
import { ProfilePanel } from '../shared/ProfilePanel';

function CountsLine({ counts }: { counts: ResponseCounts | undefined }) {
  if (!counts) return null;
  return (
    <p className="text-sm">
      <span className="font-semibold text-success">{counts.attending} katılıyor</span>
      <span className="text-muted"> · {counts.notAttending} katılmıyor · </span>
      <span className={counts.none > 0 ? 'font-semibold text-warning' : 'text-muted'}>{counts.none} yanıt yok</span>
    </p>
  );
}

function AddTrainingButton() {
  return (
    <Link
      to="/antrenor/antrenmanlar/yeni"
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-fg"
    >
      <Plus aria-hidden="true" size={18} />
      {tr.trainings.add}
    </Link>
  );
}

export function CoachDashboardPage() {
  const profile = useProfile();
  const firstName = profile.full_name.split(' ')[0] ?? profile.full_name;
  const trainings = useTrainings();
  const now = useNow();
  const allScheduled = (trainings.data ?? []).filter((t) => t.status === 'scheduled');
  // Started (or over) but attendance not finished: the coach's to-do list.
  const needsAttendance = allScheduled.filter((t) => startsAt(t) <= now).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  const scheduled = partitionTrainings(allScheduled, now).upcoming.filter((t) => startsAt(t) > now);
  const shown = scheduled.slice(0, 3);
  const counts = useResponseCounts(shown.map((t) => t.id));

  return (
    <>
      <PageHeader
        title={tr.home.greeting(firstName)}
        subtitle={tr.app.clubName}
        action={
          <div className="flex items-center gap-2">
            <NotificationBell to="/antrenor/bildirimler" />
            <AddTrainingButton />
          </div>
        }
      />
      <InstallBanner to="/antrenor/diger" />
      <div className="flex flex-col gap-5">
        <Link to="/antrenor/uyeler" className="block">
          <Card className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Users aria-hidden="true" size={22} />
            </span>
            <span className="flex-1 font-semibold">{tr.home.manageMembers}</span>
            <ChevronRight aria-hidden="true" size={20} className="text-muted" />
          </Card>
        </Link>

        {needsAttendance.length > 0 && (
          <section aria-labelledby="coach-needs-attendance-heading" className="flex flex-col gap-3">
            <h2 id="coach-needs-attendance-heading" className="text-sm font-bold text-warning">
              {tr.attendance.needsHeading}
            </h2>
            <ul className="flex flex-col gap-3">
              {needsAttendance.map((t) => (
                <li key={t.id}>
                  <TrainingCard
                    training={t}
                    to={`/antrenor/antrenmanlar/${t.id}?sekme=yoklama`}
                    footer={<span className="text-sm font-semibold text-primary">{tr.attendance.needsAction} →</span>}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="coach-upcoming-heading" className="flex flex-col gap-3">
          <h2 id="coach-upcoming-heading" className="text-sm font-bold text-muted">
            {tr.home.coachUpcoming}
          </h2>
          {trainings.isPending && <Skeleton className="h-28" />}
          {trainings.isError && <ErrorState message={tr.trainings.loadError} onRetry={() => void trainings.refetch()} />}
          {trainings.isSuccess && shown.length === 0 && (
            <EmptyState icon={CalendarX} title={tr.home.noUpcomingTitle} body={tr.home.coachNoUpcomingBody} />
          )}
          {shown.length > 0 && (
            <ul className="flex flex-col gap-3">
              {shown.map((t) => (
                <li key={t.id}>
                  <TrainingCard training={t} to={`/antrenor/antrenmanlar/${t.id}`} footer={<CountsLine counts={counts?.(t.id)} />} />
                </li>
              ))}
            </ul>
          )}
          {scheduled.length > shown.length && (
            <Link to="/antrenor/antrenmanlar" className="text-center text-sm font-semibold text-primary">
              {tr.home.seeAll}
            </Link>
          )}
        </section>
      </div>
    </>
  );
}

export function CoachTrainingsPage() {
  const trainings = useTrainings();
  const now = useNow();
  const { upcoming, past } = partitionTrainings(trainings.data ?? [], now);
  const counts = useResponseCounts(upcoming.map((t) => t.id));
  const attendanceCounts = useTrainingCounts(past.filter((t) => t.status === 'completed').map((t) => t.id));

  return (
    <>
      <PageHeader title={tr.trainings.title} action={<AddTrainingButton />} />
      <TrainingList
        basePath="/antrenor/antrenmanlar"
        emptyUpcomingBody={tr.trainings.emptyUpcomingCoach}
        footer={(t) => {
          if (t.status === 'scheduled' && endsAt(t) > now) return <CountsLine counts={counts?.(t.id)} />;
          if (t.status === 'scheduled') return <Badge tone="warning">{tr.attendance.badgeMissing}</Badge>;
          if (t.status === 'completed') {
            const row = attendanceCounts.data?.find((r) => r.training_id === t.id);
            return row ? <p className="text-sm font-semibold">{tr.attendance.badgeCounts(row.members, row.sessions)}</p> : null;
          }
          return null;
        }}
      />
    </>
  );
}

type DetailTab = 'responses' | 'program' | 'attendance';

export function CoachTrainingDetailPage() {
  const { id } = useParams();
  const training = useTraining(id);
  const [search] = useSearchParams();
  const initialTab: DetailTab = search.get('sekme') === 'yoklama' ? 'attendance' : 'responses';
  const [tab, setTab] = useState<DetailTab>(initialTab);
  // The program and attendance editors hold unsaved work: once opened they stay mounted (hidden) while other tabs are shown.
  const [programOpened, setProgramOpened] = useState(false);
  const [attendanceOpened, setAttendanceOpened] = useState(initialTab === 'attendance');
  const [cancelling, setCancelling] = useState(false);
  const idPrefix = useId();

  return (
    <>
      <BackLink to="/antrenor/antrenmanlar">{tr.trainings.back}</BackLink>
      {training.isPending && (
        <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      )}
      {training.isError && <ErrorState message={tr.trainings.loadError} onRetry={() => void training.refetch()} />}
      {training.isSuccess && !training.data && (
        <EmptyState icon={CalendarX} title={tr.trainings.notFoundTitle} body={tr.trainings.notFoundBody} />
      )}

      {training.data && (
        <div className="flex flex-col gap-4">
          <TrainingSummary training={training.data} />
          <WeatherStrip training={training.data} coach />

          {training.data.status === 'cancelled' && training.data.cancel_reason && (
            <p role="status" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
              {tr.trainings.cancelReasonShown(training.data.cancel_reason)}
            </p>
          )}

          {training.data.status === 'scheduled' && (
            <div className="grid grid-cols-2 gap-3">
              <Link
                to={`/antrenor/antrenmanlar/${training.data.id}/duzenle`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 px-4 text-[15px] font-semibold"
              >
                <Pencil aria-hidden="true" size={18} />
                {tr.trainings.edit}
              </Link>
              <Button variant="secondary" onClick={() => setCancelling(true)} className="text-danger">
                <XCircle aria-hidden="true" size={18} />
                {tr.trainings.cancelAction}
              </Button>
            </div>
          )}

          <CoachProgramView training={training.data} />

          <div>
            <Tabs
              label={tr.trainings.tabsLabel}
              idPrefix={idPrefix}
              value={tab}
              onChange={(next) => {
                setTab(next);
                if (next === 'program') setProgramOpened(true);
                if (next === 'attendance') setAttendanceOpened(true);
              }}
              tabs={[
                { id: 'responses', label: tr.trainings.tabResponses },
                { id: 'program', label: tr.trainings.tabProgram },
                { id: 'attendance', label: tr.trainings.tabAttendance },
              ]}
            />
            <TabPanel idPrefix={idPrefix} id="responses" hidden={tab !== 'responses'}>
              <ResponsesPanel training={training.data} />
            </TabPanel>
            <TabPanel idPrefix={idPrefix} id="program" hidden={tab !== 'program'}>
              {programOpened && <ProgramEditor training={training.data} />}
            </TabPanel>
            <TabPanel idPrefix={idPrefix} id="attendance" hidden={tab !== 'attendance'}>
              {attendanceOpened && <AttendancePanel training={training.data} />}
            </TabPanel>
          </div>

          <CancelTrainingDialog trainingId={training.data.id} open={cancelling} onClose={() => setCancelling(false)} />
        </div>
      )}
    </>
  );
}

/** Create (`/yeni`) and edit (`/:id/duzenle`) share one form. */
export function CoachTrainingFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const settings = useClubSettings();
  const training = useTraining(mode === 'edit' ? id : undefined);
  const save = useSaveTraining(mode === 'edit' ? id : undefined);

  const backTo = mode === 'edit' && id ? `/antrenor/antrenmanlar/${id}` : '/antrenor/antrenmanlar';
  const title = mode === 'create' ? tr.trainings.newTitle : tr.trainings.editTitle;

  // The form's defaults are fixed when it mounts, so wait until they are known.
  const ready = mode === 'create' ? !settings.isPending : training.isSuccess;

  return (
    <>
      <BackLink to={backTo}>{mode === 'create' ? tr.trainings.back : tr.common.cancel}</BackLink>
      <PageHeader title={title} />

      {!ready && !training.isError && (
        <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-40" />
        </div>
      )}
      {mode === 'edit' && training.isError && <ErrorState message={tr.trainings.loadError} onRetry={() => void training.refetch()} />}
      {mode === 'edit' && training.isSuccess && !training.data && (
        <EmptyState icon={CalendarX} title={tr.trainings.notFoundTitle} body={tr.trainings.notFoundBody} />
      )}
      {mode === 'edit' && training.data && training.data.status !== 'scheduled' && (
        <EmptyState icon={XCircle} title={tr.trainings.notEditableTitle} body={tr.trainings.notEditableBody} />
      )}

      {ready && (mode === 'create' || (training.data && training.data.status === 'scheduled')) && (
        <TrainingForm
          mode={mode}
          initial={
            mode === 'create'
              ? defaultValues(settings.data?.default_rsvp_lead_hours ?? 12, serverNow())
              : fromTraining(training.data as NonNullable<typeof training.data>)
          }
          submitError={save.error}
          onSubmit={async (payload) => {
            const saved = await save.mutateAsync(payload);
            toast.show(mode === 'create' ? tr.trainings.created : tr.trainings.updated, 'success');
            void navigate(`/antrenor/antrenmanlar/${saved.id}`, { replace: true });
          }}
        />
      )}
    </>
  );
}

export function CoachMorePage() {
  return (
    <>
      <PageHeader title={tr.more.title} />
      <div className="flex flex-col gap-4">
        <Card className="divide-y divide-border py-1">
          <Link to="/antrenor/diger/tekneler" className="flex min-h-12 items-center gap-3 px-1 font-medium">
            <Ship aria-hidden="true" size={20} className="text-primary" />
            <span className="flex-1">{tr.more.boats}</span>
            <ChevronRight aria-hidden="true" size={20} className="text-muted" />
          </Link>
          <Link to="/antrenor/diger/ayarlar" className="flex min-h-12 items-center gap-3 px-1 font-medium">
            <Settings aria-hidden="true" size={20} className="text-primary" />
            <span className="flex-1">{tr.more.clubSettings}</span>
            <ChevronRight aria-hidden="true" size={20} className="text-muted" />
          </Link>
          <Link to="/antrenor/diger/gecmis" className="flex min-h-12 items-center gap-3 px-1 font-medium">
            <History aria-hidden="true" size={20} className="text-primary" />
            <span className="flex-1">{tr.more.audit}</span>
            <ChevronRight aria-hidden="true" size={20} className="text-muted" />
          </Link>
        </Card>
        <ProfilePanel />
      </div>
    </>
  );
}
