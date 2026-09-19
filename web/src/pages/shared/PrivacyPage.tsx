import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { tr } from '@/strings/tr';

/** Reachable before login too (linked from the login screen). Text is a draft for the club to approve. */
export function PrivacyPage() {
  const navigate = useNavigate();
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <Button variant="ghost" onClick={() => void navigate(-1)} className="-ml-3 mb-2">
        <ArrowLeft aria-hidden="true" size={18} />
        {tr.common.close}
      </Button>
      <h1 className="mb-2 text-2xl font-bold">{tr.privacy.title}</h1>
      <p className="mb-6 rounded-xl bg-warning-soft px-4 py-3 text-sm font-medium text-warning">{tr.privacy.draftNotice}</p>
      <div className="flex flex-col gap-5">
        {tr.privacy.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="mb-1 font-semibold">{section.heading}</h2>
            <p className="text-sm text-muted">{section.body}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
