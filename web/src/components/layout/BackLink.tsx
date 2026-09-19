import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';

export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-primary">
      <ArrowLeft aria-hidden="true" size={18} />
      {children}
    </Link>
  );
}
