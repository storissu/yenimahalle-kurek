import { CircleCheck, CircleX, ClipboardCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { tr } from '@/strings/tr';
import type { AttendanceRecord, Training } from '@/types/database';
import { endsAt, sessionRangeLabel } from '../trainings/schedule';
import { mySessions } from './model';

/** A member's own attendance for one finished training: which hours they rowed and which they missed. */
export function MyAttendanceCard({ training, records }: { training: Pick<Training, 'id' | 'starts_at' | 'slot_count'>; records: AttendanceRecord[] }) {
  const mine = records.filter((r) => r.training_id === training.id);
  const sessions = mySessions(mine);
  const all = [...sessions.present.map((slot) => ({ slot, present: true })), ...sessions.absent.map((slot) => ({ slot, present: false }))].sort((a, b) => a.slot - b.slot);

  return (
    <Card className="flex flex-col gap-3" role="region" aria-labelledby="my-attendance-heading">
      <h2 id="my-attendance-heading" className="flex items-center gap-2 text-sm font-bold text-muted">
        <ClipboardCheck aria-hidden="true" size={18} />
        {tr.attendance.mine}
      </h2>
      {all.length === 0 ? (
        <p className="text-sm text-muted">{tr.attendance.mineNone}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {all.map(({ slot, present }) => (
            <li key={slot} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
              <span className="font-semibold">{sessionRangeLabel(training, slot)}</span>
              <Badge tone={present ? 'success' : 'neutral'}>
                {present ? <CircleCheck aria-hidden="true" size={14} /> : <CircleX aria-hidden="true" size={14} />}
                {present ? tr.attendance.minePresent : tr.attendance.mineAbsent}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Status chip for a member's history list. Icon + text, never colour alone. */
export function MyAttendanceBadge({
  training,
  records,
  now,
}: {
  training: Pick<Training, 'id' | 'status' | 'starts_at' | 'slot_count'>;
  records: AttendanceRecord[];
  now: Date;
}) {
  if (training.status === 'cancelled') return null;
  if (training.status !== 'completed') {
    // Over but the coach has not finished the attendance yet.
    return endsAt(training) <= now ? <Badge tone="warning">{tr.attendance.badgePending}</Badge> : null;
  }
  const present = mySessions(records.filter((r) => r.training_id === training.id)).present.length;
  if (present > 0) {
    return (
      <Badge tone="success">
        <CircleCheck aria-hidden="true" size={14} />
        {tr.attendance.badgeAttended(present)}
      </Badge>
    );
  }
  return (
    <Badge>
      <CircleX aria-hidden="true" size={14} />
      {tr.attendance.badgeNone}
    </Badge>
  );
}
