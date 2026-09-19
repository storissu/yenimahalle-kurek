import { ChevronRight, MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Users } from 'lucide-react';
import { useNow } from '@/lib/clock';
import { tr } from '@/strings/tr';
import type { Profile, Training, TrainingResponse } from '@/types/database';
import { fetchMembers, membersKey } from '../members/api';
import { useQuery } from '@tanstack/react-query';
import { CoachRsvpDialog } from './CoachRsvpDialog';
import { useTrainingResponses } from './hooks';
import { formatCountdown, groupRoster, rsvpWindow } from './schedule';

type Member = Pick<Profile, 'id' | 'full_name'>;

interface PanelViewProps {
  training: Training;
  members: Member[];
  responses: TrainingResponse[];
  now: Date;
  /** Omit to make the list read-only (cancelled / completed trainings). */
  onEdit?: (member: Member) => void;
}

function MemberRow({ member, response, onEdit }: { member: Member; response?: TrainingResponse; onEdit?: () => void }) {
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{member.full_name}</p>
        {response?.note && (
          <p className="mt-0.5 flex items-start gap-1.5 text-sm text-muted">
            <MessageSquareText aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
            <span className="break-words">{response.note}</span>
          </p>
        )}
        {response?.set_by_coach && (
          <div className="mt-1">
            <Badge>{tr.responses.coachEntered}</Badge>
          </div>
        )}
      </div>
      {onEdit && <ChevronRight aria-hidden="true" size={18} className="shrink-0 text-muted" />}
    </>
  );
  if (!onEdit) return <div className="flex min-h-14 w-full items-center gap-3 px-1 py-2">{content}</div>;
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={tr.responses.rowAction(member.full_name)}
      className="flex min-h-14 w-full items-center gap-3 px-1 py-2 text-left"
    >
      {content}
    </button>
  );
}

function Group({ heading, count, tone, children }: { heading: string; count: number; tone: 'success' | 'neutral' | 'warning'; children: React.ReactNode }) {
  return (
    <section aria-label={`${heading} (${count})`}>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
        {heading}
        <Badge tone={tone}>{count}</Badge>
      </h3>
      {count === 0 ? <p className="px-1 pb-2 text-sm text-muted">{tr.responses.nobody}</p> : <Card className="divide-y divide-border px-3 py-1">{children}</Card>}
    </section>
  );
}

/** Presentational: the roster grouped by answer. */
export function ResponsesPanelView({ training, members, responses, now, onEdit }: PanelViewProps) {
  const groups = groupRoster(members, responses);
  const window = rsvpWindow(training, now);
  const editable = training.status === 'scheduled' ? onEdit : undefined;

  return (
    <div className="flex flex-col gap-5">
      {window.kind === 'open' && (
        <p className="text-sm text-muted">{tr.responses.deadlineOpen(formatCountdown(window.msLeft))}</p>
      )}
      {window.kind === 'locked' && <p className="text-sm font-semibold text-warning">{tr.responses.deadlineClosed}</p>}

      <Group heading={tr.responses.attendingHeading} count={groups.attending.length} tone="success">
        {groups.attending.map(({ member, response }) => (
          <MemberRow key={member.id} member={member} response={response} onEdit={editable && (() => editable(member))} />
        ))}
      </Group>
      <Group heading={tr.responses.notAttendingHeading} count={groups.notAttending.length} tone="neutral">
        {groups.notAttending.map(({ member, response }) => (
          <MemberRow key={member.id} member={member} response={response} onEdit={editable && (() => editable(member))} />
        ))}
      </Group>
      <Group heading={tr.responses.noResponseHeading} count={groups.noResponse.length} tone="warning">
        {groups.noResponse.map((member) => (
          <MemberRow key={member.id} member={member} onEdit={editable && (() => editable(member))} />
        ))}
      </Group>
    </div>
  );
}

/** Coach's "Yanıtlar" tab: loads the roster + answers and lets the coach answer on a member's behalf. */
export function ResponsesPanel({ training }: { training: Training }) {
  const now = useNow();
  const roster = useQuery({ queryKey: membersKey, queryFn: fetchMembers });
  const responses = useTrainingResponses(training.id);
  const [editing, setEditing] = useState<Member | null>(null);

  if (roster.isPending || responses.isPending) {
    return (
      <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }
  if (roster.isError || responses.isError) {
    return (
      <ErrorState
        message={tr.responses.loadError}
        onRetry={() => {
          void roster.refetch();
          void responses.refetch();
        }}
      />
    );
  }

  const members = roster.data.filter((p) => p.role === 'member' && p.is_active);
  if (members.length === 0) return <EmptyState icon={Users} title={tr.members.emptyTitle} body={tr.responses.noMembers} />;

  return (
    <>
      <ResponsesPanelView training={training} members={members} responses={responses.data} now={now} onEdit={setEditing} />
      <CoachRsvpDialog
        training={training}
        member={editing}
        current={editing ? responses.data.find((r) => r.member_id === editing.id) : undefined}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
