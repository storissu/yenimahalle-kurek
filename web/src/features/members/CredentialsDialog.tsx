import { Copy, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { tr } from '@/strings/tr';
import type { Credentials } from './api';

interface CredentialsDialogProps {
  credentials: Credentials | null;
  title?: string;
  onClose: () => void;
}

/**
 * Shows a one-time password. It lives only in this dialog's props/state and disappears on close —
 * the server never stores or returns it again.
 */
export function CredentialsDialog({ credentials, title = tr.members.credentialsTitle, onClose }: CredentialsDialogProps) {
  const toast = useToast();

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(tr.common.copied, 'success');
    } catch {
      toast.show(tr.common.errorGeneric, 'error');
    }
  };

  const invite = credentials
    ? tr.members.inviteMessage(window.location.origin, credentials.username, credentials.password)
    : '';

  return (
    <Dialog open={credentials !== null} onClose={onClose} title={title}>
      {credentials && (
        <>
          <p role="alert" className="rounded-xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
            {tr.members.credentialsWarning}
          </p>

          <dl className="flex flex-col gap-3 rounded-xl bg-surface-2 p-4">
            <div>
              <dt className="text-xs font-semibold text-muted">{tr.members.credentialsUsername}</dt>
              <dd className="break-all font-mono text-lg font-bold">{credentials.username}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted">{tr.members.credentialsPassword}</dt>
              <dd className="break-all font-mono text-2xl font-bold tracking-wider">{credentials.password}</dd>
            </div>
          </dl>

          <div className="flex flex-col gap-2">
            <Button onClick={() => void copy(invite)} fullWidth>
              <Copy aria-hidden="true" size={18} />
              {tr.members.copyInvite}
            </Button>
            {typeof navigator.share === 'function' && (
              <Button variant="secondary" fullWidth onClick={() => void navigator.share({ text: invite }).catch(() => undefined)}>
                <Share2 aria-hidden="true" size={18} />
                {tr.common.share}
              </Button>
            )}
            <Button variant="ghost" fullWidth onClick={onClose}>
              {tr.common.close}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
