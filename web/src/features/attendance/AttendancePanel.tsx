import { useQuery } from '@tanstack/react-query';
import { CircleCheck, CircleX, ClipboardCheck, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useBlocker } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useNow } from '@/lib/clock';
import { cn } from '@/lib/cn';
import { radioGroupKeys, radioTabIndex } from '@/lib/radioGroup';
import { errorMessage } from '@/lib/errors';
import { formatTime } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { AttendanceRecord, Profile, Training } from '@/types/database';
import { useBoats, useProgram } from '../program/hooks';
import { fetchMembers, membersKey } from '../members/api';
import { useTrainingResponses } from '../trainings/hooks';
import { sessionTimes } from '../trainings/schedule';
import { useSaveAttendance, useTrainingAttendance } from './hooks';
import {
  addSession,
  addWalkIn,
  canAddSession,
  hasAnyRow,
  initialDraft,
  isSameDraft,
  plannedFrom,
  removeLastSession,
  removeWalkIn,
  setMark,
  summarize,
  toPayload,
  type AttendanceDraft,
  type Mark,
  type Planned,
} from './model';
import { WalkInDialog } from './WalkInDialog';

/** One block of the sheet: a boat session (or, without a program, an hour of the training) with its own time. */
interface SheetSession {
  /** The session number (`slot_index`), which the attendance rows use. */
  slot: number;
  heading: string;
  /** "08:15–09:15" for the walk-in dialog. */
  range: string;
  startMs: number;
}

interface EditorProps {
  training: Training;
  planned: Planned;
  sessions: SheetSession[];
  planSource: 'program' | 'rsvp';
  saved: AttendanceRecord[];
  activeMembers: Array<Pick<Profile, 'id' | 'full_name'>>;
  nameOf: (id: string) => string;
  /** boat name for a planned member in a session (from the program), if any */
  boatOf: (slot: number, memberId: string) => string | undefined;
}

const MARKS: Array<{ value: Mark; label: string; icon: typeof CircleCheck; selected: string }> = [
  { value: 'present', label: tr.attendance.present, icon: CircleCheck, selected: 'border-success bg-success-soft text-success' },
  { value: 'absent', label: tr.attendance.absent, icon: CircleX, selected: 'border-danger bg-danger-soft text-danger' },
];

function MarkToggle({ name, value, onChange }: { name: string; value: Mark; onChange: (mark: Mark) => void }) {
  return (
    <div role="radiogroup" aria-label={tr.attendance.markGroup(name)} onKeyDown={radioGroupKeys({ activate: true })} className="grid grid-cols-2 gap-2">
      {MARKS.map(({ value: mark, label, icon: Icon, selected }, index) => (
        <button
          key={mark}
          type="button"
          role="radio"
          aria-checked={value === mark}
          tabIndex={radioTabIndex(value === mark, true, index)}
          onClick={() => onChange(mark)}
          className={cn(
            'flex min-h-11 items-center justify-center gap-1.5 rounded-xl border-2 px-2 text-sm font-bold',
            value === mark ? selected : 'border-border bg-surface text-muted',
          )}
        >
          <Icon aria-hidden="true" size={16} />
          {label}
        </button>
      ))}
    </div>
  );
}

function AttendanceEditor({ training, planned, sessions, planSource, saved, activeMembers, nameOf, boatOf }: EditorProps) {
  const toast = useToast();
  const save = useSaveAttendance(training.id);

  const baseline = useMemo(() => initialDraft(saved, planned), [saved, planned]);
  const [draft, setDraft] = useState<AttendanceDraft>(baseline);
  const [picker, setPicker] = useState<number | null>(null);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const completed = training.status === 'completed';
  const hasSaved = saved.length > 0;
  const dirty = !isSameDraft(draft, baseline);
  const summary = summarize(draft);

  const change = (next: AttendanceDraft) => {
    setDraft(next);
    save.reset();
  };

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const run = async (complete: boolean, message: string) => {
    setConfirmComplete(false);
    try {
      await save.mutateAsync({ rows: toPayload(draft), complete });
      toast.show(message, 'success');
    } catch {
      /* shown inline */
    }
  };

  const listed = picker === null ? new Set<string>() : new Set(draft.slots[picker]?.map((r) => r.memberId));
  const candidates = activeMembers.filter((m) => !listed.has(m.id)).map((m) => ({ id: m.id, name: m.full_name }));
  const noRows = !hasAnyRow(draft);

  // Sessions added in this sitting (only possible without a program) continue the old hourly grid.
  const extra: SheetSession[] = Array.from({ length: Math.max(0, draft.slots.length - baseline.slots.length) }, (_, i) => {
    const slot = baseline.slots.length + i;
    const { start, end } = sessionTimes(training, slot);
    return { slot, heading: tr.program.slotHeading(slot + 1, `${start}–${end}`), range: `${start}–${end}`, startMs: Date.parse(training.starts_at) + slot * 3_600_000 };
  });
  const shown = [...sessions, ...extra];
  const rangeOf = (slot: number) => shown.find((s) => s.slot === slot)?.range ?? '';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={completed ? 'success' : 'warning'}>{completed ? tr.attendance.statusCompleted : tr.attendance.statusInProgress}</Badge>
        <span className="text-sm text-muted" aria-live="polite">
          {dirty ? tr.attendance.unsaved : hasSaved ? tr.attendance.upToDate : ''}
        </span>
      </div>

      {!hasSaved && <p className="text-sm text-muted">{planSource === 'program' ? tr.attendance.planFromProgram : tr.attendance.planFromRsvp}</p>}

      {shown.map(({ slot, heading }) => {
        const rows = draft.slots[slot] ?? [];
        const sorted = [...rows].sort((a, b) => nameOf(a.memberId).localeCompare(nameOf(b.memberId), 'tr'));
        return (
          <section key={slot} aria-label={heading} className="flex flex-col gap-2">
            <h3 className="text-sm font-bold text-muted">{heading}</h3>
            {sorted.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted">{tr.attendance.emptySlot}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {sorted.map((row) => {
                  const name = nameOf(row.memberId);
                  const boat = boatOf(slot, row.memberId);
                  return (
                    <li key={row.memberId}>
                      <Card className="flex flex-col gap-2.5 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{name}</p>
                            <div className="mt-1 flex flex-wrap gap-1.5 empty:hidden">
                              {boat && <Badge tone="primary">{boat}</Badge>}
                              {row.walkIn && <Badge tone="warning">{tr.attendance.walkIn}</Badge>}
                            </div>
                          </div>
                          {row.walkIn && (
                            <button
                              type="button"
                              onClick={() => change(removeWalkIn(draft, slot, row.memberId))}
                              aria-label={tr.attendance.removeWalkIn(name)}
                              className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted"
                            >
                              <X aria-hidden="true" size={18} />
                            </button>
                          )}
                        </div>
                        <MarkToggle name={name} value={row.mark} onChange={(mark) => change(setMark(draft, slot, row.memberId, mark))} />
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
            <Button variant="secondary" onClick={() => setPicker(slot)}>
              <UserPlus aria-hidden="true" size={18} />
              {tr.attendance.addPerson}
            </Button>
          </section>
        );
      })}

      {/* With a program the sessions ARE the program's (add one there); without one, the coach may add hours here. */}
      {planSource === 'rsvp' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!canAddSession(draft)} onClick={() => change(addSession(draft))}>
              <Plus aria-hidden="true" size={16} />
              {tr.attendance.addSession}
            </Button>
            {draft.slots.length > baseline.slots.length && (
              <Button variant="ghost" onClick={() => change(removeLastSession(draft, baseline.slots.length))}>
                <Trash2 aria-hidden="true" size={16} />
                {tr.attendance.removeSession}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted">{tr.attendance.sessionHint}</p>
        </div>
      )}

      <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 -mx-1 flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3 shadow-lg">
        <p className="text-center text-sm font-semibold" aria-live="polite">
          {tr.attendance.summary(summary.peoplePresent, summary.sessionsPresent)}
          {summary.absent > 0 && <span className="font-normal text-muted"> · {tr.attendance.summaryAbsent(summary.absent)}</span>}
        </p>
        {save.isError && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {errorMessage(save.error)}
          </p>
        )}
        {completed ? (
          <Button loading={save.isPending} disabled={!dirty || noRows} onClick={() => void run(false, tr.attendance.updatedToast)}>
            {save.isPending ? tr.attendance.saving : tr.attendance.update}
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={save.isPending || (!dirty && hasSaved)} onClick={() => void run(false, tr.attendance.savedToast)}>
              {tr.attendance.save}
            </Button>
            <Button loading={save.isPending} disabled={noRows} onClick={() => setConfirmComplete(true)}>
              {save.isPending ? tr.attendance.saving : tr.attendance.complete}
            </Button>
          </div>
        )}
      </div>

      <WalkInDialog
        open={picker !== null}
        rangeLabel={picker === null ? '' : rangeOf(picker)}
        candidates={candidates}
        onPick={(memberId) => picker !== null && change(addWalkIn(draft, picker, memberId))}
        onClose={() => setPicker(null)}
      />

      <ConfirmDialog
        open={confirmComplete}
        title={tr.attendance.completeConfirmTitle}
        confirmLabel={tr.attendance.completeConfirm}
        pending={save.isPending}
        onCancel={() => setConfirmComplete(false)}
        onConfirm={() => void run(true, tr.attendance.completedToast)}
      >
        <p>{tr.attendance.completeConfirmBody}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title={tr.program.leaveTitle}
        confirmLabel={tr.program.leaveGo}
        cancelLabel={tr.program.leaveStay}
        tone="danger"
        onCancel={() => blocker.state === 'blocked' && blocker.reset()}
        onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
      >
        <p>{tr.program.leaveBody}</p>
      </ConfirmDialog>
    </div>
  );
}

/** Coach's "Yoklama" tab. Available from the moment the training starts (server clock). */
export function AttendancePanel({ training }: { training: Training }) {
  const now = useNow();
  const started = now.getTime() >= new Date(training.starts_at).getTime();

  const attendance = useTrainingAttendance(training.id);
  const program = useProgram(training.id);
  const boats = useBoats();
  const responses = useTrainingResponses(training.id);
  const roster = useQuery({ queryKey: membersKey, queryFn: fetchMembers });

  if (training.status === 'cancelled') return <EmptyState icon={ClipboardCheck} title={tr.attendance.title} body={tr.attendance.cancelledBody} />;
  if (!started) {
    return <EmptyState icon={ClipboardCheck} title={tr.attendance.notStartedTitle} body={tr.attendance.notStartedBody(formatTime(training.starts_at))} />;
  }

  const queries = [attendance, program, boats, responses, roster];
  if (queries.some((q) => q.isPending)) {
    return (
      <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }
  if (queries.some((q) => q.isError) || !attendance.data || !program.data || !boats.data || !responses.data || !roster.data) {
    return (
      <ErrorState
        message={tr.attendance.loadError}
        onRetry={() => {
          for (const q of queries) void q.refetch();
        }}
      />
    );
  }

  return (
    <EditorLoader
      training={training}
      saved={attendance.data}
      programData={program.data}
      boats={boats.data}
      responses={responses.data}
      profiles={roster.data}
    />
  );
}

function EditorLoader({
  training,
  saved,
  programData,
  boats,
  responses,
  profiles,
}: {
  training: Training;
  saved: AttendanceRecord[];
  programData: NonNullable<ReturnType<typeof useProgram>['data']>;
  boats: NonNullable<ReturnType<typeof useBoats>['data']>;
  responses: NonNullable<ReturnType<typeof useTrainingResponses>['data']>;
  profiles: Profile[];
}) {
  const boatName = useMemo(() => new Map(boats.map((b) => [b.id, b.name])), [boats]);
  const names = useMemo(() => new Map(profiles.map((p) => [p.id, p.full_name])), [profiles]);
  const activeMembers = useMemo(() => profiles.filter((p) => p.role === 'member' && p.is_active), [profiles]);

  const { planned, planSource, boatBySlot, sessions } = useMemo(() => {
    // a training whose length was never planned (0 sessions) is still shown as one session
    const sessions = Math.max(1, training.slot_count);
    const crewBySlot: string[][] = Array.from({ length: sessions }, () => []);
    const boatBySlot = new Map<string, string>();
    const assignmentById = new Map(programData.assignments.map((a) => [a.id, a]));
    for (const c of programData.crew) {
      const assignment = assignmentById.get(c.assignment_id);
      if (!assignment || c.slot_index >= sessions) continue;
      crewBySlot[c.slot_index]?.push(c.member_id);
      boatBySlot.set(`${c.slot_index}:${c.member_id}`, boatName.get(assignment.boat_id) ?? '');
    }
    const attendingIds = responses.filter((r) => r.response === 'attending').map((r) => r.member_id);
    const planned = plannedFrom(sessions, crewBySlot, attendingIds.filter((id) => activeMembers.some((m) => m.id === id)));
    const hasProgram = crewBySlot.some((crew) => crew.length > 0);

    // One block per boat session, at ITS OWN time (a session number may only be shared by several boats in older programs).
    const bySlot = new Map<number, typeof programData.assignments>();
    for (const a of programData.assignments) if (a.slot_index < sessions) bySlot.set(a.slot_index, [...(bySlot.get(a.slot_index) ?? []), a]);
    const ids = new Set<number>([...bySlot.keys(), ...saved.map((r) => r.slot_index).filter((slot) => slot < sessions)]);
    if (!hasProgram) for (let slot = 0; slot < sessions; slot++) ids.add(slot);
    const list: SheetSession[] = [...ids].map((slot) => {
      const own = bySlot.get(slot) ?? [];
      if (own.length === 0) {
        const { start, end } = sessionTimes(training, slot);
        return { slot, heading: tr.program.slotHeading(slot + 1, `${start}–${end}`), range: `${start}–${end}`, startMs: Date.parse(training.starts_at) + slot * 3_600_000 };
      }
      const startMs = Math.min(...own.map((a) => Date.parse(a.starts_at)));
      const endMs = Math.max(...own.map((a) => Date.parse(a.ends_at)));
      const range = `${formatTime(new Date(startMs))}–${formatTime(new Date(endMs))}`;
      const boatsIn = [...new Set(own.map((a) => boatName.get(a.boat_id) ?? ''))].filter(Boolean);
      return { slot, heading: boatsIn.length === 1 ? `${boatsIn[0]} · ${range}` : range, range, startMs };
    });
    list.sort((a, b) => a.startMs - b.startMs || a.slot - b.slot);
    return { planned, planSource: (hasProgram ? 'program' : 'rsvp') as 'program' | 'rsvp', boatBySlot, sessions: list };
  }, [training, programData, responses, boatName, activeMembers, saved]);

  return (
    <AttendanceEditor
      key={`${training.id}:${training.slot_count}`}
      training={training}
      planned={planned}
      sessions={sessions}
      planSource={planSource}
      saved={saved}
      activeMembers={activeMembers}
      nameOf={(id) => names.get(id) ?? tr.program.formerMember}
      boatOf={(slot, id) => boatBySlot.get(`${slot}:${id}`) || undefined}
    />
  );
}
