import { CalendarX, TriangleAlert } from 'lucide-react';
import { useParams } from 'react-router';
import { BackLink } from '@/components/layout/BackLink';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useProfile } from '@/features/auth/AuthProvider';
import { MyAttendanceBadge, MyAttendanceCard } from '@/features/attendance/MyAttendance';
import { useMyAttendance } from '@/features/attendance/hooks';
import { InstallBanner } from '@/features/install/InstallBanner';
import { MemberProgram } from '@/features/program/MemberProgram';
import { useMyResponses, useTraining, useTrainings } from '@/features/trainings/hooks';
import { MemberRsvp } from '@/features/trainings/MemberRsvp';
import { MyAnswerBadge } from '@/features/trainings/MyAnswerBadge';
import { HOUR_MS, formatDayMonth } from '@/lib/time';
import { endsAt, partitionTrainings, startsAt } from '@/features/trainings/schedule';
import { TrainingCard } from '@/features/trainings/TrainingCard';
import { TrainingList } from '@/features/trainings/TrainingList';
import { TrainingSummary } from '@/features/trainings/TrainingSummary';
import { useNow } from '@/lib/clock';
import { tr } from '@/strings/tr';
import { ProfilePanel } from '../shared/ProfilePanel';

export function MemberHomePage() {
  const profile = useProfile();
  const firstName = profile.full_name.split(' ')[0] ?? profile.full_name;
  const trainings = useTrainings();
  const responses = useMyResponses();
  const now = useNow();

  const { upcoming } = partitionTrainings(trainings.data ?? [], now);
  const scheduled = upcoming.filter((t) => t.status === 'scheduled');
  const next = scheduled[0];
  const others = scheduled.slice(1, 4);
  // Cancellations in the coming week matter even though they are not "the next training".
  const cancelledSoon = upcoming.filter((t) => t.status === 'cancelled' && startsAt(t).getTime() - now.getTime() < 7 * 24 * HOUR_MS);
  const answerOf = (id: string) => responses.data?.find((r) => r.training_id === id);

  return (
    <>
      <PageHeader title={tr.home.greeting(firstName)} subtitle={tr.app.clubName} />
      <InstallBanner to="/uye/profil" />

      {trainings.isPending && (
        <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-64" />
        </div>
      )}
      {trainings.isError && <ErrorState message={tr.trainings.loadError} onRetry={() => void trainings.refetch()} />}

      {trainings.isSuccess && (
        <div className="flex flex-col gap-5">
          {cancelledSoon.map((t) => (
            <Card key={t.id} className="flex items-start gap-3 border-danger bg-danger-soft">
              <TriangleAlert aria-hidden="true" className="mt-0.5 shrink-0 text-danger" size={20} />
              <div className="min-w-0">
                <p className="font-semibold text-danger">
                  {formatDayMonth(t.starts_at)} — {tr.trainings.statusCancelled}
                </p>
                {t.cancel_reason && <p className="text-sm text-danger">{tr.trainings.cancelReasonShown(t.cancel_reason)}</p>}
              </div>
            </Card>
          ))}

          {next ? (
            <section aria-labelledby="next-training-heading" className="flex flex-col gap-3">
              <h2 id="next-training-heading" className="text-sm font-bold text-muted">
                {tr.home.nextTraining}
              </h2>
              <TrainingSummary training={next} />
              <MemberProgram training={next} variant="summary" detailPath={`/uye/antrenmanlar/${next.id}`} />
              <MemberRsvp training={next} />
            </section>
          ) : (
            <EmptyState icon={CalendarX} title={tr.home.noUpcomingTitle} body={tr.home.noUpcomingBody} />
          )}

          {others.length > 0 && (
            <section aria-labelledby="other-trainings-heading" className="flex flex-col gap-3">
              <h2 id="other-trainings-heading" className="text-sm font-bold text-muted">
                {tr.home.otherUpcoming}
              </h2>
              <ul className="flex flex-col gap-3">
                {others.map((t) => (
                  <li key={t.id}>
                    <TrainingCard
                      training={t}
                      to={`/uye/antrenmanlar/${t.id}`}
                      footer={<MyAnswerBadge training={t} response={answerOf(t.id)} now={now} />}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}

export function MemberTrainingsPage() {
  const responses = useMyResponses();
  const attendance = useMyAttendance();
  return (
    <>
      <PageHeader title={tr.trainings.title} />
      <TrainingList
        basePath="/uye/antrenmanlar"
        emptyUpcomingBody={tr.trainings.emptyUpcomingMember}
        footer={(t, now) =>
          endsAt(t) <= now ? (
            <MyAttendanceBadge training={t} records={attendance.data ?? []} now={now} />
          ) : (
            <MyAnswerBadge training={t} response={responses.data?.find((r) => r.training_id === t.id)} now={now} />
          )
        }
      />
    </>
  );
}

export function MemberTrainingDetailPage() {
  const { id } = useParams();
  const training = useTraining(id);
  const attendance = useMyAttendance();

  return (
    <>
      <BackLink to="/uye/antrenmanlar">{tr.trainings.back}</BackLink>
      {training.isPending && (
        <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      )}
      {training.isError && <ErrorState message={tr.trainings.loadError} onRetry={() => void training.refetch()} />}
      {training.isSuccess && !training.data && (
        <EmptyState icon={CalendarX} title={tr.trainings.notFoundTitle} body={tr.trainings.notFoundBody} />
      )}
      {training.data && (
        <div className="flex flex-col gap-4">
          <TrainingSummary training={training.data} />
          {training.data.status === 'completed' && attendance.isSuccess && <MyAttendanceCard training={training.data} records={attendance.data} />}
          {training.data.status !== 'cancelled' && <MemberProgram training={training.data} variant="mine" />}
          <MemberRsvp training={training.data} />
          {training.data.status !== 'cancelled' && <MemberProgram training={training.data} variant="rest" />}
        </div>
      )}
    </>
  );
}

export function MemberProfilePage() {
  return (
    <>
      <PageHeader title={tr.profile.title} />
      <ProfilePanel />
    </>
  );
}
