import { Navigate, Outlet, useLocation } from 'react-router';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Spinner } from '@/components/ui/Spinner';
import { tr } from '@/strings/tr';
import { resolveAccess } from './access';
import { useAuth } from './AuthProvider';

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6">{children}</div>;
}

/** Wraps every route: decides whether to show the page, wait, or redirect (login / forced password change / role home). */
export function AccessGate() {
  const { state, signOut, retry } = useAuth();
  const { pathname } = useLocation();
  const access = resolveAccess(state, pathname);

  switch (access.type) {
    case 'wait':
      return (
        <FullScreen>
          <div role="status" className="flex items-center gap-3 text-muted">
            <Spinner />
            <span>{tr.app.loading}</span>
          </div>
        </FullScreen>
      );
    case 'error':
      return (
        <FullScreen>
          <div className="w-full max-w-sm">
            <ErrorState message={tr.common.errorNetwork} onRetry={retry} />
          </div>
        </FullScreen>
      );
    case 'blocked':
      return (
        <FullScreen>
          <div className="flex w-full max-w-sm flex-col gap-4 text-center">
            <h1 className="text-xl font-bold">{tr.auth.blockedTitle}</h1>
            <p className="text-muted">{tr.auth.blockedBody}</p>
            <Button onClick={() => void signOut()}>{tr.auth.logout}</Button>
          </div>
        </FullScreen>
      );
    case 'redirect':
      return <Navigate to={access.to} replace />;
    case 'allow':
      return <Outlet />;
  }
}
