import { Link } from 'react-router';
import { tr } from '@/strings/tr';

export function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-bold">{tr.notFound.title}</h1>
      <p className="text-muted">{tr.notFound.body}</p>
      <Link to="/" className="mt-2 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 font-semibold text-primary-fg">
        {tr.notFound.home}
      </Link>
    </main>
  );
}
