import { ChevronRight, LogOut } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { useAuth, useProfile } from '@/features/auth/AuthProvider';
import { InstallGuide } from '@/features/install/InstallGuide';
import { PushSettings } from '@/features/notifications/PushSettings';
import { errorMessage } from '@/lib/errors';
import { help } from '@/strings/help';
import { tr } from '@/strings/tr';

function LinkRow({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="flex min-h-12 items-center justify-between gap-3 px-1 font-medium">
      {label}
      <ChevronRight aria-hidden="true" size={20} className="text-muted" />
    </Link>
  );
}

/** Account, push settings, install guide, help, password and logout — shared by the member Profile tab and the coach "Diğer" tab. Members and notifications have their own entry points (Üyeler tab, the bell). */
export function ProfilePanel() {
  const profile = useProfile();
  const { signOut } = useAuth();
  const toast = useToast();

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-muted">{tr.profile.account}</p>
        <p className="text-xl font-bold">{profile.full_name}</p>
        <p className="font-mono text-sm text-muted">@{profile.username}</p>
        <div className="mt-1">
          <Badge tone={profile.role === 'coach' ? 'primary' : 'neutral'}>{tr.roles[profile.role]}</Badge>
        </div>
      </Card>

      <PushSettings />
      <InstallGuide />

      <Card className="divide-y divide-border py-1">
        <LinkRow to={profile.role === 'coach' ? '/antrenor/diger/yardim' : '/uye/yardim'} label={help.link} />
        <LinkRow to="/sifre-degistir" label={tr.profile.changePassword} />
        <LinkRow to="/gizlilik" label={tr.profile.privacy} />
      </Card>

      <Button
        variant="secondary"
        fullWidth
        onClick={() => void signOut().catch((error: unknown) => toast.show(errorMessage(error), 'error'))}
      >
        <LogOut aria-hidden="true" size={18} />
        {tr.auth.logout}
      </Button>

      <p className="text-center text-xs text-muted">
        {tr.profile.version} {__APP_VERSION__}
      </p>
    </div>
  );
}
