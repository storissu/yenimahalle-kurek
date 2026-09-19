import { CalendarX } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { useProfile } from '@/features/auth/AuthProvider';
import { InstallBanner } from '@/features/install/InstallBanner';
import { tr } from '@/strings/tr';
import { ComingSoon } from '../shared/ComingSoon';
import { ProfilePanel } from '../shared/ProfilePanel';

export function MemberHomePage() {
  const profile = useProfile();
  const firstName = profile.full_name.split(' ')[0] ?? profile.full_name;
  return (
    <>
      <PageHeader title={tr.home.greeting(firstName)} subtitle={tr.app.clubName} />
      <InstallBanner to="/uye/profil" />
      <EmptyState icon={CalendarX} title={tr.home.noUpcomingTitle} body={tr.home.noUpcomingBody} />
    </>
  );
}

export const MemberTrainingsPage = () => <ComingSoon title={tr.nav.trainings} />;
export const MemberStatsPage = () => <ComingSoon title={tr.nav.stats} />;

export function MemberProfilePage() {
  return (
    <>
      <PageHeader title={tr.profile.title} />
      <ProfilePanel />
    </>
  );
}
