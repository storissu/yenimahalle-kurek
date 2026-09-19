import { MessageSquareText, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { tr } from '@/strings/tr';
import type { RosterMemberInfo } from './CrewPickerDialog';
import { memberSlots, type Analysis, type ProgramDraft } from './model';

interface ParticipantSummaryProps {
  draft: ProgramDraft;
  roster: RosterMemberInfo[];
  analysis: Analysis;
  boatName: (boatId: string) => string;
  slotTime: (slot: number) => string;
}

/**
 * Checklist for the coach: everyone who said "attending" with the hours they row and their note,
 * so nobody is forgotten and "assign me after 9" requests are visible while planning.
 */
export function ParticipantSummary({ draft, roster, analysis, boatName, slotTime }: ParticipantSummaryProps) {
  const attending = roster.filter((m) => m.answer === 'attending');
  const mismatched = roster.filter((m) => analysis.assignedNotAttending.includes(m.id) || analysis.assignedNoAnswer.includes(m.id));

  return (
    <details open className="group">
      <summary className="mb-2 flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold">
        {tr.program.summaryHeading}
        <Badge tone={analysis.unassignedAttending.length > 0 ? 'warning' : 'success'}>
          {attending.length - analysis.unassignedAttending.length}/{attending.length}
        </Badge>
      </summary>
      <p className="mb-3 text-sm text-muted">{tr.program.summaryHint}</p>

      <Card className="divide-y divide-border px-3 py-1">
        {attending.length === 0 && <p className="py-3 text-sm text-muted">{tr.responses.nobody}</p>}
        {attending.map((m) => {
          const slots = memberSlots(draft, m.id);
          return (
            <div key={m.id} className="py-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{m.name}</p>
                {slots.length === 0 && (
                  <Badge tone="warning">
                    <TriangleAlert aria-hidden="true" size={13} />
                    {tr.program.noSessions}
                  </Badge>
                )}
              </div>
              {slots.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {slots.map(({ slot, boatId }) => (
                    <li key={slot}>
                      <Badge tone="primary">
                        {slotTime(slot)} · {boatName(boatId)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {m.note && (
                <p className="mt-1 flex items-start gap-1.5 text-sm text-warning">
                  <MessageSquareText aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
                  <span className="break-words">{m.note}</span>
                </p>
              )}
            </div>
          );
        })}
      </Card>

      {mismatched.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 text-sm text-warning">
          {mismatched.map((m) => (
            <li key={m.id} className="flex items-start gap-2">
              <TriangleAlert aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
              <span>
                <span className="font-semibold">{m.name}</span> — {m.answer === 'not_attending' ? tr.program.notAttendingTag : tr.program.noAnswerTag}, programda
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
