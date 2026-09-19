import { CalendarDays, Ellipsis, House, LayoutDashboard, Trophy, UserRound, Users } from 'lucide-react';
import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell, type Tab } from '@/components/layout/AppShell';
import { AccessGate } from '@/features/auth/AccessGate';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { BoatsPage } from '@/features/boats/BoatsPage';
import { MembersPage } from '@/features/members/MembersPage';
import {
  CoachDashboardPage,
  CoachMorePage,
  CoachStatsPage,
  CoachTrainingDetailPage,
  CoachTrainingFormPage,
  CoachTrainingsPage,
} from '@/pages/coach/CoachPages';
import {
  MemberHomePage,
  MemberProfilePage,
  MemberStatsPage,
  MemberTrainingDetailPage,
  MemberTrainingsPage,
} from '@/pages/member/MemberPages';
import { NotFoundPage } from '@/pages/shared/NotFoundPage';
import { PrivacyPage } from '@/pages/shared/PrivacyPage';
import { tr } from '@/strings/tr';

const memberTabs: Tab[] = [
  { to: '/uye', label: tr.nav.home, icon: House, end: true },
  { to: '/uye/antrenmanlar', label: tr.nav.trainings, icon: CalendarDays },
  { to: '/uye/istatistik', label: tr.nav.stats, icon: Trophy },
  { to: '/uye/profil', label: tr.nav.profile, icon: UserRound },
];

const coachTabs: Tab[] = [
  { to: '/antrenor', label: tr.nav.dashboard, icon: LayoutDashboard, end: true },
  { to: '/antrenor/antrenmanlar', label: tr.nav.trainings, icon: CalendarDays },
  { to: '/antrenor/uyeler', label: tr.nav.members, icon: Users },
  { to: '/antrenor/istatistik', label: tr.nav.stats, icon: Trophy },
  { to: '/antrenor/diger', label: tr.nav.more, icon: Ellipsis },
];

export const router = createBrowserRouter([
  {
    // Every route sits behind the access gate (login / forced password change / role home).
    element: <AccessGate />,
    children: [
      { path: '/', element: <Navigate to="/giris" replace /> },
      { path: '/giris', element: <LoginPage /> },
      { path: '/sifre-degistir', element: <ChangePasswordPage /> },
      { path: '/gizlilik', element: <PrivacyPage /> },
      {
        path: '/uye',
        element: <AppShell tabs={memberTabs} />,
        children: [
          { index: true, element: <MemberHomePage /> },
          { path: 'antrenmanlar', element: <MemberTrainingsPage /> },
          { path: 'antrenmanlar/:id', element: <MemberTrainingDetailPage /> },
          { path: 'istatistik', element: <MemberStatsPage /> },
          { path: 'profil', element: <MemberProfilePage /> },
        ],
      },
      {
        path: '/antrenor',
        element: <AppShell tabs={coachTabs} />,
        children: [
          { index: true, element: <CoachDashboardPage /> },
          { path: 'antrenmanlar', element: <CoachTrainingsPage /> },
          { path: 'antrenmanlar/yeni', element: <CoachTrainingFormPage mode="create" /> },
          { path: 'antrenmanlar/:id', element: <CoachTrainingDetailPage /> },
          { path: 'antrenmanlar/:id/duzenle', element: <CoachTrainingFormPage mode="edit" /> },
          { path: 'uyeler', element: <MembersPage /> },
          { path: 'istatistik', element: <CoachStatsPage /> },
          { path: 'diger', element: <CoachMorePage /> },
          { path: 'diger/tekneler', element: <BoatsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
