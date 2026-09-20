import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Phone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errors';
import { tr } from '@/strings/tr';
import { useAuth, useProfile } from '../auth/AuthProvider';
import { memberNamesKey, membersKey, updateMyPhone } from './api';
import { checkPhone } from './phone';

/**
 * The signed-in person's own phone number on their profile: shown, and editable in place. The other members see this
 * number (crew cards, the member list), which the hint says. Saving changes the phone and nothing else.
 */
export function MyPhone() {
  const profile = useProfile();
  const { refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const check = checkPhone(value);
  const unchanged = value.trim() === (profile.phone ?? '');
  const problem = check === 'invalid' ? tr.profile.phoneInvalid : check === 'too-long' ? tr.members.phoneTooLong : undefined;

  const save = useMutation({
    mutationFn: () => updateMyPhone(value),
    onSuccess: async () => {
      await refreshProfile();
      void queryClient.invalidateQueries({ queryKey: memberNamesKey }); // the member list shows it too
      void queryClient.invalidateQueries({ queryKey: membersKey });
      toast.show(tr.members.phoneSaved, 'success');
      setEditing(false);
    },
  });

  const open = () => {
    setValue(profile.phone ?? '');
    save.reset();
    setEditing(true);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (check === 'ok' && !unchanged) save.mutate();
  };

  if (!editing) {
    return (
      <div className="mt-2 flex items-center gap-3 border-t border-border pt-3">
        <Phone aria-hidden="true" size={20} className="shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted">{tr.members.phone}</p>
          <p className={profile.phone ? 'font-bold tabular-nums' : 'text-sm text-muted'}>{profile.phone ?? tr.profile.phoneEmpty}</p>
        </div>
        <button
          type="button"
          onClick={open}
          aria-label={tr.profile.editPhone}
          className="flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold text-primary"
        >
          <Pencil aria-hidden="true" size={16} />
          {tr.common.edit}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mt-2 flex flex-col gap-3 border-t border-border pt-3">
      <TextField
        label={tr.members.phone}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        autoFocus
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          save.reset();
        }}
        hint={tr.members.phoneHint}
        error={problem}
      />
      {save.isError && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
          {errorMessage(save.error)}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
          {tr.common.cancel}
        </Button>
        <Button type="submit" loading={save.isPending} disabled={check !== 'ok' || unchanged}>
          {tr.common.save}
        </Button>
      </div>
    </form>
  );
}
