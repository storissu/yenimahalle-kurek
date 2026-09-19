import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Search, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { errorMessage } from '@/lib/errors';
import { tr } from '@/strings/tr';
import type { Profile } from '@/types/database';
import { useProfile } from '../auth/AuthProvider';
import { AddMemberDialog } from './AddMemberDialog';
import { fetchMembers, membersKey, type Credentials } from './api';
import { CredentialsDialog } from './CredentialsDialog';
import { MemberActionsDialog } from './MemberActionsDialog';

/** Case- and Turkish-diacritic-insensitive contains (so "isik" finds "Işık"). */
export function matchesSearch(member: Pick<Profile, 'full_name' | 'username'>, query: string): boolean {
  const fold = (s: string) =>
    s
      .toLocaleLowerCase('tr')
      .replaceAll('ı', 'i')
      .replaceAll('ğ', 'g')
      .replaceAll('ü', 'u')
      .replaceAll('ş', 's')
      .replaceAll('ö', 'o')
      .replaceAll('ç', 'c');
  const q = fold(query.trim());
  if (!q) return true;
  return fold(member.full_name).includes(q) || fold(member.username).includes(q);
}

export function MembersPage() {
  const me = useProfile();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [credentials, setCredentials] = useState<{ value: Credentials; title?: string } | null>(null);

  const members = useQuery({ queryKey: membersKey, queryFn: fetchMembers });
  const filtered = useMemo(() => (members.data ?? []).filter((m) => matchesSearch(m, search)), [members.data, search]);

  return (
    <>
      <PageHeader
        title={tr.members.title}
        action={
          <Button onClick={() => setAdding(true)}>
            <UserPlus aria-hidden="true" size={18} />
            {tr.members.add}
          </Button>
        }
      />

      <div className="relative mb-4">
        <label htmlFor="member-search" className="sr-only">
          {tr.members.searchPlaceholder}
        </label>
        <Search aria-hidden="true" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          id="member-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tr.members.searchPlaceholder}
          autoComplete="off"
          className="min-h-12 w-full rounded-xl border border-border bg-surface pl-10 pr-3.5 text-fg placeholder:text-muted"
        />
      </div>

      {members.isPending && (
        <div className="flex flex-col gap-3" role="status" aria-label={tr.app.loading}>
          <Skeleton className="h-[72px]" />
          <Skeleton className="h-[72px]" />
          <Skeleton className="h-[72px]" />
        </div>
      )}

      {members.isError && <ErrorState message={`${tr.members.loadError} ${errorMessage(members.error)}`} onRetry={() => void members.refetch()} />}

      {members.isSuccess && members.data.length === 0 && (
        <EmptyState
          icon={Users}
          title={tr.members.emptyTitle}
          body={tr.members.emptyBody}
          action={<Button onClick={() => setAdding(true)}>{tr.members.add}</Button>}
        />
      )}

      {members.isSuccess && members.data.length > 0 && filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">{tr.members.noResults}</p>
      )}

      {filtered.length > 0 && (
        <ul className="flex flex-col gap-3">
          {filtered.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setSelected(m)}
                className="flex min-h-[72px] w-full items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{m.full_name}</p>
                  <p className="truncate font-mono text-sm text-muted">@{m.username}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 empty:hidden">
                    {m.role === 'coach' && <Badge tone="primary">{tr.roles.coach}</Badge>}
                    {!m.is_active && <Badge tone="danger">{tr.members.inactive}</Badge>}
                    {m.is_active && m.must_change_password && <Badge tone="warning">{tr.members.neverLoggedIn}</Badge>}
                  </div>
                </div>
                <ChevronRight aria-hidden="true" size={20} className="shrink-0 text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddMemberDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(created) => {
          setAdding(false);
          setCredentials({ value: created });
        }}
      />
      <MemberActionsDialog
        member={selected}
        isSelf={selected?.id === me.id}
        onClose={() => setSelected(null)}
        onCredentials={(value) => setCredentials({ value, title: tr.members.resetDone })}
      />
      <CredentialsDialog
        credentials={credentials?.value ?? null}
        {...(credentials?.title ? { title: credentials.title } : {})}
        onClose={() => setCredentials(null)}
      />
    </>
  );
}
