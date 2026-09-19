import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, ids, seedPeople } from './harness';

let db: PGlite;
const boat: Record<'mavi' | 'turuncu' | 'c4x', string> = { mavi: '', turuncu: '', c4x: '' };
const p = {
  alex: '00000000-0000-4000-8000-0000000000b1',
  ashley: '00000000-0000-4000-8000-0000000000b2',
  john: '00000000-0000-4000-8000-0000000000b3',
} as const;
const ALI = ids.member1;
const BECCA = ids.member2;

beforeAll(async () => {
  db = await createDb();
  await seedPeople(db);
  for (const [key, name] of Object.entries({ alex: 'Alex', ashley: 'Ashley', john: 'John' })) {
    const id = p[key as keyof typeof p];
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@kulup.invalid`]);
    await db.query(`insert into public.profiles (id, username, full_name, role, must_change_password) values ($1, $2, $3, 'member', false)`, [id, key, name]);
  }
  const boats = await db.query<{ id: string; name: string }>('select id, name from public.boats');
  for (const b of boats.rows) boat[b.name.toLowerCase() as keyof typeof boat] = b.id;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

interface Slot {
  slot: number;
  boat: string;
  crew: string[];
  present?: string[]; // default: the whole crew
  absent?: string[];
}
interface Opts {
  startsAt: string;
  slots: Slot[];
  status?: 'completed' | 'scheduled';
  program?: 'published' | 'draft' | 'none';
  title?: string;
}

/** A finished training with a program and attendance, inserted as the database owner. */
async function training(o: Opts): Promise<string> {
  const slotCount = Math.max(...o.slots.map((s) => s.slot)) + 1;
  const t = (await db.query<{ id: string }>(
    `insert into public.trainings (title, starts_at, slot_count, rsvp_deadline, created_by, status)
     values ($1, $2::timestamptz, $3, $2::timestamptz - interval '1 day', $4, $5) returning id`,
    [o.title ?? null, o.startsAt, slotCount, ids.coach1, o.status ?? 'completed'],
  )).rows[0]!.id;
  if ((o.program ?? 'published') !== 'none') {
    const published = (o.program ?? 'published') === 'published';
    await db.query(`insert into public.training_programs (training_id, status, version, published_at) values ($1, $2, $3, $4)`, [t, o.program ?? 'published', published ? 1 : 0, published ? o.startsAt : null]);
    for (const s of o.slots) {
      const a = (await db.query<{ id: string }>(`insert into public.program_assignments (training_id, slot_index, boat_id) values ($1, $2, $3) returning id`, [t, s.slot, s.boat])).rows[0]!.id;
      for (const [i, member] of s.crew.entries()) {
        await db.query(`insert into public.program_crew (assignment_id, training_id, slot_index, member_id, seat) values ($1, $2, $3, $4, $5)`, [a, t, s.slot, member, i + 1]);
      }
    }
  }
  for (const s of o.slots) {
    for (const m of s.present ?? s.crew) await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ($1, $2, $3, 'present', $4)`, [t, s.slot, m, ids.coach1]);
    for (const m of s.absent ?? []) await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ($1, $2, $3, 'absent', $4)`, [t, s.slot, m, ids.coach1]);
  }
  return t;
}

type Row = { training_id: string; starts_at: Date; title: string | null; slot_index: number; boat_id: string; boat_name: string };
const history = (who: string, other: string | null) =>
  as(db, who, async () => (await db.query<Row>('select * from public.shared_boat_history($1)', [other])).rows);
const day = (d: Date) => new Date(d).toISOString().slice(0, 10);
const summary = (rows: Row[]) => rows.map((r) => `${day(r.starts_at)}:${r.slot_index}:${r.boat_name}`);

describe('shared_boat_history: what counts as "trained together"', () => {
  it('lists sessions in which both were in the same boat, newest first, with the boat', async () => {
    await training({ startsAt: '2025-03-01T05:00:00Z', title: 'Mart', slots: [{ slot: 0, boat: boat.mavi, crew: [ALI, BECCA] }, { slot: 1, boat: boat.turuncu, crew: [ALI, BECCA] }] });
    await training({ startsAt: '2025-04-01T05:00:00Z', slots: [{ slot: 0, boat: boat.c4x, crew: [ALI, BECCA, p.alex, p.john] }] });
    const rows = await history(ALI, BECCA);
    expect(summary(rows)).toEqual(['2025-04-01:0:C4X', '2025-03-01:0:Mavi', '2025-03-01:1:Turuncu']);
    expect(rows[2]).toMatchObject({ title: 'Mart', boat_id: boat.turuncu });
  });

  it('is the same from the other member\'s side', async () => {
    expect(summary(await history(BECCA, ALI))).toEqual(summary(await history(ALI, BECCA)));
  });

  it('does NOT count the same session in different boats', async () => {
    const t = await training({ startsAt: '2025-05-01T05:00:00Z', slots: [{ slot: 0, boat: boat.mavi, crew: [ALI, p.alex] }, { slot: 0, boat: boat.turuncu, crew: [BECCA, p.ashley] }] });
    expect((await history(ALI, BECCA)).some((r) => r.training_id === t)).toBe(false);
    expect(summary(await history(ALI, p.alex))).toEqual(['2025-05-01:0:Mavi', '2025-04-01:0:C4X']); // Mavi in May, and the April C4X they also shared
  });

  it('does NOT count a session the same person did not actually row (absent), and a boat they were only planned in', async () => {
    const t = await training({ startsAt: '2025-06-01T05:00:00Z', slots: [{ slot: 0, boat: boat.mavi, crew: [ALI, p.ashley], present: [ALI], absent: [p.ashley] }] });
    expect((await history(ALI, p.ashley)).some((r) => r.training_id === t)).toBe(false);
    const u = await training({ startsAt: '2025-06-02T05:00:00Z', slots: [{ slot: 0, boat: boat.mavi, crew: [ALI, p.ashley], present: [p.ashley] }] });
    expect((await history(ALI, p.ashley)).some((r) => r.training_id === u)).toBe(false); // the caller was absent
  });

  it('does NOT count trainings that are not completed, drafts, or trainings without a program', async () => {
    const open = await training({ startsAt: '2025-07-01T05:00:00Z', status: 'scheduled', slots: [{ slot: 0, boat: boat.mavi, crew: [ALI, p.john] }] });
    const draft = await training({ startsAt: '2025-07-02T05:00:00Z', program: 'draft', slots: [{ slot: 0, boat: boat.mavi, crew: [ALI, p.john] }] });
    const none = await training({ startsAt: '2025-07-03T05:00:00Z', program: 'none', slots: [{ slot: 0, boat: boat.mavi, crew: [ALI, p.john] }] });
    const found = (await history(ALI, p.john)).map((r) => r.training_id);
    for (const t of [open, draft, none]) expect(found).not.toContain(t);
    expect(summary(await history(ALI, p.john))).toEqual(['2025-04-01:0:C4X']); // the only time they really shared a boat
  });

  it('shows different boats across sessions of one training as separate rows', async () => {
    await training({ startsAt: '2025-08-01T05:00:00Z', slots: [{ slot: 0, boat: boat.mavi, crew: [p.ashley, p.john] }, { slot: 1, boat: boat.turuncu, crew: [p.ashley, p.john] }, { slot: 2, boat: boat.mavi, crew: [p.ashley, p.alex] }] });
    expect(summary(await history(p.ashley, p.john))).toEqual(['2025-08-01:0:Mavi', '2025-08-01:1:Turuncu']);
  });
});

describe('shared_boat_history: privacy and access', () => {
  it('never reveals trainings the caller did not row in', async () => {
    const secret = await training({ startsAt: '2025-09-01T05:00:00Z', slots: [{ slot: 0, boat: boat.c4x, crew: [BECCA, p.alex, p.ashley, p.john] }] });
    for (const other of [BECCA, p.alex, p.ashley, p.john]) expect((await history(ALI, other)).some((r) => r.training_id === secret)).toBe(false);
  });

  it('answers with nothing when asking about yourself or nobody', async () => {
    expect(await history(ALI, ALI)).toEqual([]);
    expect(await history(ALI, null)).toEqual([]);
  });

  it('refuses unknown people, coaches and deactivated members with a Turkish message', async () => {
    await expect(history(ALI, '00000000-0000-4000-8000-000000000999')).rejects.toThrow(/Üye bulunamadı/);
    await expect(history(ALI, ids.coach1)).rejects.toThrow(/Üye bulunamadı/);
    await expect(history(ALI, ids.exMember)).rejects.toThrow(/Üye bulunamadı/);
  });

  it('is only for signed-in active users; a coach simply sees nothing (coaches are in no crew)', async () => {
    await expect(history(ids.exMember, ALI)).rejects.toThrow(/Yetkisiz/);
    await expect(as(db, 'anon', () => db.query('select * from public.shared_boat_history($1)', [ALI]))).rejects.toThrow(/permission denied/);
    expect(await history(ids.coach1, ALI)).toEqual([]);
  });

  it('caps the answer at 200 sessions', async () => {
    const t = await training({ startsAt: '2024-01-01T05:00:00Z', slots: [{ slot: 0, boat: boat.mavi, crew: [p.alex, p.john] }] });
    // 205 more sessions of the same pair, generated in bulk
    await db.query(
      `with new_t as (
         insert into public.trainings (starts_at, slot_count, rsvp_deadline, created_by, status)
         select '2023-01-01T05:00:00Z'::timestamptz + n * interval '1 day', 1, '2022-12-31T05:00:00Z'::timestamptz + n * interval '1 day', $1, 'completed'
           from generate_series(1, 205) n returning id)
       insert into public.training_programs (training_id, status, version, published_at) select id, 'published', 1, now() from new_t`,
      [ids.coach1],
    );
    await db.query(`insert into public.program_assignments (training_id, slot_index, boat_id) select training_id, 0, $1 from public.training_programs where training_id <> $2 and training_id in (select id from public.trainings where starts_at >= '2023-01-01' and starts_at < '2023-08-01')`, [boat.mavi, t]);
    await db.query(`insert into public.program_crew (assignment_id, training_id, slot_index, member_id, seat) select a.id, a.training_id, 0, m.member, m.seat from public.program_assignments a cross join (values ('${p.alex}'::uuid, 1), ('${p.john}'::uuid, 2)) m(member, seat) where a.training_id <> $1 and a.training_id in (select id from public.trainings where starts_at >= '2023-01-01' and starts_at < '2023-08-01')`, [t]);
    await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) select a.training_id, 0, m.member, 'present', $1 from public.program_assignments a cross join (values ('${p.alex}'::uuid), ('${p.john}'::uuid)) m(member) where a.training_id <> $2 and a.training_id in (select id from public.trainings where starts_at >= '2023-01-01' and starts_at < '2023-08-01')`, [ids.coach1, t]);
    const rows = await history(p.alex, p.john);
    expect(rows).toHaveLength(200);
    expect(new Date(rows[0]!.starts_at).getTime()).toBeGreaterThan(new Date(rows[199]!.starts_at).getTime()); // newest first
  });
});
