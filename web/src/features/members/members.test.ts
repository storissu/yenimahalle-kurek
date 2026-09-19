import { describe, expect, it, vi } from 'vitest';
import type { Profile } from '@/types/database';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('../auth/AuthProvider', () => ({ useProfile: () => ({}) }));

import { sortMembers } from './api';
import { matchesSearch } from './MembersPage';

const person = (over: Partial<Profile>): Profile => ({
  id: crypto.randomUUID(),
  full_name: 'X',
  username: 'x',
  role: 'member',
  phone: null,
  is_active: true,
  must_change_password: false,
  created_at: '',
  updated_at: '',
  ...over,
});

describe('member search', () => {
  const isik = { full_name: 'Işık Şahin', username: 'isik.s' };

  it('matches without caring about Turkish letters or case', () => {
    expect(matchesSearch(isik, 'isik')).toBe(true);
    expect(matchesSearch(isik, 'IŞIK')).toBe(true);
    expect(matchesSearch(isik, 'sahin')).toBe(true);
    expect(matchesSearch(isik, 'ŞAHİN')).toBe(true);
  });

  it('matches usernames and ignores surrounding spaces', () => {
    expect(matchesSearch(isik, ' isik.s ')).toBe(true);
  });

  it('shows everyone for an empty query and no one for a miss', () => {
    expect(matchesSearch(isik, '')).toBe(true);
    expect(matchesSearch(isik, 'veli')).toBe(false);
  });
});

describe('member ordering', () => {
  it('lists coaches first, then sorts names with Turkish collation', () => {
    const sorted = sortMembers([
      person({ full_name: 'Zeynep' }),
      person({ full_name: 'Çağla' }),
      person({ full_name: 'Ahmet' }),
      person({ full_name: 'Mehmet Antrenör', role: 'coach' }),
    ]);
    expect(sorted.map((p) => p.full_name)).toEqual(['Mehmet Antrenör', 'Ahmet', 'Çağla', 'Zeynep']);
  });
});
