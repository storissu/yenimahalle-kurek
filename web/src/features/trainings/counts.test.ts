import { describe, expect, it } from 'vitest';
import { countResponses } from './counts';

describe('countResponses', () => {
  const active = ['a', 'b', 'c', 'd'];

  it('starts every training with everybody unanswered', () => {
    expect(countResponses(active, [], ['t1']).get('t1')).toEqual({ attending: 0, notAttending: 0, none: 4 });
  });

  it('counts answers per training', () => {
    const result = countResponses(
      active,
      [
        { training_id: 't1', member_id: 'a', response: 'attending' },
        { training_id: 't1', member_id: 'b', response: 'not_attending' },
        { training_id: 't2', member_id: 'a', response: 'attending' },
      ],
      ['t1', 't2'],
    );
    expect(result.get('t1')).toEqual({ attending: 1, notAttending: 1, none: 2 });
    expect(result.get('t2')).toEqual({ attending: 1, notAttending: 0, none: 3 });
  });

  it('ignores answers from deactivated members and for unknown trainings', () => {
    const result = countResponses(
      active,
      [
        { training_id: 't1', member_id: 'gone', response: 'attending' },
        { training_id: 'other', member_id: 'a', response: 'attending' },
      ],
      ['t1'],
    );
    expect(result.get('t1')).toEqual({ attending: 0, notAttending: 0, none: 4 });
    expect(result.has('other')).toBe(false);
  });

  it('never counts the same member twice for one training', () => {
    const result = countResponses(
      active,
      [
        { training_id: 't1', member_id: 'a', response: 'attending' },
        { training_id: 't1', member_id: 'a', response: 'not_attending' },
      ],
      ['t1'],
    );
    expect(result.get('t1')).toEqual({ attending: 1, notAttending: 0, none: 3 });
  });

  it('always adds up to the roster size', () => {
    const c = countResponses(active, [{ training_id: 't1', member_id: 'c', response: 'not_attending' }], ['t1']).get('t1');
    expect((c?.attending ?? 0) + (c?.notAttending ?? 0) + (c?.none ?? 0)).toBe(active.length);
  });
});
