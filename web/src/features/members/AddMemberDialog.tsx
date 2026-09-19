import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import { errorMessage } from '@/lib/errors';
import { isValidUsername, normalizeUsername } from '@/lib/username';
import { tr } from '@/strings/tr';
import { createMember, membersKey, type Credentials } from './api';

const schema = z.object({
  full_name: z.string().trim().min(2, tr.members.fullNameRequired).max(80),
  username: z
    .string()
    .transform(normalizeUsername)
    .refine(isValidUsername, tr.members.usernameInvalid),
  phone: z.string().trim().max(30).optional(),
  role: z.enum(['member', 'coach']),
});
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

interface AddMemberDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (credentials: Credentials) => void;
}

export function AddMemberDialog({ open, onClose, onCreated }: AddMemberDialogProps) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: '', username: '', phone: '', role: 'member' },
  });

  const mutation = useMutation({
    mutationFn: createMember,
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: membersKey });
      reset();
      onCreated({ username: created.username, password: created.password });
    },
  });

  const close = () => {
    mutation.reset();
    onClose();
  };

  const onSubmit = handleSubmit((values) =>
    mutation.mutateAsync({
      full_name: values.full_name,
      username: values.username,
      role: values.role,
      ...(values.phone ? { phone: values.phone } : {}),
    }).catch(() => undefined),
  );

  return (
    <Dialog open={open} onClose={close} title={tr.members.createTitle}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label={tr.members.fullName}
          autoComplete="off"
          autoCapitalize="words"
          error={errors.full_name?.message}
          {...register('full_name')}
        />
        <TextField
          label={tr.auth.username}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          hint={tr.members.usernameHint}
          error={errors.username?.message}
          {...register('username')}
        />
        <TextField
          label={`${tr.members.phone} (${tr.common.optional})`}
          type="tel"
          autoComplete="off"
          hint={tr.members.phoneHint}
          error={errors.phone?.message}
          {...register('phone')}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-member-role" className="text-sm font-semibold">
            {tr.members.roleLabel}
          </label>
          <select
            id="new-member-role"
            className="min-h-12 rounded-xl border border-border bg-surface px-3.5 text-fg"
            {...register('role')}
          >
            <option value="member">{tr.roles.member}</option>
            <option value="coach">{tr.roles.coach}</option>
          </select>
        </div>

        {mutation.isError && (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
            {errorMessage(mutation.error)}
          </p>
        )}

        <Button type="submit" size="lg" fullWidth loading={mutation.isPending}>
          {mutation.isPending ? tr.members.creating : tr.members.create}
        </Button>
      </form>
    </Dialog>
  );
}
