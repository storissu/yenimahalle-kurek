import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Phone, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { matchesQuery } from '@/lib/search';
import { tr } from '@/strings/tr';
import { useProfile } from '../auth/AuthProvider';
import { fetchMemberNames, memberNamesKey } from './api';
import { telHref } from './contact';

/**
 * The "Üyeler" tab for members: every active member's name and phone number, so training partners can reach each
 * other. A row opens that member's profile; the phone icon calls. It reads the member_directory view, which holds
 * nothing else (no username, role or status).
 */
export function MemberDirectoryPage() {
  const me = useProfile();
  const [search, setSearch] = useState('');
  const directory = useQuery({ queryKey: memberNamesKey, queryFn: fetchMemberNames, staleTime: 5 * 60_000 });

  const sorted = useMemo(() => [...(directory.data ?? [])].sort((a, b) => a.full_name.localeCompare(b.full_name, 'tr')), [directory.data]);
  const filtered = useMemo(() => sorted.filter((m) => matchesQuery([m.full_name], search)), [sorted, search]);

  return (
    <>
      <PageHeader title={tr.nav.members} />

      <div className="relative mb-4">
        <label htmlFor="directory-search" className="sr-only">
          {tr.contact.searchLabel}
        </label>
        <Search aria-hidden="true" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          id="directory-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tr.contact.searchPlaceholder}
          autoComplete="off"
          className="min-h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-3.5 text-fg placeholder:text-muted"
        />
      </div>

      {directory.isPending && (
        <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}
      {directory.isError && <ErrorState message={tr.contact.loadError} onRetry={() => void directory.refetch()} />}
      {directory.isSuccess && sorted.length === 0 && <EmptyState icon={Users} title={tr.contact.emptyTitle} body={tr.contact.emptyBody} />}
      {directory.isSuccess && sorted.length > 0 && filtered.length === 0 && <p className="py-8 text-center text-sm text-muted">{tr.contact.noResults}</p>}

      {filtered.length > 0 && (
        <ul className="flex flex-col gap-3">
          {filtered.map((m) => {
            const href = telHref(m.phone);
            return (
              <li key={m.id} className="flex min-h-16 items-center gap-2 rounded-2xl border border-border bg-surface pr-3">
                {m.id === me.id ? (
                  <div className="min-w-0 flex-1 px-4 py-3">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {m.full_name}
                      <Badge tone="primary">{tr.members.you}</Badge>
                    </p>
                    <p className="text-sm tabular-nums text-muted">{m.phone ?? '—'}</p>
                  </div>
                ) : (
                  <Link to={`/uye/uyeler/${m.id}`} aria-label={tr.contact.openProfileLabel(m.full_name)} className="flex min-h-16 min-w-0 flex-1 items-center gap-2 rounded-2xl px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{m.full_name}</span>
                      <span className="block text-sm tabular-nums text-muted">{m.phone ?? '—'}</span>
                    </span>
                    <ChevronRight aria-hidden="true" size={20} className="shrink-0 text-muted" />
                  </Link>
                )}
                {href && (
                  <a
                    href={href}
                    aria-label={tr.contact.callLabel(m.full_name)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"
                  >
                    <Phone aria-hidden="true" size={20} />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
