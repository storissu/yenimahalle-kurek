import { createRoot } from 'react-dom/client';
import { tr } from '@/strings/tr';

/** Shown instead of the app when required environment variables are missing/invalid (development aid). */
export function renderConfigError(container: HTMLElement, issues: string[]): void {
  createRoot(container).render(
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-5 py-10">
      <h1 className="text-2xl font-bold">{tr.config.title}</h1>
      <p className="text-muted">{tr.config.body}</p>
      <ul className="list-disc space-y-1 rounded-xl bg-danger-soft py-4 pl-8 pr-4 text-sm font-medium text-danger">
        {issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    </main>,
  );
}
