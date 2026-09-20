import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { BoatIcon } from '@/components/ui/BoatIcon';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';
import type { Boat } from '@/types/database';
import { boatStyle } from './boatStyle';
import { canAddSession, sessionsOf, suggestedStart, toMinutes, type ProgramDraft, type SessionDraft, type SessionProblem } from './model';
import { SessionCard } from './SessionCard';

interface BoatScheduleProps {
  boat: Boat;
  /** Position of the boat in the club's order: the accent colour it has everywhere else. */
  position: number;
  draft: ProgramDraft;
  /** "HH:MM" — where a boat's first session starts by default (the training's start), and the earliest any may start. */
  trainingStart: string;
  problems: ReadonlyMap<number, SessionProblem[]>;
  nameOf: (memberId: string) => string;
  boatName: (boatId: string) => string;
  onAdd: () => void;
  onStart: (id: number, time: string) => void;
  onEnd: (id: number, time: string) => void;
  isCoach?: (memberId: string) => boolean;
  onEdit: (session: SessionDraft) => void;
  onRemoveMember: (id: number, memberId: string) => void;
  onMoveMember: (id: number, memberId: string, direction: -1 | 1) => void;
  onPickCox: (session: SessionDraft) => void;
  onRemoveCox: (id: number) => void;
  onNotes: (id: number, text: string) => void;
  onMove: (id: number, direction: -1 | 1) => void;
  onRemove: (session: SessionDraft) => void;
}

/**
 * One boat and ITS OWN sequence of sessions. The header names the boat (its colour and icon are the same everywhere in
 * the app) and summarises its schedule; each session below carries its own times; "Seans ekle" appends the next one
 * right where the previous ended. Nothing here depends on the other boats' schedules.
 */
export function BoatSchedule({
  boat,
  position,
  draft,
  trainingStart,
  problems,
  nameOf,
  boatName,
  isCoach,
  onAdd,
  onStart,
  onEnd,
  onEdit,
  onRemoveMember,
  onMoveMember,
  onPickCox,
  onRemoveCox,
  onNotes,
  onMove,
  onRemove,
}: BoatScheduleProps) {
  const style = boatStyle(position);
  const sessions = sessionsOf(draft, boat.id);
  const used = sessions.filter((s) => s.crew.length > 0);
  const first = used[0];
  const lastEnd = [...used].sort((a, b) => toMinutes(a.end) - toMinutes(b.end)).at(-1);
  const next = suggestedStart(draft, boat.id, trainingStart);

  return (
    <div role="group" aria-label={boat.name} className={cn('overflow-hidden rounded-2xl border-2 bg-surface', style.border)}>
      <div className={cn('flex items-center justify-between gap-2 px-4 py-2.5', style.header)}>
        <h3 className="flex items-center gap-2 text-base font-extrabold">
          <BoatIcon capacity={boat.capacity} size={20} />
          {boat.name}
          {!boat.is_active && <Badge tone="danger">{tr.program.boatInactive}</Badge>}
        </h3>
        {first && lastEnd && (
          <span className="text-sm font-bold tabular-nums">
            {first.start}–{lastEnd.end} · {tr.program.sessionCount(used.length)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 p-3">
        {sessions.map((session, index) => (
          <SessionCard
            key={session.id}
            session={session}
            boat={boat}
            position={position}
            index={index}
            count={sessions.length}
            problems={problems.get(session.id) ?? []}
            trainingStart={trainingStart}
            nameOf={nameOf}
            boatName={boatName}
            {...(isCoach ? { isCoach } : {})}
            onStart={(time) => onStart(session.id, time)}
            onEnd={(time) => onEnd(session.id, time)}
            onEdit={() => onEdit(session)}
            onRemoveMember={(memberId) => onRemoveMember(session.id, memberId)}
            onMoveMember={(memberId, direction) => onMoveMember(session.id, memberId, direction)}
            onPickCox={() => onPickCox(session)}
            onRemoveCox={() => onRemoveCox(session.id)}
            onNotes={(text) => onNotes(session.id, text)}
            onMove={(direction) => onMove(session.id, direction)}
            onRemove={() => onRemove(session)}
          />
        ))}
        <Button variant="secondary" disabled={!canAddSession(draft, boat.id)} onClick={onAdd} fullWidth>
          <Plus aria-hidden="true" size={18} />
          {tr.program.addSession}
          <span className="tabular-nums text-muted">· {next}</span>
        </Button>
      </div>
    </div>
  );
}
