import type { LucideIcon } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { cn } from '@/lib/cn';
import { useOnlineStatus } from '@/lib/useOnlineStatus';
import { tr } from '@/strings/tr';
import { useAppBadge } from '@/features/notifications/hooks';
import { useServerClockSync } from '@/features/trainings/hooks';
import { SkipLink } from './RouteAccessibility';
import { UpdateBanner } from './UpdateBanner';

export interface Tab {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Mobile-first frame: scrolling content + fixed bottom tab bar that respects the iPhone home indicator. */
export function AppShell({ tabs }: { tabs: Tab[] }) {
  const online = useOnlineStatus();
  useServerClockSync(); // aligns countdowns/locks with the server clock (see lib/clock.ts)
  useAppBadge(); // unread count on the app icon

  return (
    <div className="mx-auto min-h-dvh w-full max-w-xl">
      <SkipLink />
      {!online && (
        <div role="status" className="bg-warning-soft px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-center text-sm font-medium text-warning">
          {tr.common.offline}
        </div>
      )}

      <main id="main" tabIndex={-1} className="px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]">
        <Outlet />
      </main>

      <UpdateBanner />

      <nav
        aria-label={tr.nav.mainNav}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]"
      >
        <ul className="mx-auto flex max-w-xl">
          {tabs.map(({ to, label, icon: Icon, end }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold',
                    isActive ? 'text-primary' : 'text-muted',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={cn('flex h-7 w-12 items-center justify-center rounded-full', isActive && 'bg-primary-soft')}>
                      <Icon aria-hidden="true" size={22} />
                    </span>
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
