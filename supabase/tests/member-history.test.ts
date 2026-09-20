import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, ids, seedPeople } from './harness';

// member_training_history(): a member's complete training history, as shown on their profile page.

let db: PGlite;
const boat: Record<'mavi' | 'turuncu', string> = { mavi: '', turuncu: '' };
const ALI = ids.member1;
const BECCA = ids.member2;

beforeAll(async () => {
  db = await createDb();
  await seedPeople(db);
  const boats = await db.query<{ id: string; name: string }>('select id, name from public.boats');
  for (const b of boats.rows) if (b.name.toLowerCase() in boat) boat[b.name.toLowerCase() as keyof typeof boat] = b.id;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

interface Slot {
  slot: number;
  boat?: string;
  crew?: string[];
  present?: string[];
  absent?: string[];
}
async function training(startsAt: string, slots: Slot[], o: { status?: 'completed' | 'scheduled'; program?: 'published' | 'draft'; title?: string } = {}): Promise<string> {
  const slotCount = Math.max(...slots.map((s) => s.slot)) + 1;
  const t = (
    await db.query<{ id: string }>(
      `insert into public.trainings (title, starts_at, slot_count, rsvp_deadline, created_by, status)
       values ($1, $2::timestamptz, $3, $2::timestamptz - interval '1 day', $4, $5) returning id`,
      [o.title ?? null, startsAt, slotCount, ids.coach1, o.status ?? 'completed'],
    )
  ).rows[0]!.id;
  if (o.program) {
    const published = o.program === 'published';
    await db.query(`insert into public.training_programs (training_id, status, version, published_at) values ($1, $2, $3, $4)`, [t, o.program, published ? 1 : 0, published ? startsAt : null]);
    for (const s of slots.filter((x) => x.boat)) {
      const a = (await db.query<{ id: string }>(`insert into public.program_assignments (training_id, slot_index, boat_id) values ($1, $2, $3) returning id`, [t, s.slot, s.boat])).rows[0]!.id;
      for (const [i, m] of (s.crew ?? []).entries()) await db.query(`insert into public.program_crew (assignment_id, training_id, slot_index, member_id, seat) values ($1, $2, $3, $4, $5)`, [a, t, s.slot, m, i + 1]);
    }
  }
  for (const s of slots) {
    for (const m of s.present ?? []) await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ($1, $2, $3, 'present', $4)`, [t, s.slot, m, ids.coach1]);
    for (const m of s.absent ?? []) await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ($1, $2, $3, 'absent', $4)`, [t, s.slot, m, ids.coach1]);
  }
  return t;
}

type Row = { training_id: string; starts_at: Date; title: string | null; slot_index: number; boat_id: string | null; boat_name: string | null };
const history = (who: string, member: string | null) => as(db, who, async () => (await db.query<Row>('select * from public.member_training_history($1)', [member])).rows);
const line = (r: Row) => `${new Date(r.starts_at).toISOString().slice(0, 10)}:${r.slot_index}:${r.boat_name ?? '-'}`;

describe('member_training_history', () => {
  it('lists every session the member was present in, newest first, with the boat where a published program had one', async () => {
    await training('2025-03-01T05:00:00Z', [{ slot: 0, boat: boat.mavi, crew: [ALI, BECCA], present: [ALI, BECCA] }, { slot: 1, boat: boat.turuncu, crew: [ALI], present: [ALI] }], { program: 'published', title: 'Mart' });
    await training('2025-04-01T05:00:00Z', [{ slot: 0, boat: boat.turuncu, crew: [BECCA], present: [BECCA] }], { program: 'published' });
    const rows = await history(BECCA, ALI);
    expect(rows.map(line)).toEqual(['2025-03-01:0:Mavi', '2025-03-01:1:Turuncu']);
    expect(rows[0]).toMatchObject({ title: 'Mart', boat_id: boat.mavi });
  });

  it('is the same for any signed-in member, a coach, and for the member themselves', async () => {
    const seen = async (who: string) => (await history(who, ALI)).map(line);
    const expected = ['2025-03-01:0:Mavi', '2025-03-01:1:Turuncu'];
    expect(await seen(BECCA)).toEqual(expected);
    expect(await seen(ids.coach1)).toEqual(expected);
    expect(await seen(ALI)).toEqual(expected);
  });

  it('counts a session without a boat (no program, or only a draft) — the boat is simply missing', async () => {
    await training('2025-05-01T05:00:00Z', [{ slot: 0, present: [ALI] }]); // no program at all
    await training('2025-05-02T05:00:00Z', [{ slot: 0, boat: boat.mavi, crew: [ALI], present: [ALI] }], { program: 'draft' });
    const rows = (await history(BECCA, ALI)).map(line);
    expect(rows.slice(0, 2)).toEqual(['2025-05-02:0:-', '2025-05-01:0:-']);
  });

  it('leaves out absences, unfinished trainings and other members\' sessions', async () => {
    await training('2025-06-01T05:00:00Z', [{ slot: 0, boat: boat.mavi, crew: [ALI, BECCA], present: [BECCA], absent: [ALI] }], { program: 'published' });
    await training('2025-06-02T05:00:00Z', [{ slot: 0, present: [ALI] }], { status: 'scheduled' });
    const rows = (await history(BECCA, ALI)).map(line);
    expect(rows.some((l) => l.startsWith('2025-06-01') || l.startsWith('2025-06-02'))).toBe(false);
    expect((await history(BECCA, BECCA)).map(line)).toContain('2025-06-01:0:Mavi');
  });

  it('returns nothing for a member who has not trained yet', async () => {
    const fresh = '00000000-0000-4000-8000-0000000000d1';
    await db.query('insert into auth.users (id, email) values ($1, $2)', [fresh, 'yeni@kulup.invalid']);
    await db.query(`insert into public.profiles (id, username, full_name, role, must_change_password) values ($1, 'yeni', 'Yeni Üye', 'member', false)`, [fresh]);
    expect(await history(ALI, fresh)).toEqual([]);
    expect(await history(ALI, null)).toEqual([]);
  });
});

describe('member_training_history: access', () => {
  it('needs an active signed-in user', async () => {
    await expect(as(db, 'anon', () => db.query('select * from public.member_training_history($1)', [ALI]))).rejects.toThrow(/permission denied/);
    for (const who of [ids.exMember, ids.exCoach]) await expect(history(who, ALI)).rejects.toThrow(/Yetkisiz/);
  });

  it('only knows active members: coaches and deactivated members are "not found"', async () => {
    await expect(history(ALI, ids.coach1)).rejects.toThrow(/Üye bulunamadı/);
    await expect(history(ALI, ids.exMember)).rejects.toThrow(/Üye bulunamadı/);
    await expect(history(ALI, '00000000-0000-4000-8000-0000000000ff')).rejects.toThrow(/Üye bulunamadı/);
  });
});
