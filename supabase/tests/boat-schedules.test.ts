import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, ids, seedPeople } from './harness';

// Independent schedules per boat: every boat session has its own start and end.

let db: PGlite;
const boat: Record<'mavi' | 'turuncu' | 'c4x', string> = { mavi: '', turuncu: '', c4x: '' };
const ALI = ids.member1;
const BECCA = ids.member2;
const p = {
  alex: '00000000-0000-4000-8000-0000000000b1',
  ashley: '00000000-0000-4000-8000-0000000000b2',
  john: '00000000-0000-4000-8000-0000000000b3',
  jamie: '00000000-0000-4000-8000-0000000000b4',
} as const;

beforeAll(async () => {
  db = await createDb();
  await seedPeople(db);
  for (const [key, name] of Object.entries({ alex: 'Alex', ashley: 'Ashley', john: 'John', jamie: 'Jamie' })) {
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

// 2099-05-05 is 08:00 in Istanbul (UTC+3): the training starts at 05:00Z.
const DAY = '2099-05-05';
const at = (hhmm: string) => `${DAY}T${hhmm}:00+03:00`;

async function newTraining(startsAt = `${DAY}T05:00:00Z`): Promise<string> {
  return (
    await db.query<{ id: string }>(
      `insert into public.trainings (starts_at, rsvp_deadline, created_by) values ($1::timestamptz, $1::timestamptz - interval '1 day', $2) returning id`,
      [startsAt, ids.coach1],
    )
  ).rows[0]!.id;
}

interface Session {
  slot_index: number;
  boat_id: string;
  crew: string[];
  starts_at?: string;
  ends_at?: string;
  notes?: string;
}
const save = (training: string, sessions: Session[], publish = false) =>
  as(db, ids.coach1, () => db.query('select public.save_program($1, $2::jsonb, $3)', [training, JSON.stringify({ assignments: sessions }), publish]));

const hm = (col: string) => `to_char(${col} at time zone 'Europe/Istanbul', 'HH24:MI')`;
const sessionsOf = async (training: string) =>
  (
    await db.query<{ slot_index: number; boat: string; span: string }>(
      `select a.slot_index, b.name as boat, ${hm('a.starts_at')} || '–' || ${hm('a.ends_at')} as span
         from public.program_assignments a join public.boats b on b.id = a.boat_id where a.training_id = $1 order by b.name, a.starts_at`,
      [training],
    )
  ).rows.map((r) => `${r.boat} ${r.span} #${r.slot_index}`);
const trainingRow = async (training: string) =>
  (await db.query<{ slot_count: number; span: string | null }>(`select slot_count, ${hm('starts_at')} || coalesce('–' || ${hm('ends_at')}, '') as span from public.trainings where id = $1`, [training])).rows[0]!;

describe('every boat has its own schedule', () => {
  it('stores each session with its own start and end, whatever the other boats do', async () => {
    const t = await newTraining();
    await save(t, [
      { slot_index: 0, boat_id: boat.mavi, crew: [ALI, p.john], starts_at: at('08:00'), ends_at: at('09:00') },
      { slot_index: 1, boat_id: boat.mavi, crew: [p.alex, p.ashley], starts_at: at('09:00'), ends_at: at('10:00') },
      { slot_index: 2, boat_id: boat.turuncu, crew: [BECCA, p.jamie], starts_at: at('08:15'), ends_at: at('09:15') },
      { slot_index: 3, boat_id: boat.turuncu, crew: [p.john, p.jamie], starts_at: at('09:15'), ends_at: at('10:15') },
    ]);
    expect(await sessionsOf(t)).toEqual(['Mavi 08:00–09:00 #0', 'Mavi 09:00–10:00 #1', 'Turuncu 08:15–09:15 #2', 'Turuncu 09:15–10:15 #3']);
  });

  it('derives the training\'s end from the last session, and its session bound from the highest number', async () => {
    const t = await newTraining();
    expect(await trainingRow(t)).toEqual({ slot_count: 0, span: '08:00' }); // nothing planned yet
    await save(t, [
      { slot_index: 0, boat_id: boat.mavi, crew: [ALI], starts_at: at('08:00'), ends_at: at('09:00') },
      { slot_index: 1, boat_id: boat.turuncu, crew: [BECCA], starts_at: at('08:15'), ends_at: at('09:15') },
      { slot_index: 2, boat_id: boat.c4x, crew: [p.alex, p.ashley, p.john, p.jamie], starts_at: at('08:30'), ends_at: at('10:00') },
    ]);
    expect(await trainingRow(t)).toEqual({ slot_count: 3, span: '08:00–10:00' });
  });

  it('allows exceptional lengths: 09:15 ends, a gap, a half hour', async () => {
    const t = await newTraining();
    await save(t, [
      { slot_index: 0, boat_id: boat.mavi, crew: [ALI], starts_at: at('08:00'), ends_at: at('09:15') },
      { slot_index: 1, boat_id: boat.mavi, crew: [BECCA], starts_at: at('09:15'), ends_at: at('10:15') },
      { slot_index: 2, boat_id: boat.mavi, crew: [p.alex], starts_at: at('10:30'), ends_at: at('11:00') },
    ]);
    expect(await sessionsOf(t)).toEqual(['Mavi 08:00–09:15 #0', 'Mavi 09:15–10:15 #1', 'Mavi 10:30–11:00 #2']);
    expect((await trainingRow(t)).span).toBe('08:00–11:00');
  });

  it('keeps the old hourly grid for a program saved without times (older clients and data)', async () => {
    const t = await newTraining();
    await save(t, [
      { slot_index: 0, boat_id: boat.mavi, crew: [ALI] },
      { slot_index: 0, boat_id: boat.turuncu, crew: [BECCA] },
      { slot_index: 1, boat_id: boat.mavi, crew: [p.alex] },
    ]);
    expect(await sessionsOf(t)).toEqual(['Mavi 08:00–09:00 #0', 'Mavi 09:00–10:00 #1', 'Turuncu 08:00–09:00 #0']);
    expect((await trainingRow(t)).span).toBe('08:00–10:00');
  });

  it('moving the training moves every session with it and keeps their offsets', async () => {
    const t = await newTraining();
    await save(t, [
      { slot_index: 0, boat_id: boat.mavi, crew: [ALI], starts_at: at('08:00'), ends_at: at('09:00') },
      { slot_index: 1, boat_id: boat.turuncu, crew: [BECCA], starts_at: at('08:15'), ends_at: at('09:15') },
    ]);
    await as(db, ids.coach1, () => db.query(`update public.trainings set starts_at = starts_at + interval '90 minutes' where id = $1`, [t]));
    expect(await sessionsOf(t)).toEqual(['Mavi 09:30–10:30 #0', 'Turuncu 09:45–10:45 #1']);
    expect((await trainingRow(t)).span).toBe('09:30–10:45');
  });
});

describe('what the schedule may not do', () => {
  it('lets a person row two boats one after the other, but never at the same time', async () => {
    const t = await newTraining();
    await save(t, [
      { slot_index: 0, boat_id: boat.mavi, crew: [ALI], starts_at: at('08:00'), ends_at: at('09:00') },
      { slot_index: 1, boat_id: boat.turuncu, crew: [ALI], starts_at: at('09:00'), ends_at: at('10:00') }, // starts as the other ends: fine
    ]);
    await expect(
      save(t, [
        { slot_index: 0, boat_id: boat.mavi, crew: [ALI], starts_at: at('08:00'), ends_at: at('09:00') },
        { slot_index: 1, boat_id: boat.turuncu, crew: [ALI], starts_at: at('08:45'), ends_at: at('09:45') },
      ]),
    ).rejects.toThrow(/Ali Yılmaz aynı saatte iki teknede olamaz: 08:00–09:00 ve 08:45–09:45/);
    expect(await sessionsOf(t)).toEqual(['Mavi 08:00–09:00 #0', 'Turuncu 09:00–10:00 #1']); // all-or-nothing: the good save stays
  });

  it('never lets one boat be on the water twice at once', async () => {
    const t = await newTraining();
    await expect(
      save(t, [
        { slot_index: 0, boat_id: boat.mavi, crew: [ALI], starts_at: at('08:00'), ends_at: at('09:00') },
        { slot_index: 1, boat_id: boat.mavi, crew: [BECCA], starts_at: at('08:59'), ends_at: at('10:00') },
      ]),
    ).rejects.toThrow(/Mavi teknesinin seansları çakışıyor: 08:00–09:00 ve 08:59–10:00/);
  });

  it('is fine for different boats to overlap completely', async () => {
    const t = await newTraining();
    await save(t, [
      { slot_index: 0, boat_id: boat.mavi, crew: [ALI], starts_at: at('08:00'), ends_at: at('09:00') },
      { slot_index: 1, boat_id: boat.turuncu, crew: [BECCA], starts_at: at('08:00'), ends_at: at('09:00') },
    ]);
    expect(await sessionsOf(t)).toHaveLength(2);
  });

  it.each([
    ['ends before it starts', { starts_at: at('09:00'), ends_at: at('08:30') }, /bitişi başlangıcından sonra olmalı/],
    ['has no length', { starts_at: at('09:00'), ends_at: at('09:00') }, /bitişi başlangıcından sonra olmalı/],
    ['is longer than 8 hours', { starts_at: at('08:00'), ends_at: at('16:01') }, /en fazla 8 saat/],
    ['starts before the training does', { starts_at: at('07:45'), ends_at: at('08:45') }, /antrenmanın başlangıcından \(08:00\) önce başlayamaz/],
    ['is not a time at all', { starts_at: 'sabah', ends_at: at('09:00') }, /Geçersiz seans saati/],
  ])('refuses a session that %s', async (_label, times, message) => {
    const t = await newTraining();
    await expect(save(t, [{ slot_index: 0, boat_id: boat.mavi, crew: [ALI], ...times }])).rejects.toThrow(message);
  });

  it('a C4X session must be full, and the message says which session', async () => {
    const t = await newTraining();
    await expect(save(t, [{ slot_index: 0, boat_id: boat.c4x, crew: [ALI, BECCA], starts_at: at('08:30'), ends_at: at('09:30') }], true)).rejects.toThrow(/C4X teknesinde tam 4 kişi olmalı \(08:30–09:30 seansında 2 kişi var\)/);
  });
});

describe('telling the members', () => {
  const outbox = async (member: string) =>
    (await db.query<{ title: string; body: string }>(`select title, body from public.notification_outbox where user_id = $1 and type in ('program_published', 'program_updated') order by created_at, id`, [member])).rows;

  it('names the boat and the boat\'s own time in each member\'s message', async () => {
    const t = await newTraining();
    await save(t, [
      { slot_index: 0, boat_id: boat.mavi, crew: [ALI, p.john], starts_at: at('08:00'), ends_at: at('09:00') },
      { slot_index: 1, boat_id: boat.turuncu, crew: [BECCA, p.jamie], starts_at: at('08:15'), ends_at: at('09:15') },
    ], true);
    const [ali] = await outbox(ALI);
    const [becca] = await outbox(BECCA);
    expect(ali?.body).toContain('08:00–09:00 · Mavi · John Üye'.replace(' Üye', '')); // "John ile"
    expect(becca?.body).toContain('08:15–09:15 · Turuncu');
    expect(becca?.body).not.toContain('08:00–09:00');
  });

  it('tells only the people of a session whose TIME moved (same crew), not the members of untouched sessions', async () => {
    const t = await newTraining();
    const base: Session[] = [
      { slot_index: 0, boat_id: boat.mavi, crew: [p.alex], starts_at: at('08:00'), ends_at: at('09:00') },
      { slot_index: 1, boat_id: boat.turuncu, crew: [p.ashley], starts_at: at('08:00'), ends_at: at('09:00') },
    ];
    await save(t, base, true);
    await save(t, [{ ...base[0]!, starts_at: at('08:10'), ends_at: at('09:10') }, base[1]!], true);
    const alex = await outbox(p.alex);
    const ashley = await outbox(p.ashley);
    expect(alex.map((n) => n.title)).toEqual(['Programınız hazır', 'Programınız güncellendi']);
    expect(alex[1]?.body).toContain('08:10–09:10 · Mavi');
    expect(ashley.map((n) => n.title)).toEqual(['Programınız hazır']); // Turuncu did not change
  });

  it('training announcements show the real span of the schedule', async () => {
    const t = await newTraining();
    await save(t, [{ slot_index: 0, boat_id: boat.mavi, crew: [ALI], starts_at: at('08:00'), ends_at: at('09:30') }]);
    await as(db, ids.coach1, () => db.query(`update public.trainings set starts_at = starts_at + interval '1 hour' where id = $1`, [t]));
    const changed = (await db.query<{ body: string }>(`select body from public.notification_outbox where training_id = $1 and type = 'training_changed' limit 1`, [t])).rows[0];
    expect(changed?.body).toContain('09:00–10:30');
  });
});

describe('attendance and history follow the sessions', () => {
  // A training that started 5 hours ago, so attendance may be taken.
  async function pastTraining(): Promise<string> {
    return (
      await db.query<{ id: string }>(
        `insert into public.trainings (starts_at, rsvp_deadline, created_by) values (now() - interval '5 hours', now() - interval '1 day', $1) returning id`,
        [ids.coach1],
      )
    ).rows[0]!.id;
  }
  const offset = (t: string, minutes: number) => db.query<{ v: string }>(`select (starts_at + $2 * interval '1 minute')::text as v from public.trainings where id = $1`, [t, minutes]).then((r) => r.rows[0]!.v);

  it('stamps each attendance record with the time of its session; a session without a program keeps the hourly grid', async () => {
    const t = await pastTraining();
    await save(t, [
      { slot_index: 0, boat_id: boat.mavi, crew: [ALI], starts_at: await offset(t, 0), ends_at: await offset(t, 60) },
      { slot_index: 1, boat_id: boat.turuncu, crew: [BECCA], starts_at: await offset(t, 15), ends_at: await offset(t, 90) },
    ]);
    await as(db, ids.coach1, () =>
      db.query('select public.save_attendance($1, $2::jsonb, true)', [
        t,
        JSON.stringify([
          { slot_index: 0, member_id: ALI, status: 'present' },
          { slot_index: 1, member_id: BECCA, status: 'present' },
          { slot_index: 2, member_id: p.alex, status: 'present' }, // an extra session nobody planned
        ]),
      ]),
    );
    const rows = (
      await db.query<{ slot_index: number; mins: number; length: number }>(
        `select r.slot_index, (extract(epoch from r.starts_at - t.starts_at) / 60)::int as mins, (extract(epoch from r.ends_at - r.starts_at) / 60)::int as length
           from public.attendance_records r join public.trainings t on t.id = r.training_id where r.training_id = $1 order by r.slot_index`,
        [t],
      )
    ).rows;
    expect(rows).toEqual([
      { slot_index: 0, mins: 0, length: 60 },
      { slot_index: 1, mins: 15, length: 75 },
      { slot_index: 2, mins: 120, length: 60 }, // no session 2 in the program: start + 2 hours
    ]);
  });

  it('member and shared history, and the export, say when each session was', async () => {
    const t = await pastTraining();
    await save(t, [{ slot_index: 0, boat_id: boat.c4x, crew: [ALI, BECCA, p.john, p.jamie], starts_at: await offset(t, 30), ends_at: await offset(t, 105) }], true);
    await as(db, ids.coach1, () =>
      db.query('select public.save_attendance($1, $2::jsonb, true)', [t, JSON.stringify([ALI, BECCA, p.john, p.jamie].map((m) => ({ slot_index: 0, member_id: m, status: 'present' })))]),
    );
    const minutes = (r: { session_starts_at: Date; session_ends_at: Date; starts_at: Date }) => [
      Math.round((+r.session_starts_at - +r.starts_at) / 60_000),
      Math.round((+r.session_ends_at - +r.session_starts_at) / 60_000),
    ];
    const own = await as(db, BECCA, async () => (await db.query<{ session_starts_at: Date; session_ends_at: Date; starts_at: Date; training_id: string }>('select * from public.member_training_history($1)', [ALI])).rows);
    expect(minutes(own.find((r) => r.training_id === t)!)).toEqual([30, 75]);
    const shared = await as(db, BECCA, async () => (await db.query<{ session_starts_at: Date; session_ends_at: Date; starts_at: Date; training_id: string; boat_name: string }>('select * from public.shared_boat_history($1)', [ALI])).rows);
    const row = shared.find((r) => r.training_id === t)!;
    expect(row.boat_name).toBe('C4X');
    expect(minutes(row)).toEqual([30, 75]);
    const exported = await as(db, ids.coach1, async () => (await db.query<{ session_starts_at: Date; session_ends_at: Date; starts_at: Date; training_id: string }>(`select * from public.attendance_export(current_date)`)).rows);
    expect(exported.filter((r) => r.training_id === t).map((r) => minutes(r)[1])).toEqual([75, 75, 75, 75]);
  });
});
