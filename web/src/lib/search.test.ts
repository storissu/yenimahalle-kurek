import { describe, expect, it } from 'vitest';
import { foldTurkish, matchesQuery } from './search';

describe('foldTurkish', () => {
  it('handles the dotted and dotless i correctly', () => {
    expect(foldTurkish('IŞIK')).toBe('isik');
    expect(foldTurkish('İbrahim')).toBe('ibrahim');
    expect(foldTurkish('Çağla Şahin Ümit Öz')).toBe('cagla sahin umit oz');
  });
});

describe('matchesQuery', () => {
  const fields = ['Işık Şahin', 'isik.s'];
  it('matches ignoring case and Turkish letters', () => {
    expect(matchesQuery(fields, 'isik')).toBe(true);
    expect(matchesQuery(fields, 'ŞAHİN')).toBe(true);
  });
  it('requires every word to match', () => {
    expect(matchesQuery(fields, 'isik sahin')).toBe(true);
    expect(matchesQuery(fields, 'isik veli')).toBe(false);
  });
  it('an empty query matches everything', () => {
    expect(matchesQuery(fields, '   ')).toBe(true);
  });
});
