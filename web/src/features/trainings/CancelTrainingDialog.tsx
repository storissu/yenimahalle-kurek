import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextAreaField } from '@/components/ui/TextAreaField';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/errors';
import { tr } from '@/strings/tr';
import { useCancelTraining } from './hooks';

interface CancelTrainingDialogProps {
  trainingId: string;
  open: boolean;
  onClose: () => void;
}

const REASON_MIN = 3;
const REASON_MAX = 200;

/** Cancelling needs a reason that members will see. Goes through the cancel_training RPC (coach-only). */
export function CancelTrainingDialog({ trainingId, open, onClose }: CancelTrainingDialogProps) {
  const cancel = useCancelTraining(trainingId);
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const trimmed = reason.trim();
  const invalid = trimmed.length < REASON_MIN || trimmed.length > REASON_MAX;

  const close = () => {
    cancel.reset();
    setReason('');
    setTouched(false);
    onClose();
  };

  const confirm = async () => {
    setTouched(true);
    if (invalid) return;
    try {
      await cancel.mutateAsync(trimmed);
      toast.show(tr.trainings.cancel.done, 'success');
      close();
    } catch {
      /* shown inline below */
    }
  };

  return (
    <Dialog open={open} onClose={close} title={tr.trainings.cancel.title}>
      <p className="text-sm text-muted">{tr.trainings.cancel.body}</p>
      <TextAreaField
        label={tr.trainings.cancel.reasonLabel}
        hint={tr.trainings.cancel.reasonHint}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        counter={{ current: trimmed.length, max: REASON_MAX }}
        error={touched && invalid ? tr.trainings.cancel.reasonInvalid : undefined}
        rows={3}
      />
      {cancel.isError && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {errorMessage(cancel.error)}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={close}>
          {tr.trainings.cancel.keep}
        </Button>
        <Button variant="danger" className="flex-1" loading={cancel.isPending} onClick={() => void confirm()}>
          {cancel.isPending ? tr.trainings.cancel.confirming : tr.trainings.cancel.confirm}
        </Button>
      </div>
    </Dialog>
  );
}
