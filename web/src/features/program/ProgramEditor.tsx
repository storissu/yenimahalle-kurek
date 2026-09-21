import { useQuery } from '@tanstack/react-query';
import { Ship, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useBlocker } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { TextAreaField } from '@/components/ui/TextAreaField';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errors';
import { instantToWallTime } from '@/lib/time';
import { tr } from '@/strings/tr';
import type { Boat, Profile, Training, TrainingResponse } from '@/types/database';
import { useProfile } from '../auth/AuthProvider';
import { fetchMembers, membersKey, type DirectoryEntry } from '../members/api';
import { useTrainingResponses } from '../trainings/hooks';
import { BoatSchedule } from './BoatSchedule';
import { boatPositions } from './boatStyle';
import { CrewPickerDialog, type RosterMemberInfo } from './CrewPickerDialog';
import { useBoats, useMemberNames, useProgram, useSaveProgram } from './hooks';
import {
  addSession,
  analyzeDraft,
  coxProblems,
  draftFromProgram,
  fullCrewProblems,
  hasAnyCrew,
  isSameDraft,
  moveMember,
  moveTeam,
  removeMember,
  removeSession,
  sessionById,
  sessionProblems,
  setCox,
  setEnd,
  setStart,
  setTrainingNotes,
  toggleMember,
  toPayload,
  withDefaultSessions,
  withoutCoxOn,
  type ProgramData,
  type ProgramDraft,
  type SessionDraft,
} from './model';
import { ParticipantSummary } from './ParticipantSummary';
import { ProgramByBoat } from './ProgramByBoat';

interface InnerProps {
  training: Training;
  programData: ProgramData;
  boats: Boat[];
  roster: RosterMemberInfo[];
  nameOf: (id: string) => string;
  contactOf: (id: string) => DirectoryEntry | null;
  /** The signed-in coach (who can steer a boat themselves) and everybody who is a coach (named as such when they steer). */
  coach: { id: string; name: string };
  coachIds: ReadonlySet<string>;
}

type Confirm = null | 'unpublish' | 'warn';

function joinNames(ids: string[], nameOf: (id: string) => string): string {
  return ids.map(nameOf).join(', ');
}

function ProgramEditorInner({ training, programData, boats, roster, nameOf, coach, coachIds }: InnerProps) {
  const toast = useToast();
  const save = useSaveProgram(training.id);

  // The training's own start is where every boat's first session starts by default, and the earliest any session may start.
  const { date: trainingDate, time: trainingStart } = instantToWallTime(training.starts_at);

  const saved = useMemo(() => draftFromProgram(programData), [programData]);
  const visibleBoatIds = useMemo(() => boats.filter((b) => b.is_active || saved.sessions.some((s) => s.boatId === b.id)).map((b) => b.id), [boats, saved]);
  // Every boat starts with one empty session at the training's start (an hour long): the coach changes its time and adds a team.
  const [draft, setDraft] = useState<ProgramDraft>(() => withDefaultSessions(withoutCoxOn(saved, boats), visibleBoatIds, trainingStart, training.slot_count));
  // which session's people are being picked, and whether it is the rowers or the dümenci
  const [picker, setPicker] = useState<{ id: number; mode: 'crew' | 'cox' } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [removing, setRemoving] = useState<SessionDraft | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);

  const published = programData.program?.status === 'published';
  const version = programData.program?.version ?? 0;
  const dirty = !isSameDraft(draft, saved);

  const boatById = useMemo(() => new Map(boats.map((b) => [b.id, b])), [boats]);
  const boatName = (id: string) => boatById.get(id)?.name ?? '?';
  const positions = useMemo(() => boatPositions(boats), [boats]);
  const analysis = analyzeDraft(draft, roster);
  const crewProblems = fullCrewProblems(draft, boats);
  const missingCox = coxProblems(draft, boats);
  const timeProblems = sessionProblems(draft, trainingStart);
  const hasTimeProblems = timeProblems.size > 0;
  const hasWarnings = analysis.unassignedAttending.length + analysis.assignedNotAttending.length + analysis.assignedNoAnswer.length > 0;
  const blocked = crewProblems.length > 0 || missingCox.length > 0 || hasTimeProblems;

  const change = (next: ProgramDraft) => {
    setDraft(next);
    setLocalError(null);
    save.reset();
  };

  // --- leaving with unsaved changes -------------------------------------------------------------
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // --- saving -----------------------------------------------------------------------------------
  const run = async (publish: boolean, message: string) => {
    setConfirm(null);
    try {
      await save.mutateAsync({ payload: toPayload(draft, trainingDate), publish, notify });
      toast.show(message, 'success');
    } catch {
      /* shown inline */
    }
  };
  const requestPublish = () => {
    if (!hasAnyCrew(draft)) {
      setLocalError(tr.program.emptyPublish);
      return;
    }
    if (blocked) return; // the warnings above the buttons and on the sessions say what to fix
    if (hasWarnings) setConfirm('warn');
    else void run(true, published ? tr.program.updatedToast : tr.program.publishedToast);
  };

  // --- sessions -----------------------------------------------------------------------------------
  const pickerSession = picker === null ? undefined : sessionById(draft, picker.id);
  const pickerBoat = pickerSession ? boatById.get(pickerSession.boatId) : undefined;
  const visibleBoats = boats.filter((b) => visibleBoatIds.includes(b.id) || draft.sessions.some((s) => s.boatId === b.id && s.crew.length > 0));
  const errorText = localError ?? (save.isError ? errorMessage(save.error) : null);

  const requestRemove = (session: SessionDraft) => (session.crew.length > 0 ? setRemoving(session) : change(removeSession(draft, session.id)));

  return (
    <div className="flex flex-col gap-5">
      <h2 className="sr-only">{tr.program.heading}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={published ? 'success' : 'warning'}>{published ? tr.program.statusPublished(version) : tr.program.statusDraft}</Badge>
        <span className="text-sm text-muted" aria-live="polite">
          {dirty ? tr.program.unsaved : tr.program.upToDate}
        </span>
      </div>

      {/* One section per boat, each with its OWN schedule: the times of one boat never move another's. */}
      <div className="flex flex-col gap-4">
        {visibleBoats.map((boat) => (
          <BoatSchedule
            key={boat.id}
            boat={boat}
            position={positions.get(boat.id) ?? 0}
            draft={draft}
            trainingStart={trainingStart}
            problems={timeProblems}
            nameOf={nameOf}
            boatName={boatName}
            isCoach={(id) => coachIds.has(id)}
            onAdd={() => change(addSession(draft, boat.id, trainingStart, training.slot_count).draft)}
            onStart={(id, time) => change(setStart(draft, id, time))}
            onEnd={(id, time) => change(setEnd(draft, id, time))}
            onEdit={(session) => setPicker({ id: session.id, mode: 'crew' })}
            onRemoveMember={(id, memberId) => change(removeMember(draft, id, memberId))}
            onMoveMember={(id, memberId, direction) => change(moveMember(draft, id, memberId, direction))}
            onPickCox={(session) => setPicker({ id: session.id, mode: 'cox' })}
            onRemoveCox={(id) => change(setCox(draft, id, null).draft)}
            onMove={(id, direction) => change(moveTeam(draft, id, direction))}
            onRemove={requestRemove}
          />
        ))}
      </div>

      <TextAreaField
        label={tr.program.trainingNotesLabel}
        hint={tr.program.trainingNotesHint}
        value={draft.trainingNotes}
        onChange={(e) => change(setTrainingNotes(draft, e.target.value))}
        counter={{ current: draft.trainingNotes.length, max: 1000 }}
        rows={3}
      />

      <ParticipantSummary draft={draft} roster={roster} analysis={analysis} boatName={boatName} />

      {/* Actions stay in reach above the tab bar while scrolling a long program. */}
      <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 -mx-1 flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3 shadow-lg">
        {errorText && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {errorText}
          </p>
        )}
        {hasTimeProblems && (
          <p id="time-problems" role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            <TriangleAlert aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
            {tr.program.timeProblemsBlocked}
          </p>
        )}
        {(crewProblems.length > 0 || missingCox.length > 0) && (
          <div id="crew-problems" role="alert" className="max-h-40 overflow-y-auto rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
            <p className="flex items-center gap-2 font-bold">
              <TriangleAlert aria-hidden="true" size={16} className="shrink-0" />
              {tr.program.fullCrewBlockedTitle}
            </p>
            <p>{tr.program.fullCrewBlockedBody}</p>
            <ul className="list-disc pl-5">
              {crewProblems.map((p) => (
                <li key={p.sessionId}>{tr.program.fullCrewProblem(boatName(p.boatId), `${p.start}–${p.end}`, p.count, p.capacity)}</li>
              ))}
              {missingCox.map((p) => (
                <li key={`cox-${p.sessionId}`}>{tr.program.coxProblem(boatName(p.boatId), `${p.start}–${p.end}`)}</li>
              ))}
            </ul>
          </div>
        )}
        <label className="flex min-h-11 items-start gap-2.5 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary)]" />
          <span>
            <span className="block font-semibold">{tr.program.notify}</span>
            <span className="block text-xs text-muted">{tr.program.notifyHint}</span>
          </span>
        </label>
        {published ? (
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={!dirty || blocked} aria-describedby={blocked ? 'crew-problems time-problems' : undefined} loading={save.isPending} onClick={requestPublish}>
              {save.isPending ? tr.program.saving : tr.program.update}
            </Button>
            <Button variant="secondary" disabled={save.isPending} onClick={() => setConfirm('unpublish')}>
              {tr.program.unpublish}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={!dirty || save.isPending || hasTimeProblems} onClick={() => void run(false, tr.program.draftSaved)}>
              {tr.program.saveDraft}
            </Button>
            <Button disabled={blocked} aria-describedby={blocked ? 'crew-problems time-problems' : undefined} loading={save.isPending} onClick={requestPublish}>
              {save.isPending ? tr.program.saving : tr.program.publish}
            </Button>
          </div>
        )}
      </div>

      <CrewPickerDialog
        target={pickerSession && pickerBoat ? { session: pickerSession, boat: pickerBoat, position: positions.get(pickerBoat.id) ?? 0 } : null}
        draft={draft}
        roster={roster}
        boatName={boatName}
        mode={picker?.mode ?? 'crew'}
        coach={coach}
        onToggle={(memberId) => {
          if (!pickerSession || !pickerBoat) return;
          if (picker?.mode === 'cox') {
            // one dümenci: choosing somebody sets them and closes the sheet; choosing the same person again clears it
            const result = setCox(draft, pickerSession.id, memberId);
            change(result.draft);
            if (!result.error) setPicker(null);
            return;
          }
          change(toggleMember(draft, pickerSession.id, memberId, pickerBoat.capacity).draft);
        }}
        onClose={() => setPicker(null)}
      />

      <ConfirmDialog
        open={removing !== null}
        title={tr.program.removeSessionTitle}
        confirmLabel={tr.program.removeSessionConfirm}
        tone="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) change(removeSession(draft, removing.id));
          setRemoving(null);
        }}
      >
        <p>{tr.program.removeSessionBody(removing ? `${boatName(removing.boatId)} ${removing.start}–${removing.end}` : '')}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'unpublish'}
        title={tr.program.unpublishConfirmTitle}
        confirmLabel={tr.program.unpublish}
        tone="danger"
        pending={save.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void run(false, tr.program.unpublishedToast)}
      >
        <p>{tr.program.unpublishConfirmBody}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'warn'}
        title={tr.program.warnTitle}
        confirmLabel={published ? tr.program.updateAnyway : tr.program.publishAnyway}
        cancelLabel={tr.program.backToEditing}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void run(true, published ? tr.program.updatedToast : tr.program.publishedToast)}
      >
        <ul className="flex flex-col gap-2">
          {analysis.unassignedAttending.length > 0 && <li>{tr.program.warnUnassigned(joinNames(analysis.unassignedAttending, nameOf))}</li>}
          {analysis.assignedNotAttending.length > 0 && <li>{tr.program.warnNotAttending(joinNames(analysis.assignedNotAttending, nameOf))}</li>}
          {analysis.assignedNoAnswer.length > 0 && <li>{tr.program.warnNoAnswer(joinNames(analysis.assignedNoAnswer, nameOf))}</li>}
        </ul>
        <p className="font-semibold">{tr.program.warnQuestion}</p>
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

function ReadOnlyProgram({ programData, boats, nameOf, contactOf }: Omit<InnerProps, 'roster' | 'training' | 'coach' | 'coachIds'>) {
  if (!programData.program || programData.assignments.length === 0) {
    return <p className="text-sm text-muted">{tr.program.noProgramYet}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{tr.program.readOnly}</p>
      <ProgramByBoat data={programData} boats={boats} nameOf={nameOf} contactOf={contactOf} />
    </div>
  );
}

function rosterFrom(profiles: Profile[], responses: TrainingResponse[]): RosterMemberInfo[] {
  const byMember = new Map(responses.map((r) => [r.member_id, r]));
  return profiles
    .filter((p) => p.role === 'member' && p.is_active)
    .map((p) => ({ id: p.id, name: p.full_name, answer: byMember.get(p.id)?.response, note: byMember.get(p.id)?.note ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** Coach's "Program" tab: loads everything the editor needs, then hands over to it. */
export function ProgramEditor({ training }: { training: Training }) {
  const me = useProfile();
  const program = useProgram(training.id);
  const boats = useBoats();
  const responses = useTrainingResponses(training.id);
  const roster = useQuery({ queryKey: membersKey, queryFn: fetchMembers });
  const { nameOf, contactOf } = useMemberNames();

  if (program.isPending || boats.isPending || responses.isPending || roster.isPending) {
    return (
      <div role="status" aria-label={tr.app.loading} className="flex flex-col gap-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (program.isError || boats.isError || responses.isError || roster.isError) {
    return (
      <ErrorState
        message={tr.program.loadError}
        onRetry={() => {
          void program.refetch();
          void boats.refetch();
          void responses.refetch();
          void roster.refetch();
        }}
      />
    );
  }

  // Coaches see every profile through nameOf too (names of deactivated crew members stay readable).
  const profileNames = new Map(roster.data.map((p) => [p.id, p.full_name]));
  const displayName = (id: string) => profileNames.get(id) ?? nameOf(id);

  if (training.status !== 'scheduled') {
    return <ReadOnlyProgram programData={program.data} boats={boats.data} nameOf={displayName} contactOf={contactOf} />;
  }
  if (!boats.data.some((b) => b.is_active)) {
    return (
      <EmptyState
        icon={Ship}
        title={tr.program.needBoats}
        body={tr.program.needBoatsBody}
        action={
          <Link to="/antrenor/diger/tekneler" className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 font-semibold text-primary-fg">
            {tr.program.needBoatsAction}
          </Link>
        }
      />
    );
  }

  return (
    <ProgramEditorInner
      key={training.id}
      training={training}
      programData={program.data}
      boats={boats.data}
      roster={rosterFrom(roster.data, responses.data)}
      nameOf={displayName}
      contactOf={contactOf}
      coach={{ id: me.id, name: me.full_name }}
      coachIds={new Set(roster.data.filter((p) => p.role === 'coach').map((p) => p.id))}
    />
  );
}
