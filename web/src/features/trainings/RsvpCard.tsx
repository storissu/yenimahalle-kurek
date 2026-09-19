import { CircleCheck, CircleX, Lock, MessageSquareText, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextAreaField } from '@/components/ui/TextAreaField';
import { cn } from '@/lib/cn';
import { tr } from '@/strings/tr';
import type { RsvpResponse, Training, TrainingResponse } from '@/types/database';
import { deadlineLabel, formatCountdown, rsvpWindow } from './schedule';

export const NOTE_MAX = 200;

interface RsvpCardProps {
  training: Training;
  answer: TrainingResponse | undefined;
  /** Server-adjusted "now" (see lib/clock.ts). */
  now: Date;
  /** The coach published the program: answers are locked from then on, deadline or not. */
  programPublished?: boolean;
  /** Resolves when the server accepted the answer. Rejections are shown via `error`. */
  onSubmit: (response: RsvpResponse, note: string) => Promise<void>;
  pending: boolean;
  error: string | null;
}

const OPTIONS: Array<{ value: RsvpResponse; label: string; icon: typeof CircleCheck }> = [
  { value: 'attending', label: tr.rsvp.attending, icon: CircleCheck },
  { value: 'not_attending', label: tr.rsvp.notAttending, icon: CircleX },
];

const answerLabel = (r: RsvpResponse) => (r === 'attending' ? tr.rsvp.attending : tr.rsvp.notAttending);

/**
 * The member's answer for one training. Open until the deadline, then locked (the database enforces
 * the same rule, so a wrong phone clock can't bypass it — the countdown uses server-adjusted time).
 */
export function RsvpCard({ training, answer, now, programPublished = false, onSubmit, pending, error }: RsvpCardProps) {
  const window = rsvpWindow(training, now, programPublished);
  // `draft` is what the member typed but has not saved yet; null = show the saved note.
  const [draft, setDraft] = useState<string | null>(null);
  const savedNote = answer?.note ?? '';
  const note = draft ?? savedNote;
  const noteDirty = draft !== null && draft.trim() !== savedNote;
  const noteTooLong = note.trim().length > NOTE_MAX;

  if (window.kind === 'cancelled') {
    return (
      <Card className="flex items-start gap-3 border-danger bg-danger-soft">
        <TriangleAlert aria-hidden="true" className="mt-0.5 shrink-0 text-danger" size={22} />
        <div>
          <h2 className="font-semibold text-danger">{tr.rsvp.cancelledTitle}</h2>
          {training.cancel_reason && <p className="text-sm text-danger">{tr.trainings.cancelReasonShown(training.cancel_reason)}</p>}
        </div>
      </Card>
    );
  }

  if (window.kind === 'completed' || window.kind === 'locked') {
    return (
      <Card className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Lock aria-hidden="true" className="mt-0.5 shrink-0 text-muted" size={20} />
          <div>
            <h2 className="font-semibold">
              {window.kind === 'completed' ? tr.rsvp.completedTitle : window.reason === 'program' ? tr.rsvp.lockedProgramTitle : tr.rsvp.lockedTitle}
            </h2>
            {window.kind === 'locked' && <p className="text-sm text-muted">{window.reason === 'program' ? tr.rsvp.lockedProgramBody : tr.rsvp.lockedBody}</p>}
          </div>
        </div>
        <p className="font-semibold">{answer ? tr.rsvp.yourAnswer(answerLabel(answer.response)) : tr.rsvp.lockedNoAnswer}</p>
        {answer?.set_by_coach && <p className="text-sm text-muted">{tr.rsvp.enteredByCoach}</p>}
        {answer?.note && (
          <p className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-sm">
            <MessageSquareText aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-muted" />
            <span>
              <span className="font-semibold">{tr.rsvp.yourNote}: </span>
              {answer.note}
            </span>
          </p>
        )}
      </Card>
    );
  }

  const submit = async (response: RsvpResponse) => {
    if (noteTooLong) return;
    try {
      await onSubmit(response, note.trim());
      setDraft(null);
    } catch {
      /* the parent surfaces the error; keep what the member typed */
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold">{tr.rsvp.question}</h2>
        <p className="mt-1 text-sm text-muted">
          {tr.rsvp.deadlineAt(deadlineLabel(training))} · <span className="font-semibold text-fg">{formatCountdown(window.msLeft)}</span>
        </p>
      </div>

      <div role="radiogroup" aria-label={tr.rsvp.groupLabel} className="grid grid-cols-2 gap-3">
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const selected = answer?.response === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={pending}
              onClick={() => void submit(value)}
              className={cn(
                'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border-2 px-2 text-[15px] font-bold transition-colors disabled:opacity-60',
                selected ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-fg',
              )}
            >
              <Icon aria-hidden="true" size={24} />
              {label}
            </button>
          );
        })}
      </div>

      {!answer && <p className="-mt-1 text-sm text-muted">{tr.rsvp.noAnswerYet}</p>}
      {answer?.set_by_coach && <p className="-mt-1 text-sm text-muted">{tr.rsvp.enteredByCoach}</p>}

      <TextAreaField
        label={tr.rsvp.noteLabel}
        hint={tr.rsvp.noteHint}
        placeholder={tr.rsvp.notePlaceholder}
        value={note}
        onChange={(e) => setDraft(e.target.value)}
        counter={{ current: note.trim().length, max: NOTE_MAX }}
        error={noteTooLong ? tr.rsvp.noteTooLong : undefined}
        disabled={pending}
      />

      {answer && noteDirty && (
        <Button variant="secondary" loading={pending} disabled={noteTooLong} onClick={() => void submit(answer.response)}>
          {tr.rsvp.saveNote}
        </Button>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
