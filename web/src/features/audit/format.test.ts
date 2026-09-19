import { describe, expect, it } from 'vitest';
import { tr } from '@/strings/tr';
import { actorLabel, changedFields, countNote, groupByDay } from './format';

describe('groupByDay', () => {
  it('groups by CLUB-time day, newest first, with a readable heading', () => {
    // 21:30Z on the 20th is already 00:30 on the 21st in Istanbul
    const groups = groupByDay([{ at: '2026-09-20T21:30:00Z' }, { at: '2026-09-20T20:30:00Z' }, { at: '2026-09-20T10:00:00Z' }]);
    expect(groups.map((g) => [g.day, g.entries.length])).toEqual([
      ['2026-09-21', 1],
      ['2026-09-20', 2],
    ]);
    expect(groups[0]?.heading).toBe('21 Eylül 2026 Pazartesi');
  });

  it('is empty for no entries', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('changedFields', () => {
  it('names the changed fields in Turkish and skips anything unknown', () => {
    expect(changedFields({ fields: ['title', 'rsvp_deadline'] })).toBe('başlık, son yanıt zamanı');
    expect(changedFields({ fields: ['phone'] })).toBe('telefon');
    expect(changedFields({ fields: ['title', 'password_hash', 42] })).toBe('başlık');
  });

  it('is null when there is nothing to show', () => {
    expect(changedFields({})).toBeNull();
    expect(changedFields({ fields: [] })).toBeNull();
    expect(changedFields({ fields: 'title' })).toBeNull();
    expect(changedFields({ fields: ['unknown'] })).toBeNull();
  });
});

describe('countNote and actorLabel', () => {
  it('shows a count only for merged entries', () => {
    expect(countNote({ count: 12 })).toBe('12 kayıt');
    expect(countNote({ count: 1 })).toBeNull();
    expect(countNote({})).toBeNull();
    expect(countNote({ count: 'x' })).toBeNull();
  });

  it('falls back to a neutral label when the actor is gone', () => {
    expect(actorLabel({ actor_name: 'Ayşe Yılmaz' })).toBe('Ayşe Yılmaz');
    expect(actorLabel({ actor_name: null })).toBe(tr.audit.system);
  });
});
