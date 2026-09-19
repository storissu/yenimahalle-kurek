import { CalendarX, ChevronRight, Settings, Ship, Users } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useProfile } from '@/features/auth/AuthProvider';
import { InstallBanner } from '@/features/install/InstallBanner';
import { tr } from '@/strings/tr';
import { ComingSoon } from '../shared/ComingSoon';
import { ProfilePanel } from '../shared/ProfilePanel';

export function CoachDashboardPage() {
  const profile = useProfile();
  const firstName = profile.full_name.split(' ')[0] ?? profile.full_name;
  return (
    <>
      <PageHeader title={tr.home.greeting(firstName)} subtitle={tr.app.clubName} />
      <InstallBanner to="/antrenor/diger" />
      <div className="flex flex-col gap-4">
        <Link to="/antrenor/uyeler" className="block">
          <Card className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary">
              <Users aria-hidden="true" size={22} />
            </span>
            <span className="flex-1 font-semibold">{tr.home.manageMembers}</span>
            <ChevronRight aria-hidden="true" size={20} className="text-muted" />
          </Card>
        </Link>
        <EmptyState icon={CalendarX} title={tr.home.noUpcomingTitle} body={tr.home.coachNoUpcomingBody} />
      </div>
    </>
  );
}

export const CoachTrainingsPage = () => <ComingSoon title={tr.nav.trainings} />;
export const CoachStatsPage = () => <ComingSoon title={tr.nav.stats} />;

function SoonRow({ icon: Icon, label }: { icon: typeof Ship; label: string }) {
  return (
    <div className="flex min-h-12 items-center gap-3 px-1 text-muted">
      <Icon aria-hidden="true" size={20} />
      <span className="flex-1 font-medium">{label}</span>
      <Badge>{tr.common.soonTitle}</Badge>
    </div>
  );
}

export function CoachMorePage() {
  return (
    <>
      <PageHeader title={tr.more.title} />
      <div className="flex flex-col gap-4">
        <Card className="divide-y divide-border py-1">
          <SoonRow icon={Ship} label={tr.more.boats} />
          <SoonRow icon={Settings} label={tr.more.clubSettings} />
        </Card>
        <ProfilePanel />
      </div>
    </>
  );
}
