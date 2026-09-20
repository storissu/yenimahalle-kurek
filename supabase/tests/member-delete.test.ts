import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, ids, seedPeople } from './harness';

// delete_member(): the person goes, the club's history stays.

let db: PGlite;
let mavi = '';
const ALI = ids.member1;
const BECCA = ids.member2;
const uid = (n: number) => `00000000-0000-4000-8000-00000000e${String(n).padStart(3, '0')}`;

beforeAll(async () => {
  db = await createDb();
  await seedPeople(db);
  mavi = (await db.query<{ id: string }>(`select id from public.boats where name = 'Mavi'`)).rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const person = async (n: number, name: string, role: 'member' | 'coach' = 'member', phone: string | null = '0555 111 22 33') => {
  const id = uid(n);
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `p${n}@kulup.invalid`]);
  await db.query(`insert into public.profiles (id, username, full_name, role, phone, must_change_password) values ($1, $2, $3, $4, $5, false)`, [id, `kisi${n}`, name, role, phone]);
  return id;
};

interface Opts {
  startsAt: string;
  status?: 'completed' | 'scheduled';
  crew: string[];
  present?: string[];
}
/** One session on Mavi with a published program; attendance for `present`. */
async function training(o: Opts): Promise<string> {
  const t = (
    await db.query<{ id: string }>(
      `insert into public.trainings (starts_at, slot_count, rsvp_deadline, created_by, status)
       values ($1::timestamptz, 1, $1::timestamptz - interval '1 day', $2, $3) returning id`,
      [o.startsAt, ids.coach1, o.status ?? 'completed'],
    )
  ).rows[0]!.id;
  await db.query(`insert into public.training_programs (training_id, status, version, published_at) values ($1, 'published', 1, $2)`, [t, o.startsAt]);
  const a = (await db.query<{ id: string }>(`insert into public.program_assignments (training_id, slot_index, boat_id) values ($1, 0, $2) returning id`, [t, mavi])).rows[0]!.id;
  for (const [i, m] of o.crew.entries()) await db.query(`insert into public.program_crew (assignment_id, training_id, slot_index, member_id, seat) values ($1, $2, 0, $3, $4)`, [a, t, m, i + 1]);
  for (const m of o.present ?? []) await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ($1, 0, $2, 'present', $3)`, [t, m, ids.coach1]);
  return t;
}

const removeAs = (who: string, id: string) => as(db, who, async () => (await db.query<{ delete_member: string }>('select public.delete_member($1)', [id])).rows[0]!.delete_member);
const profile = async (id: string) => (await db.query<Record<string, unknown>>('select * from public.profiles where id = $1', [id])).rows[0];
const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`, params)).rows[0]!.n);

describe('who may delete', () => {
  it('nobody signed in — not even a coach — can call it; only the service role (the Edge Function)', async () => {
    const victim = await person(1, 'Silinecek Bir');
    for (const who of [ids.coach1, ALI]) await expect(removeAs(who, victim)).rejects.toThrow(/permission denied/);
    await expect(removeAs('anon', victim)).rejects.toThrow(/permission denied/);
    expect(await removeAs('service', victim)).toBe('deleted');
  });

  it('refuses the last active coach, and an unknown or already deleted member', async () => {
    await expect(removeAs('service', ids.coach2)).resolves.toBe('deleted'); // coach1 stays, so coach2 (who did nothing) may go
    await expect(removeAs('service', ids.coach1)).rejects.toThrow(/Son aktif antrenör/); // now the only active coach
    await expect(removeAs('service', uid(999))).rejects.toThrow(/Üye bulunamadı/);
  });
});

describe('a member nothing refers to', () => {
  it('is really deleted, together with their devices and notifications', async () => {
    const id = await person(2, 'Hiç Gelmeyen');
    await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/x', 'k', 'a')`, [id]);
    await db.query(`insert into public.notification_outbox (user_id, type, title, body, url, dedupe_key) values ($1, 'training_new', 't', 'b', '/x', 'k-e2')`, [id]);
    expect(await removeAs('service', id)).toBe('deleted');
    expect(await profile(id)).toBeUndefined();
    expect(await count('select 1 from public.push_subscriptions where user_id = $1', [id])).toBe(0);
    expect(await count('select 1 from public.notification_outbox where user_id = $1', [id])).toBe(0);
  });

  it('is also fully removed when they only had answers and places in FUTURE trainings (those vanish with them)', async () => {
    const id = await person(3, 'Sadece Yarın');
    const future = await training({ startsAt: '2099-01-01T05:00:00Z', status: 'scheduled', crew: [id, ALI] });
    await db.query(`insert into public.training_responses (training_id, member_id, response) values ($1, $2, 'attending')`, [future, id]);
    expect(await removeAs('service', id)).toBe('deleted');
    expect(await profile(id)).toBeUndefined();
    expect(await count('select 1 from public.training_responses where training_id = $1', [future])).toBe(0);
    expect(await count('select 1 from public.program_crew where training_id = $1', [future])).toBe(1); // Ali is still in the boat
  });
});

describe('a member with history', () => {
  let ayse: string; // the deleted one
  let mart: string;
  let nisan: string;
  const others = () => as(db, ids.coach1, async () => (await db.query<{ member_id: string; sessions: number; training_days: number; rank: number | null }>(`select member_id, sessions, training_days, rank from public.coach_month_table('2025-03-15') where member_id in ('${ALI}', '${BECCA}') order by member_id`)).rows);
  const sharedWithBecca = () => as(db, ALI, async () => (await db.query<{ training_id: string; slot_index: number }>('select training_id, slot_index from public.shared_boat_history($1) order by 1, 2', [BECCA])).rows);
  let beforeStats: Awaited<ReturnType<typeof others>>;
  let beforeShared: Awaited<ReturnType<typeof sharedWithBecca>>;

  beforeAll(async () => {
    ayse = await person(4, 'Ayşe Silinen', 'member', '0532 000 00 01');
    mart = await training({ startsAt: '2025-03-01T05:00:00Z', crew: [ayse, ALI], present: [ayse, ALI] });
    nisan = await training({ startsAt: '2025-04-01T05:00:00Z', crew: [ALI, BECCA], present: [ALI, BECCA] });
    await db.query(`insert into public.training_responses (training_id, member_id, response) values ($1, $2, 'attending')`, [mart, ayse]);
    await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/ayse', 'k', 'a')`, [ayse]);
    await db.query(`insert into public.notification_outbox (user_id, type, title, body, url, dedupe_key) values ($1, 'training_new', 't', 'b', '/x', 'k-ayse')`, [ayse]);
    // and an upcoming training she is planned in
    await training({ startsAt: '2099-02-01T05:00:00Z', status: 'scheduled', crew: [ayse, BECCA] }).then(async (f) => {
      await db.query(`insert into public.training_responses (training_id, member_id, response) values ($1, $2, 'attending')`, [f, ayse]);
    });
    beforeStats = await others();
    beforeShared = await sharedWithBecca();
  });

  it('keeps the profile as an anonymous tombstone: no name, phone or login name, inactive, marked deleted', async () => {
    expect(await removeAs('service', ayse)).toBe('anonymized');
    const p = await profile(ayse);
    expect(p).toMatchObject({ full_name: 'Eski üye', phone: null, is_active: false, role: 'member' });
    expect(p!.deleted_at).toBeInstanceOf(Date);
    expect(String(p!.username)).toMatch(/^silinen-[0-9a-f]{12}$/);
  });

  it('removes what is only about the person: devices, notifications, and answers/places in upcoming trainings', async () => {
    expect(await count('select 1 from public.push_subscriptions where user_id = $1', [ayse])).toBe(0);
    expect(await count('select 1 from public.notification_outbox where user_id = $1', [ayse])).toBe(0);
    expect(await count(`select 1 from public.program_crew c join public.trainings t on t.id = c.training_id where c.member_id = $1 and t.starts_at > now()`, [ayse])).toBe(0);
    expect(await count(`select 1 from public.training_responses r join public.trainings t on t.id = r.training_id where r.member_id = $1 and t.starts_at > now()`, [ayse])).toBe(0);
  });

  it('keeps the history: attendance, past crews and past answers stay, now under "Eski üye"', async () => {
    expect(await count(`select 1 from public.attendance_records where member_id = $1 and status = 'present'`, [ayse])).toBe(1);
    expect(await count('select 1 from public.program_crew where member_id = $1 and training_id = $2', [ayse, mart])).toBe(1);
    expect(await count('select 1 from public.training_responses where member_id = $1 and training_id = $2', [ayse, mart])).toBe(1);
    const exported = await as(db, ids.coach1, async () => (await db.query<{ full_name: string; status: string }>(`select full_name, status from public.attendance_export('2025-03-15') where member_id = $1`, [ayse])).rows);
    expect(exported).toEqual([{ full_name: 'Eski üye', status: 'present' }]);
  });

  it('changes nobody else\'s numbers: month table, ranks and shared boat history are exactly as before', async () => {
    expect(await others()).toEqual(beforeStats);
    expect(await sharedWithBecca()).toEqual(beforeShared);
    expect(beforeShared.map((r) => r.training_id)).toEqual([nisan]);
  });

  it('never shows up again: not in the directory, the leaderboard or the coach table; and cannot be looked up', async () => {
    const seenBy = (who: string, sql: string) => as(db, who, async () => (await db.query<Record<string, unknown>>(sql)).rows);
    expect(await seenBy(ALI, `select id from public.member_directory where id = '${ayse}'`)).toEqual([]);
    expect(await seenBy(ALI, `select member_id from public.monthly_leaderboard('2025-03-15') where member_id = '${ayse}'`)).toEqual([]);
    expect(await seenBy(ids.coach1, `select member_id from public.coach_month_table('2025-03-15') where member_id = '${ayse}'`)).toEqual([]);
    await expect(as(db, ALI, () => db.query('select * from public.member_training_history($1)', [ayse]))).rejects.toThrow(/Üye bulunamadı/);
    await expect(as(db, ALI, () => db.query('select * from public.shared_boat_history($1)', [ayse]))).rejects.toThrow(/Üye bulunamadı/);
  });

  it('frees the login name for a new member, and cannot be deleted twice', async () => {
    const id = uid(5);
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, 'yeniden@kulup.invalid']);
    await db.query(`insert into public.profiles (id, username, full_name, role, must_change_password) values ($1, 'kisi4', 'Yeniden Ayşe', 'member', false)`, [id]); // the old login name of the tombstone
    await expect(removeAs('service', ayse)).rejects.toThrow(/Üye bulunamadı/);
  });

  it('keeps a deleted COACH\'s work attributed (trainings they created stay), and demotes nothing else', async () => {
    const coach = await person(6, 'Ex Koç', 'coach');
    const t = (await db.query<{ id: string }>(`insert into public.trainings (starts_at, slot_count, rsvp_deadline, created_by, status) values ('2025-02-01T05:00:00Z', 1, '2025-01-31T05:00:00Z', $1, 'completed') returning id`, [coach])).rows[0]!.id;
    expect(await removeAs('service', coach)).toBe('anonymized');
    expect((await db.query<{ created_by: string }>('select created_by from public.trainings where id = $1', [t])).rows[0]!.created_by).toBe(coach);
    expect(await profile(coach)).toMatchObject({ full_name: 'Eski üye', role: 'coach', is_active: false });
  });
});
