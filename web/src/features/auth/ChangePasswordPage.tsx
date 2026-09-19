import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { passwordChangeErrorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { tr } from '@/strings/tr';
import { homeFor } from './access';
import { useAuth, useProfile } from './AuthProvider';

// Mirrors the Supabase Auth policy configured for the project (min 8, letters + digits).
export const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, tr.auth.passwordTooShort)
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), tr.auth.passwordNeedsLetterAndDigit),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: tr.auth.passwordMismatch });

type FormValues = z.infer<typeof newPasswordSchema>;

export function ChangePasswordPage() {
  const profile = useProfile();
  const { refreshProfile } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const forced = profile.must_change_password;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: '', confirm: '' } });

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      const { error: flagError } = await supabase.rpc('complete_password_change');
      if (flagError) throw flagError;
      await refreshProfile();
      toast.show(tr.auth.passwordChanged, 'success');
      navigate(homeFor(profile.role), { replace: true });
    } catch (error) {
      setFormError(passwordChangeErrorMessage(error));
    }
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{tr.auth.changePasswordTitle}</h1>
        {forced && <p className="text-sm text-muted">{tr.auth.changePasswordForced}</p>}
      </header>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label={tr.auth.newPassword}
          type="password"
          revealable
          autoComplete="new-password"
          hint={tr.auth.passwordRules}
          error={errors.password?.message}
          {...register('password')}
        />
        <TextField
          label={tr.auth.confirmPassword}
          type="password"
          revealable
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...register('confirm')}
        />

        {formError && (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
            {formError}
          </p>
        )}

        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          {isSubmitting ? tr.auth.saving : tr.auth.savePassword}
        </Button>
      </form>

      {!forced && (
        <p className="text-center text-sm">
          <Link to={homeFor(profile.role)} className="text-primary underline">
            {tr.common.cancel}
          </Link>
        </p>
      )}
    </main>
  );
}
