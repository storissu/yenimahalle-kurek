import { MessageSquareText } from 'lucide-react';
import { BackLink } from '@/components/layout/BackLink';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { envResult } from '@/lib/env';
import { help } from '@/strings/help';
import { tr } from '@/strings/tr';

type Role = 'member' | 'coach';

/** The optional feedback address (a WhatsApp link or a form), from the VITE_FEEDBACK_URL build variable. */
export const configuredFeedbackUrl = (): string | undefined => (envResult.ok ? envResult.env.VITE_FEEDBACK_URL : undefined);

/**
 * Profil → Yardım (members) / Diğer → Yardım (coaches): plain-language answers to the questions a pilot group asks
 * first, plus an optional link for feedback. Native <details> keeps it accessible without any script.
 */
export function HelpPage({ role, feedbackUrl = configuredFeedbackUrl() }: { role: Role; feedbackUrl?: string }) {
  const items = role === 'coach' ? help.coach : help.member;
  return (
    <>
      <BackLink to={role === 'coach' ? '/antrenor/diger' : '/uye/profil'}>{role === 'coach' ? tr.more.title : tr.profile.title}</BackLink>
      <PageHeader title={help.title} subtitle={role === 'coach' ? help.coachIntro : help.memberIntro} />

      <div className="flex flex-col gap-4">
        <Card className="flex items-start gap-3">
          <MessageSquareText aria-hidden="true" size={22} className="mt-0.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h2 className="font-bold">{help.feedbackTitle}</h2>
            <p className="text-sm text-muted">{feedbackUrl ? help.feedbackBody : help.feedbackNone}</p>
            {feedbackUrl && (
              <a
                href={feedbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-semibold text-primary-fg"
              >
                {help.feedbackAction}
              </a>
            )}
          </div>
        </Card>

        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.q}>
              <details className="group rounded-2xl border border-border bg-surface">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
                  <span>{item.q}</span>
                  <span aria-hidden="true" className="text-xl leading-none text-muted transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="px-4 pb-4 text-sm leading-relaxed">{item.a}</p>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
