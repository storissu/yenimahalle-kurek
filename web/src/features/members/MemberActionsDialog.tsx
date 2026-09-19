import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errors';
import { tr } from '@/strings/tr';
import type { Profile } from '@/types/database';
import { membersKey, resetPassword, setMemberActive, type Credentials } from './api';

interface MemberActionsDialogProps {
  member: Profile | null;
  isSelf: boolean;
  onClose: () => void;
  onCredentials: (credentials: Credentials) => void;
}

type Pending = 'reset' | 'deactivate' | null;

export function MemberActionsDialog({ member, isSelf, onClose, onCredentials }: MemberActionsDialogProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);

  const close = () => {
    setPending(null);
    reset.reset();
    toggle.reset();
    onClose();
  };

  const reset = useMutation({
    mutationFn: (id: string) => resetPassword(id),
    onSuccess: (credentials) => {
      void queryClient.invalidateQueries({ queryKey: membersKey });
      setPending(null);
      onClose();
      onCredentials(credentials);
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setMemberActive(id, active),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: membersKey });
      toast.show(result.is_active ? tr.members.activated : tr.members.deactivated, 'success');
      close();
    },
  });

  const actionError = reset.error ?? toggle.error;

  return (
    <Dialog open={member !== null} onClose={close} title={tr.members.detailsTitle}>
      {member && (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-xl font-bold">{member.full_name}</p>
            <p className="font-mono text-sm text-muted">@{member.username}</p>
            <div className="flex flex-wrap gap-2">
              <Badge tone={member.role === 'coach' ? 'primary' : 'neutral'}>{tr.roles[member.role]}</Badge>
              {!member.is_active && <Badge tone="danger">{tr.members.inactive}</Badge>}
              {isSelf && <Badge tone="success">{tr.members.you}</Badge>}
            </div>
          </div>

          {isSelf ? null : pending === null ? (
            <div className="flex flex-col gap-2">
              {member.is_active && (
                <Button variant="secondary" fullWidth onClick={() => setPending('reset')}>
                  <KeyRound aria-hidden="true" size={18} />
                  {tr.members.resetPassword}
                </Button>
              )}
              {member.is_active ? (
                <Button variant="secondary" fullWidth onClick={() => setPending('deactivate')}>
                  <UserX aria-hidden="true" size={18} />
                  {tr.members.deactivate}
                </Button>
              ) : (
                <Button
                  fullWidth
                  loading={toggle.isPending}
                  onClick={() => toggle.mutate({ id: member.id, active: true })}
                >
                  <UserCheck aria-hidden="true" size={18} />
                  {tr.members.activate}
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p role="alert" className="rounded-xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
                {pending === 'reset' ? tr.members.resetConfirm : tr.members.deactivateConfirm}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setPending(null)}>
                  {tr.common.cancel}
                </Button>
                <Button
                  variant={pending === 'deactivate' ? 'danger' : 'primary'}
                  className="flex-1"
                  loading={reset.isPending || toggle.isPending}
                  onClick={() =>
                    pending === 'reset'
                      ? reset.mutate(member.id)
                      : toggle.mutate({ id: member.id, active: false })
                  }
                >
                  {tr.members.confirmAction}
                </Button>
              </div>
            </div>
          )}

          {actionError && (
            <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
              {errorMessage(actionError)}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
