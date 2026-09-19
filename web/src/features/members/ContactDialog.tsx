import { Phone } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { tr } from '@/strings/tr';
import { telHref } from './contact';

export interface Contact {
  name: string;
  phone: string | null;
}

/**
 * A club member's contact card: their name and phone number (with a "call" link). Any signed-in member may see
 * this — nothing else about the person is shown or loaded (see the member_directory view).
 */
export function ContactDialog({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  const href = telHref(contact?.phone);
  return (
    <Dialog open={contact !== null} onClose={onClose} title={contact?.name ?? tr.contact.title}>
      {contact &&
        (href ? (
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
        ))}
    </Dialog>
  );
}
