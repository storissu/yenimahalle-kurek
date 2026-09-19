import { CircleCheck, CircleX } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField } from '@/components/ui/TextAreaField';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { tr } from '@/strings/tr';
import type { Profile, RsvpResponse, Training, TrainingResponse } from '@/types/database';
import { useCoachSetRsvp } from './hooks';
import { NOTE_MAX } from './RsvpCard';

type Member = Pick<Profile, 'id' | 'full_name'>;

interface CoachRsvpDialogProps {
  training: Training;
  member: Member | null;
  current: TrainingResponse | undefined;
  onClose: () => void;
}

const OPTIONS: Array<{ value: RsvpResponse; label: string; icon: typeof CircleCheck }> = [
  { value: 'attending', label: tr.rsvp.attending, icon: CircleCheck },
  { value: 'not_attending', label: tr.rsvp.notAttending, icon: CircleX },
];

function Form({ training, member, current, onClose }: Omit<CoachRsvpDialogProps, 'member'> & { member: Member }) {
  const save = useCoachSetRsvp(training.id);
  const toast = useToast();
  const [response, setResponse] = useState<RsvpResponse | null>(current?.response ?? null);
  const [note, setNote] = useState(current?.note ?? '');
  const tooLong = note.trim().length > NOTE_MAX;

  const submit = async () => {
    if (!response || tooLong) return;
    try {
      await save.mutateAsync({ memberId: member.id, response, note: note.trim() });
      toast.show(tr.responses.overrideSaved, 'success');
      onClose();
    } catch {
      /* shown inline */
    }
  };

  return (
    <>
      <p className="text-lg font-bold">{member.full_name}</p>
      <p className="-mt-2 text-sm text-muted">{tr.responses.overrideHelp}</p>

      <div role="radiogroup" aria-label={tr.rsvp.groupLabel} className="grid grid-cols-2 gap-3">
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const selected = response === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setResponse(value)}
              className={cn(
                'flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl border-2 px-2 text-[15px] font-bold',
                selected ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-fg',
              )}
            >
              <Icon aria-hidden="true" size={24} />
              {label}
            </button>
          );
        })}
      </div>

      <TextAreaField
        label={tr.rsvp.noteLabel}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        counter={{ current: note.trim().length, max: NOTE_MAX }}
        error={tooLong ? tr.rsvp.noteTooLong : undefined}
        rows={2}
      />

      {save.isError && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {errorMessage(save.error)}
        </p>
      )}

      <Button size="lg" fullWidth loading={save.isPending} disabled={!response || tooLong} onClick={() => void submit()}>
        {tr.common.save}
      </Button>
    </>
  );
}

/** Coach records an answer for a member (e.g. they phoned in) — works even after the deadline. */
export function CoachRsvpDialog({ training, member, current, onClose }: CoachRsvpDialogProps) {
  return (
    <Dialog open={member !== null} onClose={onClose} title={tr.responses.overrideTitle}>
      {member && <Form training={training} member={member} current={current} onClose={onClose} />}
    </Dialog>
  );
}
