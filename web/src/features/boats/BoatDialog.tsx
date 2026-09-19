import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { TextField } from '@/components/ui/TextField';
import { useToast } from '@/components/ui/Toast';
import { errorMessage, isUniqueViolation } from '@/lib/errors';
import { tr } from '@/strings/tr';
import type { Boat } from '@/types/database';
import { boatsKey, createBoat, updateBoat } from './api';

const schema = z.object({
  name: z.string().trim().min(1, tr.boats.nameRequired).max(40, tr.boats.nameRequired),
  capacity: z.number({ message: tr.boats.nameRequired }).int().min(1).max(8),
  is_active: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

const CAPACITIES = [1, 2, 3, 4, 5, 6, 7, 8];

interface BoatDialogProps {
  /** null = closed; 'new' = add; a boat = edit. */
  target: Boat | 'new' | null;
  nextSortOrder: number;
  onClose: () => void;
}

function BoatForm({ target, nextSortOrder, onClose }: { target: Boat | 'new'; nextSortOrder: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const editing = target === 'new' ? null : target;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: editing?.name ?? '', capacity: editing?.capacity ?? 2, is_active: editing?.is_active ?? true },
  });

  const save = useMutation({
    mutationFn: (values: FormValues) => (editing ? updateBoat(editing.id, values) : createBoat(values, nextSortOrder)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boatsKey });
      toast.show(tr.boats.saved, 'success');
      onClose();
    },
  });

  const onSubmit = handleSubmit((values) => save.mutateAsync(values).catch(() => undefined));

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <TextField label={tr.boats.name} autoComplete="off" error={errors.name?.message} {...register('name')} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="boat-capacity" className="text-sm font-semibold">
          {tr.boats.capacity}
        </label>
        <select id="boat-capacity" className="min-h-12 rounded-xl border border-border bg-surface px-3.5 text-fg" {...register('capacity', { valueAsNumber: true })}>
          {CAPACITIES.map((n) => (
            <option key={n} value={n}>
              {tr.boats.capacityOption(n)}
            </option>
          ))}
        </select>
      </div>

      <label className="flex min-h-12 items-start gap-3 rounded-xl border border-border bg-surface p-3">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--primary)]" {...register('is_active')} />
        <span>
          <span className="block font-semibold">{tr.boats.activeLabel}</span>
          <span className="block text-sm text-muted">{tr.boats.activeHint}</span>
        </span>
      </label>

      {save.isError && (
        <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {isUniqueViolation(save.error) ? tr.boats.duplicate : errorMessage(save.error)}
        </p>
      )}

      <Button type="submit" size="lg" fullWidth loading={save.isPending}>
        {save.isPending ? tr.boats.saving : tr.boats.save}
      </Button>
    </form>
  );
}

export function BoatDialog({ target, nextSortOrder, onClose }: BoatDialogProps) {
  return (
    <Dialog open={target !== null} onClose={onClose} title={target === 'new' ? tr.boats.newTitle : tr.boats.editTitle}>
      {target && <BoatForm target={target} nextSortOrder={nextSortOrder} onClose={onClose} />}
    </Dialog>
  );
}
