import { useQuery } from '@tanstack/react-query';
import { Copy, Eraser, Plus, Ship, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useBlocker } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { TextAreaField } from '@/components/ui/TextAreaField';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errors';
import { formatTime } from '@/lib/time';
import { SlotWeather } from '../weather/WeatherStrip';
import { tr } from '@/strings/tr';
import type { Boat, Profile, Training, TrainingResponse } from '@/types/database';
import { fetchMembers, membersKey, type DirectoryEntry } from '../members/api';
import { useTrainingResponses } from '../trainings/hooks';
import { MAX_SLOTS, sessionRangeLabel, sessionStarts } from '../trainings/schedule';
import { CrewPickerDialog, type RosterMemberInfo } from './CrewPickerDialog';
import { useBoats, useMemberNames, useProgram, useSaveProgram } from './hooks';
import {
  addSession,
  analyzeDraft,
  canAddSession,
  canRemoveSession,
  clearSlot,
  copySlot,
  crewOf,
  draftFromProgram,
  entryOf,
  fullCrewProblems,
  hasAnyCrew,
  initialSessionCount,
  isSameDraft,
  removeLastSession,
  removeMember,
  setBoatNotes,
  setTrainingNotes,
  setWeatherNote,
  slotHasCrew,
  toggleMember,
  toPayload,
  type ProgramData,
  type ProgramDraft,
} from './model';
import { ParticipantSummary } from './ParticipantSummary';
import { ProgramByBoat } from './ProgramByBoat';
import { SlotBoatCard } from './SlotBoatCard';

interface InnerProps {
  training: Training;
  programData: ProgramData;
  boats: Boat[];
  roster: RosterMemberInfo[];
  nameOf: (id: string) => string;
  contactOf: (id: string) => DirectoryEntry | null;
}

type Confirm = null | 'copy' | 'clear' | 'unpublish' | 'warn' | 'removeSession';

function joinNames(ids: string[], nameOf: (id: string) => string): string {
  return ids.map(nameOf).join(', ');
}

function ProgramEditorInner({ training, programData, boats, roster, nameOf }: InnerProps) {
  const toast = useToast();
  const save = useSaveProgram(training.id);
  const tabsPrefix = useId();

  // The training's length is not fixed up front: the editor starts with the sessions the program already uses
  // (at least one) and the coach adds more. The server derives the training's length from the saved program.
  const startCount = initialSessionCount(programData, training.slot_count);
  const saved = useMemo(() => draftFromProgram(programData, startCount), [programData, startCount]);
  const [draft, setDraft] = useState<ProgramDraft>(saved);
  const [selectedSlot, setSlot] = useState(0);
  // The selected session can vanish ("Son seansı kaldır"), so it is always clamped to what exists.
  const slot = Math.min(selectedSlot, draft.slots.length - 1);
  const [picker, setPicker] = useState<{ slot: number; boatId: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);

  const published = programData.program?.status === 'published';
  const version = programData.program?.version ?? 0;
  const dirty = !isSameDraft(draft, saved);

  const boatById = useMemo(() => new Map(boats.map((b) => [b.id, b])), [boats]);
  const boatName = (id: string) => boatById.get(id)?.name ?? '?';
  const analysis = analyzeDraft(draft, roster);
  const crewProblems = fullCrewProblems(draft, boats);
  const hasWarnings = analysis.unassignedAttending.length + analysis.assignedNotAttending.length + analysis.assignedNoAnswer.length > 0;

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
      await save.mutateAsync({ payload: toPayload(draft), publish, notify });
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
    if (crewProblems.length > 0) return; // the warning above the buttons says which boats are incomplete
    if (hasWarnings) setConfirm('warn');
    else void run(true, published ? tr.program.updatedToast : tr.program.publishedToast);
  };

  // --- hours ------------------------------------------------------------------------------------
  const sessionCount = draft.slots.length;
  const slotStarts = sessionStarts({ starts_at: training.starts_at, slot_count: sessionCount });
  const slotTabs = slotStarts.map((start, i) => ({ id: String(i), label: formatTime(start) }));
  const addOneSession = () => {
    change(addSession(draft));
    setSlot(sessionCount); // jump to the new session
  };
  const dropLastSession = () => {
    change(removeLastSession(draft));
    setConfirm(null);
  };
  const requestDropLastSession = () => (slotHasCrew(draft, sessionCount - 1) ? setConfirm('removeSession') : dropLastSession());
  const visibleBoats = boats.filter((b) => b.is_active || entryOf(draft, slot, b.id));
  const pickerBoat = picker ? boatById.get(picker.boatId) : undefined;
  const usable = (boatId: string) => boatById.get(boatId)?.is_active ?? false;

  const requestCopy = () => (slotHasCrew(draft, slot) ? setConfirm('copy') : change(copySlot(draft, slot - 1, slot, usable)));
  const errorText = localError ?? (save.isError ? errorMessage(save.error) : null);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={published ? 'success' : 'warning'}>{published ? tr.program.statusPublished(version) : tr.program.statusDraft}</Badge>
        <span className="text-sm text-muted" aria-live="polite">
          {dirty ? tr.program.unsaved : tr.program.upToDate}
        </span>
      </div>

      <div>
        <Tabs label={tr.program.slotsLabel} idPrefix={tabsPrefix} tabs={slotTabs} value={String(slot)} onChange={(id) => setSlot(Number(id))} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={!canAddSession(draft)} onClick={addOneSession}>
            <Plus aria-hidden="true" size={16} />
            {tr.program.addSession}
          </Button>
          {canRemoveSession(draft) && (
            <Button variant="ghost" onClick={requestDropLastSession}>
              <Trash2 aria-hidden="true" size={16} />
              {tr.program.removeSession}
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          {tr.program.sessionsHint} {canAddSession(draft) ? tr.program.sessionTotal(sessionCount) : tr.program.maxSessions(MAX_SLOTS)}
        </p>
        <TabPanel idPrefix={tabsPrefix} id={String(slot)}>
          <p className="mb-3 text-sm font-semibold text-muted">{tr.program.slotHeading(slot + 1, sessionRangeLabel(training, slot))}</p>
          <SlotWeather trainingId={training.id} slot={slot} />

          <div className="mb-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={slot === 0} onClick={requestCopy}>
              <Copy aria-hidden="true" size={16} />
              {tr.program.copyPrevious}
            </Button>
            <Button variant="secondary" disabled={!slotHasCrew(draft, slot)} onClick={() => setConfirm('clear')}>
              <Eraser aria-hidden="true" size={16} />
              {tr.program.clearSlot}
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            {visibleBoats.map((boat) => (
              <SlotBoatCard
                key={boat.id}
                boat={boat}
                crew={crewOf(draft, slot, boat.id)}
                notes={entryOf(draft, slot, boat.id)?.notes ?? ''}
                nameOf={nameOf}
                onEdit={() => setPicker({ slot, boatId: boat.id })}
                onRemove={(memberId) => change(removeMember(draft, slot, boat.id, memberId))}
                onNotes={(text) => change(setBoatNotes(draft, slot, boat.id, text))}
              />
            ))}
          </div>
        </TabPanel>
      </div>

      <div className="flex flex-col gap-4">
        <TextAreaField
          label={tr.program.weatherNote}
          hint={tr.program.weatherNoteHint}
          value={draft.weatherNote}
          onChange={(e) => change(setWeatherNote(draft, e.target.value))}
          counter={{ current: draft.weatherNote.length, max: 500 }}
          rows={2}
        />
        <TextAreaField
          label={tr.program.trainingNotesLabel}
          hint={tr.program.trainingNotesHint}
          value={draft.trainingNotes}
          onChange={(e) => change(setTrainingNotes(draft, e.target.value))}
          counter={{ current: draft.trainingNotes.length, max: 1000 }}
          rows={3}
        />
      </div>

      <ParticipantSummary draft={draft} roster={roster} analysis={analysis} boatName={boatName} slotTime={(i) => formatTime(slotStarts[i] ?? training.starts_at)} />

      {/* Actions stay in reach above the tab bar while scrolling a long program. */}
      <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 -mx-1 flex flex-col gap-2 rounded-2xl border border-border bg-surface p-3 shadow-lg">
        {errorText && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {errorText}
          </p>
        )}
        {crewProblems.length > 0 && (
          <div id="crew-problems" role="alert" className="max-h-40 overflow-y-auto rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">
            <p className="flex items-center gap-2 font-bold">
              <TriangleAlert aria-hidden="true" size={16} className="shrink-0" />
              {tr.program.fullCrewBlockedTitle}
            </p>
            <p>{tr.program.fullCrewBlockedBody}</p>
            <ul className="list-disc pl-5">
              {crewProblems.map((p) => (
                <li key={`${p.slot}:${p.boatId}`}>{tr.program.fullCrewProblem(boatName(p.boatId), p.slot + 1, p.count, p.capacity)}</li>
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
            <Button disabled={!dirty || crewProblems.length > 0} aria-describedby={crewProblems.length > 0 ? 'crew-problems' : undefined} loading={save.isPending} onClick={requestPublish}>
              {save.isPending ? tr.program.saving : tr.program.update}
            </Button>
            <Button variant="secondary" disabled={save.isPending} onClick={() => setConfirm('unpublish')}>
              {tr.program.unpublish}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={!dirty || save.isPending} onClick={() => void run(false, tr.program.draftSaved)}>
              {tr.program.saveDraft}
            </Button>
            <Button disabled={crewProblems.length > 0} aria-describedby={crewProblems.length > 0 ? 'crew-problems' : undefined} loading={save.isPending} onClick={requestPublish}>
              {save.isPending ? tr.program.saving : tr.program.publish}
            </Button>
          </div>
        )}
      </div>

      <CrewPickerDialog
        target={picker && pickerBoat ? { slot: picker.slot, boat: pickerBoat } : null}
        draft={draft}
        roster={roster}
        rangeLabel={(i) => sessionRangeLabel(training, i)}
        boatName={boatName}
        onToggle={(memberId) => picker && pickerBoat && change(toggleMember(draft, picker.slot, picker.boatId, memberId, pickerBoat.capacity).draft)}
        onClose={() => setPicker(null)}
      />

      <ConfirmDialog
        open={confirm === 'copy'}
        title={tr.program.copyConfirmTitle}
        confirmLabel={tr.program.copyConfirm}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          change(copySlot(draft, slot - 1, slot, usable));
          setConfirm(null);
        }}
      >
        <p>{tr.program.copyConfirmBody}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'clear'}
        title={tr.program.clearConfirmTitle}
        confirmLabel={tr.program.clearConfirm}
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          change(clearSlot(draft, slot));
          setConfirm(null);
        }}
      >
        <p>{tr.program.clearConfirmBody}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'removeSession'}
        title={tr.program.removeSessionTitle}
        confirmLabel={tr.program.removeSessionConfirm}
        tone="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={dropLastSession}
      >
        <p>{tr.program.removeSessionBody}</p>
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

function ReadOnlyProgram({ training, programData, boats, nameOf, contactOf }: Omit<InnerProps, 'roster'>) {
  if (!programData.program || programData.assignments.length === 0) {
    return <p className="text-sm text-muted">{tr.program.noProgramYet}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{tr.program.readOnly}</p>
      <ProgramByBoat data={programData} training={training} boats={boats} nameOf={nameOf} contactOf={contactOf} />
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
    return <ReadOnlyProgram training={training} programData={program.data} boats={boats.data} nameOf={displayName} contactOf={contactOf} />;
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
    />
  );
}
