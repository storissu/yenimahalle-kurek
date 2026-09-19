import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { loginErrorMessage } from '@/lib/errors';
import { tr } from '@/strings/tr';
import { useAuth } from './AuthProvider';

const schema = z.object({
  username: z.string().trim().min(1, tr.auth.usernameRequired),
  password: z.string().min(1, tr.auth.passwordRequired),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { signIn } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { username: '', password: '' } });

  const onSubmit = handleSubmit(async ({ username, password }) => {
    setFormError(null);
    try {
      await signIn(username, password);
      // On success the access gate redirects to the right home screen.
    } catch (error) {
      setFormError(loginErrorMessage(error));
    }
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <header className="flex flex-col items-center gap-3 text-center">
        <img src="/pwa-192x192.png" alt="" width={72} height={72} className="rounded-2xl" />
        <div>
          <h1 className="text-2xl font-bold">{tr.auth.loginTitle}</h1>
          <p className="mt-1 text-sm text-muted">{tr.app.clubName}</p>
        </div>
      </header>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label={tr.auth.username}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          error={errors.username?.message}
          {...register('username')}
        />
        <TextField
          label={tr.auth.password}
          type="password"
          revealable
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />

        {formError && (
          <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
            {formError}
          </p>
        )}

        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          {isSubmitting ? tr.auth.submitting : tr.auth.submit}
        </Button>
      </form>

      <p className="text-center text-sm text-muted">{tr.auth.noAccount}</p>
      <p className="text-center text-sm">
        <Link to="/gizlilik" className="text-primary underline">
          {tr.profile.privacy}
        </Link>
      </p>
    </main>
  );
}
