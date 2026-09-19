import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, ids, seedPeople } from './harness';

let db: PGlite;
// members: ids.member1 "Ali Yılmaz", ids.member2 "Becca Kaya" + extra below
const extra = {
  alex: '00000000-0000-4000-8000-0000000000b1',
  ashley: '00000000-0000-4000-8000-0000000000b2',
  john: '00000000-0000-4000-8000-0000000000b3',
  jamie: '00000000-0000-4000-8000-0000000000b4',
} as const;

beforeAll(async () => {
  db = await createDb();
  await seedPeople(db);
  for (const [key, name] of Object.entries({ alex: 'Alex', ashley: 'Ashley', john: 'John', jamie: 'Jamie' })) {
    const id = extra[key as keyof typeof extra];
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@kulup.invalid`]);
    await db.query(`insert into public.profiles (id, username, full_name, role, must_change_password) values ($1, $2, $3, 'member', false)`, [id, key, name]);
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
});

/** A training that started `startedAgo` ago (or starts in the future when negative), 2 sessions. */
async function training(startsIn: string, slots = 2, status = 'scheduled'): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.trainings (starts_at, slot_count, rsvp_deadline, created_by, status, cancel_reason)
     values (now() + $1::interval, $2, now() + $1::interval - interval '1 day', $3, $4, $5) returning id`,
    [startsIn, slots, ids.coach1, status, status === 'cancelled' ? 'Fırtına' : null],
  );
  return (res.rows[0] as { id: string }).id;
}

/** A completed training at a fixed instant with the given present rows: [slot, member][] */
async function completedAt(startsAtIso: string, present: Array<[number, string]>, absent: Array<[number, string]> = [], slots = 3): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.trainings (starts_at, slot_count, rsvp_deadline, created_by, status)
     values ($1::timestamptz, $2, $1::timestamptz - interval '1 day', $3, 'completed') returning id`,
    [startsAtIso, slots, ids.coach1],
  );
  const id = (res.rows[0] as { id: string }).id;
  for (const [slot, member] of present) {
    await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ($1, $2, $3, 'present', $4)`, [id, slot, member, ids.coach1]);
  }
  for (const [slot, member] of absent) {
    await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ($1, $2, $3, 'absent', $4)`, [id, slot, member, ids.coach1]);
  }
  return id;
}

type Row = { slot_index: number; member_id: string; status: 'present' | 'absent'; note?: string };
const save = (t: string, rows: unknown, complete = false) => db.query('select public.save_attendance($1, $2::jsonb, $3)', [t, JSON.stringify(rows), complete]);
const asCoach = (t: string, rows: unknown, complete = false) => as(db, ids.coach1, () => save(t, rows, complete));
const recorded = async (t: string) =>
  (await db.query<{ slot_index: number; member_id: string; status: string; note: string | null }>('select slot_index, member_id, status, note from public.attendance_records where training_id = $1 order by slot_index, member_id', [t])).rows;
const statusOf = async (t: string) => (await db.query<{ status: string }>('select status from public.trainings where id = $1', [t])).rows[0]?.status;

describe('save_attendance: recording', () => {
  it('records present and absent per member and session, with a note', async () => {
    const t = await training('-3 hours');
    await asCoach(t, [
      { slot_index: 0, member_id: ids.member1, status: 'present' },
      { slot_index: 0, member_id: ids.member2, status: 'absent', note: '  geç kaldı  ' },
      { slot_index: 1, member_id: ids.member1, status: 'present' },
    ] satisfies Row[]);
    expect(await recorded(t)).toEqual([
      { slot_index: 0, member_id: ids.member1, status: 'present', note: null },
      { slot_index: 0, member_id: ids.member2, status: 'absent', note: 'geç kaldı' },
      { slot_index: 1, member_id: ids.member1, status: 'present', note: null },
    ]);
  });

  it('stamps who recorded it and when', async () => {
    const t = await training('-1 hour');
    await asCoach(t, [{ slot_index: 0, member_id: ids.member1, status: 'present' }]);
    const row = (await db.query<{ recorded_by: string }>('select recorded_by from public.attendance_records where training_id = $1', [t])).rows[0];
    expect(row?.recorded_by).toBe(ids.coach1);
  });

  it('replaces the previous record instead of adding to it', async () => {
    const t = await training('-2 hours');
    await asCoach(t, [{ slot_index: 0, member_id: ids.member1, status: 'present' }, { slot_index: 1, member_id: ids.member2, status: 'present' }]);
    await asCoach(t, [{ slot_index: 1, member_id: extra.alex, status: 'present' }]);
    expect((await recorded(t)).map((r) => r.member_id)).toEqual([extra.alex]);
  });

  it('records walk-ins (people who were not planned) just like anyone else', async () => {
    const t = await training('-1 hour');
    await asCoach(t, [{ slot_index: 1, member_id: extra.jamie, status: 'present' }]);
    expect(await recorded(t)).toHaveLength(1);
  });
});

describe('save_attendance: saving progress vs. completing', () => {
  it('saving progress leaves the training scheduled; completing marks it completed', async () => {
    const t = await training('-2 hours');
    await asCoach(t, [{ slot_index: 0, member_id: ids.member1, status: 'present' }], false);
    expect(await statusOf(t)).toBe('scheduled');
    await asCoach(t, [{ slot_index: 0, member_id: ids.member1, status: 'present' }, { slot_index: 1, member_id: ids.member1, status: 'present' }], true);
    expect(await statusOf(t)).toBe('completed');
  });

  it('a completed training can still be corrected, and stays completed', async () => {
    const t = await training('-2 hours');
    await asCoach(t, [{ slot_index: 0, member_id: ids.member1, status: 'present' }], true);
    await asCoach(t, [{ slot_index: 0, member_id: ids.member1, status: 'absent' }], false);
    expect(await statusOf(t)).toBe('completed');
    expect((await recorded(t))[0]?.status).toBe('absent');
  });

  it('refuses to complete (or leave completed) with no record at all', async () => {
    const t = await training('-2 hours');
    await expect(asCoach(t, [], true)).rejects.toThrow(/en az bir kayıt/);
    await asCoach(t, [{ slot_index: 0, member_id: ids.member1, status: 'present' }], true);
    await expect(asCoach(t, [], false)).rejects.toThrow(/en az bir kayıt/);
    expect(await recorded(t)).toHaveLength(1); // untouched: the failed call rolled back
  });

  it('allows an empty progress save on a training that is not completed', async () => {
    const t = await training('-2 hours');
    await asCoach(t, [{ slot_index: 0, member_id: ids.member1, status: 'present' }]);
    await asCoach(t, []);
    expect(await recorded(t)).toEqual([]);
  });
});

describe('save_attendance: who and when', () => {
  it('is coach-only', async () => {
    const t = await training('-1 hour');
    await expect(as(db, ids.member1, () => save(t, []))).rejects.toThrow(/Yetkisiz/);
    await expect(as(db, ids.exCoach, () => save(t, []))).rejects.toThrow(/Yetkisiz/);
    await expect(as(db, 'anon', () => save(t, []))).rejects.toThrow(/permission denied/);
  });

  it('only once the training has started (server time)', async () => {
    const future = await training('1 hour');
    await expect(asCoach(future, [{ slot_index: 0, member_id: ids.member1, status: 'present' }])).rejects.toThrow(/başladıktan sonra/);
  });

  it('never for cancelled or unknown trainings', async () => {
    const cancelled = await training('-1 hour', 1, 'cancelled');
    await expect(asCoach(cancelled, [])).rejects.toThrow(/edilen antrenmanın yoklaması/);
    await expect(asCoach('00000000-0000-4000-8000-000000000999', [])).rejects.toThrow(/Antrenman bulunamadı/);
  });
});

describe('save_attendance: validation (all-or-nothing)', () => {
  it('rejects negative sessions and more than 12 sessions', async () => {
    const t = await training('-1 hour', 2);
    await expect(asCoach(t, [{ slot_index: -1, member_id: ids.member1, status: 'present' }])).rejects.toThrow(/Geçersiz seans/);
    await expect(asCoach(t, [{ slot_index: 12, member_id: ids.member1, status: 'present' }])).rejects.toThrow(/en fazla 12 seans/);
  });

  it('grows a training that was planned shorter (or not at all) to the sessions actually recorded', async () => {
    const unplanned = await training('-1 hour', 0);
    await asCoach(unplanned, [{ slot_index: 0, member_id: ids.member1, status: 'present' }, { slot_index: 2, member_id: ids.member1, status: 'present' }]);
    expect((await db.query<{ slot_count: number }>('select slot_count from public.trainings where id = $1', [unplanned])).rows[0]?.slot_count).toBe(3);
    const planned = await training('-1 hour', 2);
    await asCoach(planned, [{ slot_index: 2, member_id: ids.member1, status: 'present' }]);
    expect((await db.query<{ slot_count: number }>('select slot_count from public.trainings where id = $1', [planned])).rows[0]?.slot_count).toBe(3);
  });

  it('rejects duplicates, bad statuses, non-members and malformed data', async () => {
    const t = await training('-1 hour');
    await expect(asCoach(t, [{ slot_index: 0, member_id: ids.member1, status: 'present' }, { slot_index: 0, member_id: ids.member1, status: 'absent' }])).rejects.toThrow(/iki kez girilemez/);
    await expect(asCoach(t, [{ slot_index: 0, member_id: ids.member1, status: 'late' }])).rejects.toThrow(/Geçersiz yoklama durumu/);
    await expect(asCoach(t, [{ slot_index: 0, member_id: ids.coach2, status: 'present' }])).rejects.toThrow(/yalnızca üyeler/);
    await expect(asCoach(t, [{ slot_index: 0, member_id: 'nope', status: 'present' }])).rejects.toThrow(/Geçersiz üye/);
    await expect(asCoach(t, { rows: [] })).rejects.toThrow(/Geçersiz yoklama verisi/);
    await expect(asCoach(t, [{ member_id: ids.member1, status: 'present' }])).rejects.toThrow(/Geçersiz yoklama verisi/);
    await expect(asCoach(t, [{ slot_index: 0, member_id: ids.member1, status: 'present', note: 'x'.repeat(201) }])).rejects.toThrow(/en fazla 200/);
  });

  it('is atomic: a failed save keeps the previous record', async () => {
    const t = await training('-1 hour');
    await asCoach(t, [{ slot_index: 0, member_id: ids.member1, status: 'present' }]);
    await expect(asCoach(t, [{ slot_index: 0, member_id: extra.alex, status: 'present' }, { slot_index: 5, member_id: ids.coach2, status: 'present' }])).rejects.toThrow();
    expect((await recorded(t)).map((r) => r.member_id)).toEqual([ids.member1]);
    // ... and the extension to 6 sessions was rolled back with it
    expect((await db.query<{ slot_count: number }>('select slot_count from public.trainings where id = $1', [t])).rows[0]?.slot_count).toBe(2);
  });

  it('does not add deactivated members, but keeps ones already recorded', async () => {
    const t = await training('-1 hour');
    await expect(asCoach(t, [{ slot_index: 0, member_id: ids.exMember, status: 'present' }])).rejects.toThrow(/devre dışı/);
    await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ($1, 0, $2, 'present', $3)`, [t, ids.exMember, ids.coach1]);
    await asCoach(t, [{ slot_index: 0, member_id: ids.exMember, status: 'present' }, { slot_index: 0, member_id: ids.member1, status: 'present' }]);
    expect(await recorded(t)).toHaveLength(2);
  });

  it('the database itself rejects a session beyond the training when bypassed', async () => {
    const t = await training('-1 hour', 1);
    await expect(
      db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ($1, 1, $2, 'present', $3)`, [t, ids.member1, ids.coach1]),
    ).rejects.toThrow(/seans sayısını aşıyor/);
  });
});

describe('attendance visibility', () => {
  let t: string;
  beforeAll(async () => {
    t = await training('-1 hour');
    await asCoach(t, [{ slot_index: 0, member_id: ids.member1, status: 'present' }, { slot_index: 0, member_id: ids.member2, status: 'absent' }]);
    await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ($1, 1, $2, 'present', $3)`, [t, ids.exMember, ids.coach1]);
  });
  const rowsFor = (who: string) => as(db, who, async () => (await db.query<{ member_id: string }>('select member_id from public.attendance_records where training_id = $1', [t])).rows.map((r) => r.member_id));

  it('shows a member only their own rows', async () => {
    expect(await rowsFor(ids.member1)).toEqual([ids.member1]);
    expect(await rowsFor(ids.member2)).toEqual([ids.member2]);
  });

  it('shows a coach everything', async () => {
    expect((await rowsFor(ids.coach1)).sort()).toEqual([ids.member1, ids.member2, ids.exMember].sort());
  });

  it('shows deactivated users nothing and is closed to anonymous callers', async () => {
    expect(await rowsFor(ids.exMember)).toEqual([]);
    await expect(as(db, 'anon', () => db.query('select * from public.attendance_records'))).rejects.toThrow(/permission denied/);
  });

  it('cannot be written directly by anyone', async () => {
    for (const who of [ids.coach1, ids.member1]) {
      for (const sql of [
        `insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ('${t}', 0, '${who}', 'present', '${who}')`,
        `update public.attendance_records set status = 'present'`,
        `delete from public.attendance_records`,
      ]) {
        await expect(as(db, who, () => db.query(sql))).rejects.toThrow(/permission denied/);
      }
    }
  });
});

describe('monthly leaderboard', () => {
  // August 2026: 3 trainings. September 2026: 1. Times are chosen around the Istanbul month boundary.
  beforeAll(async () => {
    // Two sessions in ONE day for Alex (counts 2 sessions, 1 training day); Ali 2 sessions; Becca 1; John 1 (ties with Becca).
    await completedAt('2025-08-10T05:00:00Z', [[0, extra.alex], [1, extra.alex], [0, ids.member1], [1, ids.member1], [0, ids.member2], [1, extra.john]], [[1, ids.member2]]);
    // Second training: Ali again (a second training day) and Jamie once.
    await completedAt('2025-08-20T05:00:00Z', [[0, ids.member1], [0, extra.jamie]]);
    // 31 Aug 23:00 Istanbul = 20:00Z -> still August
    await completedAt('2025-08-31T20:00:00Z', [[0, extra.alex]]);
    // 1 Sep 00:00 Istanbul = 31 Aug 21:00Z -> September (even though it is still 31 Aug in UTC)
    await completedAt('2025-08-31T21:00:00Z', [[0, extra.ashley]]);
    // Not completed / cancelled trainings never count.
    const scheduled = await db.query<{ id: string }>(`insert into public.trainings (starts_at, slot_count, rsvp_deadline, created_by) values ('2025-08-15T05:00:00Z', 1, '2025-08-14T05:00:00Z', $1) returning id`, [ids.coach1]);
    await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ($1, 0, $2, 'present', $3)`, [scheduled.rows[0]!.id, extra.john, ids.coach1]);
    const cancelled = await db.query<{ id: string }>(`insert into public.trainings (starts_at, slot_count, rsvp_deadline, created_by, status, cancel_reason) values ('2025-08-16T05:00:00Z', 1, '2025-08-15T05:00:00Z', $1, 'cancelled', 'Fırtına') returning id`, [ids.coach1]);
    await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ($1, 0, $2, 'present', $3)`, [cancelled.rows[0]!.id, extra.john, ids.coach1]);
    // A deactivated member with sessions must not appear.
    await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by)
                    select id, 2, $1, 'present', $2 from public.trainings where starts_at = '2025-08-10T05:00:00Z'`, [ids.exMember, ids.coach1]);
  });

  const board = (who: string, month: string) =>
    as(db, who, async () => (await db.query<{ full_name: string; sessions: number; training_days: number; rank: number }>('select full_name, sessions, training_days, rank from public.monthly_leaderboard($1::date)', [month])).rows);

  it('counts every present hour (2 hours = 2), separately from training days', async () => {
    const rows = await board(ids.member1, '2025-08-15');
    expect(rows.find((r) => r.full_name === 'Alex')).toMatchObject({ sessions: 3, training_days: 2 }); // 2 on the 10th + 1 on the 31st
    expect(rows.find((r) => r.full_name === 'Ali Yılmaz')).toMatchObject({ sessions: 3, training_days: 2 });
  });

  it('ranks with ties sharing a place (1, 1, 3, 3 ...), does not count absences, and lists members without sessions last with no place', async () => {
    const rows = await board(ids.member1, '2025-08-01');
    expect(rows.map((r) => `${r.rank}:${r.full_name}:${r.sessions}`)).toEqual([
      '1:Alex:3',
      '1:Ali Yılmaz:3',
      '3:Becca Kaya:1',
      '3:Jamie:1',
      '3:John:1',
      'null:Ashley:0', // active, but no session in August: still listed, with 0
    ]);
  });

  it('follows the Istanbul month boundary (00:00 local, not UTC) and lists a past month independently', async () => {
    const august = await board(ids.member1, '2025-08-31'); // any day of the month selects it
    expect(august.find((r) => r.full_name === 'Ashley')).toMatchObject({ sessions: 0, rank: null }); // 21:00Z on 31 Aug is already September in Istanbul
    const september = await board(ids.member1, '2025-09-01');
    expect(september.map((r) => `${r.rank}:${r.full_name}:${r.sessions}`)).toEqual([
      '1:Ashley:1',
      'null:Alex:0',
      'null:Ali Yılmaz:0',
      'null:Becca Kaya:0',
      'null:Jamie:0',
      'null:John:0',
    ]);
  });

  it('lists every active member with 0 for a month without records, and excludes non-completed trainings, cancelled ones and deactivated members', async () => {
    const empty = await board(ids.member1, '2025-07-01');
    expect(empty).toHaveLength(6); // Ali, Becca, Alex, Ashley, John, Jamie
    expect(empty.every((r) => r.sessions === 0 && r.training_days === 0 && r.rank === null)).toBe(true);
    expect(empty.map((r) => r.full_name)).toEqual(['Alex', 'Ali Yılmaz', 'Ashley', 'Becca Kaya', 'Jamie', 'John']); // by name
    const august = await board(ids.member1, '2025-08-01');
    expect(august.some((r) => r.full_name === 'Eski Üye')).toBe(false);
    expect(august.find((r) => r.full_name === 'John')?.sessions).toBe(1); // the scheduled + cancelled rows did not add to it
  });

  it('is visible to every active user (members and coaches) but not to deactivated ones or anonymous callers', async () => {
    expect((await board(ids.member2, '2025-08-01')).length).toBeGreaterThan(0);
    expect((await board(ids.coach1, '2025-08-01')).length).toBeGreaterThan(0);
    await expect(board(ids.exMember, '2025-08-01')).rejects.toThrow(/Yetkisiz/);
    await expect(as(db, 'anon', () => db.query(`select * from public.monthly_leaderboard('2025-08-01')`))).rejects.toThrow(/permission denied/);
  });

  it('never exposes the internal helper to clients', async () => {
    await expect(as(db, ids.member1, () => db.query(`select * from public.attendance_month_internal('2025-08-01')`))).rejects.toThrow(/permission denied/);
  });
});

describe('my_month_stats', () => {
  const stats = (who: string, month: string) =>
    as(db, who, async () => (await db.query<{ sessions: number; training_days: number; rank: number | null; participants: number }>('select * from public.my_month_stats($1::date)', [month])).rows);

  it('returns the caller\'s sessions, training days, rank and how many members rowed', async () => {
    expect(await stats(ids.member2, '2025-08-01')).toEqual([{ sessions: 1, training_days: 1, rank: 3, participants: 5 }]);
    expect(await stats(ids.member1, '2025-08-01')).toEqual([{ sessions: 3, training_days: 2, rank: 1, participants: 5 }]);
  });

  it('gives zeros and no rank to someone without sessions that month (still exactly one row)', async () => {
    expect(await stats(ids.member2, '2025-09-01')).toEqual([{ sessions: 0, training_days: 0, rank: null, participants: 1 }]);
    expect(await stats(ids.member2, '2025-07-01')).toEqual([{ sessions: 0, training_days: 0, rank: null, participants: 0 }]);
  });

  it('is only for active users', async () => {
    await expect(stats(ids.exMember, '2025-08-01')).rejects.toThrow(/Yetkisiz/);
    await expect(as(db, 'anon', () => db.query(`select * from public.my_month_stats('2025-08-01')`))).rejects.toThrow(/permission denied/);
  });
});

describe('coach views', () => {
  it('coach_month_table lists every active member, zeros included, best first', async () => {
    const rows = await as(db, ids.coach1, async () => (await db.query<{ full_name: string; sessions: number; rank: number | null }>(`select full_name, sessions, rank from public.coach_month_table('2025-08-01')`)).rows);
    expect(rows).toHaveLength(6); // Ali, Becca, Alex, Ashley, John, Jamie (the deactivated member is excluded)
    expect(rows.slice(0, 2).map((r) => r.full_name)).toEqual(['Alex', 'Ali Yılmaz']);
    expect(rows.find((r) => r.full_name === 'Ashley')).toMatchObject({ sessions: 0, rank: null });
  });

  it('attendance_export gives the raw records of the month, absences included', async () => {
    const rows = await as(db, ids.coach1, async () => (await db.query<{ full_name: string; status: string; slot_index: number }>(`select full_name, status, slot_index from public.attendance_export('2025-08-01')`)).rows);
    expect(rows.filter((r) => r.status === 'absent')).toEqual([{ full_name: 'Becca Kaya', status: 'absent', slot_index: 1 }]);
    expect(rows.some((r) => r.full_name === 'Eski Üye')).toBe(true); // history keeps people who left
    expect(rows.filter((r) => r.status === 'present').length).toBeGreaterThanOrEqual(9);
  });

  it('training_attendance_counts summarises trainings for the list', async () => {
    const t = await db.query<{ id: string }>(`select id from public.trainings where starts_at = '2025-08-10T05:00:00Z'`);
    const rows = await as(db, ids.coach1, async () => (await db.query<{ sessions: number; members: number }>(`select sessions, members from public.training_attendance_counts(array[$1::uuid])`, [t.rows[0]!.id])).rows);
    // present: Alex x2, Ali x2, Becca x1, John x1, Eski Üye x1  -> 7 sessions, 5 members (Becca's second hour was absent)
    expect(rows).toEqual([{ sessions: 7, members: 5 }]);
  });

  it('all three are coach-only', async () => {
    for (const sql of [`select * from public.coach_month_table('2025-08-01')`, `select * from public.attendance_export('2025-08-01')`, `select * from public.training_attendance_counts(array[]::uuid[])`]) {
      await expect(as(db, ids.member1, () => db.query(sql))).rejects.toThrow(/Yetkisiz/);
      await expect(as(db, 'anon', () => db.query(sql))).rejects.toThrow(/permission denied/);
    }
  });
});
