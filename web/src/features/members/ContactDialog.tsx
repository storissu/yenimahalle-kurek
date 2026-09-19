import { Phone, UserRound } from 'lucide-react';
import { Link } from 'react-router';
import { Dialog } from '@/components/ui/Dialog';
import { tr } from '@/strings/tr';
import { telHref } from './contact';

export interface Contact {
  /** The member's id, when known (adds a link to their profile). */
  id?: string;
  name: string;
  phone: string | null;
}

/**
 * A club member's contact card: their name and phone number (with a "call" link) and, when the id is known, a link to
 * their profile. Any signed-in member may see this — nothing else about the person is shown or loaded (see the
 * member_directory view).
 */
export function ContactDialog({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  const href = telHref(contact?.phone);
  return (
    <Dialog open={contact !== null} onClose={onClose} title={contact?.name ?? tr.contact.title}>
      {contact && (
        <div className="flex flex-col gap-3">
          {href ? (
            <a
              href={href}
              aria-label={`${tr.contact.call}: ${contact.name}, ${contact.phone ?? ''}`}
              className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3"
            >
              <Phone aria-hidden="true" size={22} className="shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-muted">{tr.contact.phone}</span>
                <span className="block text-lg font-bold tabular-nums">{contact.phone}</span>
              </span>
              <span className="font-semibold text-primary">{tr.contact.call}</span>
            </a>
          ) : (
            <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">{tr.contact.noPhone}</p>
          )}
          {contact.id && (
            <Link
              to={`/uye/uyeler/${contact.id}`}
              onClick={onClose}
              aria-label={tr.contact.openProfileLabel(contact.name)}
              className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border px-4 font-semibold text-primary"
            >
              <UserRound aria-hidden="true" size={18} />
              {tr.contact.openProfile}
            </Link>
          )}
        </div>
      )}
    </Dialog>
  );
}
