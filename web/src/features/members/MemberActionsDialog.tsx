import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Trash2, UserCheck, UserCog, UserX } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errors';
import { tr } from '@/strings/tr';
import type { Profile, UserRole } from '@/types/database';
import { deleteMember, memberNamesKey, membersKey, resetPassword, setMemberActive, setMemberRole, updateMemberPhone, type Credentials } from './api';

interface MemberActionsDialogProps {
  member: Profile | null;
  isSelf: boolean;
  onClose: () => void;
  onCredentials: (credentials: Credentials) => void;
}

type Pending = 'reset' | 'role' | 'deactivate' | 'delete' | null;

const PHONE_MAX = 30;

const otherRole = (role: UserRole): UserRole => (role === 'coach' ? 'member' : 'coach');

/** The member's phone number, editable. Remounted (keyed by member) every time the dialog opens. */
function PhoneField({ member }: { member: Profile }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState(member.phone ?? '');
  const [saved, setSaved] = useState(member.phone ?? '');
  const tooLong = value.trim().length > PHONE_MAX;
  const dirty = value.trim() !== saved;

  const save = useMutation({
    mutationFn: () => updateMemberPhone(member.id, value),
    onSuccess: () => {
      setSaved(value.trim());
      setValue(value.trim());
      void queryClient.invalidateQueries({ queryKey: membersKey });
      void queryClient.invalidateQueries({ queryKey: memberNamesKey }); // members see it in the directory
      toast.show(tr.members.phoneSaved, 'success');
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (dirty && !tooLong) save.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <TextField
        label={tr.members.phone}
        type="tel"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          save.reset();
        }}
        error={tooLong ? tr.members.phoneTooLong : undefined}
      />
      {save.isError && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {errorMessage(save.error)}
        </p>
      )}
      <Button type="submit" variant="secondary" fullWidth disabled={!dirty || tooLong} loading={save.isPending}>
        {tr.members.phoneSave}
      </Button>
    </form>
  );
}

export function MemberActionsDialog({ member, isSelf, onClose, onCredentials }: MemberActionsDialogProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<Pending>(null);

  const close = () => {
    setPending(null);
    reset.reset();
    toggle.reset();
    changeRole.reset();
    remove.reset();
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

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => setMemberRole(id, role),
    onSuccess: (_result, { role }) => {
      // The person moves between the member and the coach lists (directories, rosters, dümenci choices): refresh everything.
      void queryClient.invalidateQueries();
      toast.show(tr.members.roleChanged(tr.roles[role]), 'success');
      close();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteMember(id),
    onSuccess: () => {
      // The member disappears from lists, the directory, the leaderboard and every roster: refresh everything.
      void queryClient.invalidateQueries();
      toast.show(tr.members.deleted, 'success');
      close();
    },
  });

  const actionError = reset.error ?? toggle.error ?? changeRole.error ?? remove.error;

  return (
    <Dialog open={member !== null} onClose={close} title={tr.members.detailsTitle}>
      {member && (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-xl font-bold">{member.full_name}</p>
            <p className="font-mono text-sm text-muted">@{member.username}</p>
            <div className="flex flex-wrap gap-2">
              <Badge tone={member.role === 'coach' ? 'primary' : 'neutral'}>
                <span className="sr-only">{tr.members.roleLabel}: </span>
                {tr.roles[member.role]}
              </Badge>
              {!member.is_active && <Badge tone="danger">{tr.members.inactive}</Badge>}
              {isSelf && <Badge tone="success">{tr.members.you}</Badge>}
            </div>
          </div>

          {pending === null && <PhoneField key={member.id} member={member} />}

          {isSelf ? null : pending === null ? (
            <>
              <div className="flex flex-col gap-2">
                {member.is_active && (
                  <Button variant="secondary" fullWidth onClick={() => setPending('reset')}>
                    <KeyRound aria-hidden="true" size={18} />
                    {tr.members.resetPassword}
                  </Button>
                )}
                {member.is_active && (
                  <Button variant="secondary" fullWidth onClick={() => setPending('role')}>
                    <UserCog aria-hidden="true" size={18} />
                    {tr.members.changeRole}
                  </Button>
                )}
                {member.is_active ? (
                  <Button variant="secondary" fullWidth onClick={() => setPending('deactivate')}>
                    <UserX aria-hidden="true" size={18} />
                    {tr.members.deactivate}
                  </Button>
                ) : (
                  <Button fullWidth loading={toggle.isPending} onClick={() => toggle.mutate({ id: member.id, active: true })}>
                    <UserCheck aria-hidden="true" size={18} />
                    {tr.members.activate}
                  </Button>
                )}
              </div>

              {/* Deleting is permanent, so it lives apart from the everyday actions and looks different. */}
              <div className="flex flex-col gap-2 border-t border-danger pt-4">
                <p className="text-xs font-bold text-danger">{tr.members.dangerZone}</p>
                <button
                  type="button"
                  onClick={() => setPending('delete')}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-danger px-4 text-[15px] font-semibold text-danger"
                >
                  <Trash2 aria-hidden="true" size={18} />
                  {tr.members.delete}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <p
                role="alert"
                className={
                  pending === 'delete'
                    ? 'rounded-xl border-2 border-danger bg-danger-soft px-4 py-3 text-sm font-medium text-danger'
                    : 'rounded-xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning'
                }
              >
                {pending === 'role' ? (
                  <>
                    <span className="mb-1 block font-bold tabular-nums">
                      {tr.roles[member.role]} → {tr.roles[otherRole(member.role)]}
                    </span>
                    {member.role === 'member' ? tr.members.promoteConfirm : tr.members.demoteConfirm}
                  </>
                ) : pending === 'reset' ? (
                  tr.members.resetConfirm
                ) : pending === 'deactivate' ? (
                  tr.members.deactivateConfirm
                ) : (
                  tr.members.deleteConfirm
                )}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setPending(null)}>
                  {tr.common.cancel}
                </Button>
                <Button
                  variant={pending === 'reset' || pending === 'role' ? 'primary' : 'danger'}
                  className="flex-1"
                  loading={reset.isPending || toggle.isPending || changeRole.isPending || remove.isPending}
                  onClick={() =>
                    pending === 'reset'
                      ? reset.mutate(member.id)
                      : pending === 'role'
                        ? changeRole.mutate({ id: member.id, role: otherRole(member.role) })
                        : pending === 'delete'
                          ? remove.mutate(member.id)
                          : toggle.mutate({ id: member.id, active: false })
                  }
                >
                  {pending === 'delete' ? tr.members.deleteConfirmAction : pending === 'role' ? tr.members.changeRoleConfirmAction : tr.members.confirmAction}
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
