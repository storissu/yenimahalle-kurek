import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, ids, seedPeople } from './harness';

let db: PGlite;
const boat: Record<'mavi' | 'turuncu' | 'c4x', string> = { mavi: '', turuncu: '', c4x: '' };
// Extra members for full crews: Alex, Ashley, John, Jamie (+ ids.member1 "Ali", ids.member2 "Becca").
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
    await db.query(
      `insert into public.profiles (id, username, full_name, role, must_change_password) values ($1, $2, $3, 'member', false)`,
      [id, key, `${name} Üye`],
    );
  }
  const boats = await db.query<{ id: string; name: string }>('select id, name from public.boats');
  for (const b of boats.rows) boat[b.name.toLowerCase() as keyof typeof boat] = b.id;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function newTraining(slots = 3, status: 'scheduled' | 'cancelled' = 'scheduled'): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.trainings (starts_at, slot_count, rsvp_deadline, created_by, status, cancel_reason)
     values (now() + interval '2 days', $1, now() + interval '1 day', $2, $3, $4) returning id`,
    [slots, ids.coach1, status, status === 'cancelled' ? 'Fırtına' : null],
  );
  return (res.rows[0] as { id: string }).id;
}

type Entry = { slot_index: number; boat_id: string; crew: string[]; notes?: string };
const payload = (assignments: Entry[], extras: Record<string, unknown> = {}) => ({ assignments, ...extras });

const save = (training: string, body: unknown, publish = false) =>
  db.query('select public.save_program($1, $2::jsonb, $3)', [training, JSON.stringify(body), publish]);
const asCoach = (training: string, body: unknown, publish = false) => as(db, ids.coach1, () => save(training, body, publish));

const crewOf = async (training: string) =>
  (
    await db.query<{ slot_index: number; boat: string; member_id: string; seat: number }>(
      `select c.slot_index, b.name as boat, c.member_id, c.seat
         from public.program_crew c join public.program_assignments a on a.id = c.assignment_id join public.boats b on b.id = a.boat_id
        where c.training_id = $1 order by c.slot_index, b.name, c.seat`,
      [training],
    )
  ).rows;

const programOf = async (training: string) =>
  (await db.query<{ status: string; version: number; published_at: string | null; published_by: string | null; weather_note: string | null; training_notes: string | null }>(
    'select status, version, published_at, published_by, weather_note, training_notes from public.training_programs where training_id = $1',
    [training],
  )).rows[0];

describe('save_program: building a program', () => {
  it('supports the club example: boats on the water together, different crews per hour', async () => {
    const t = await newTraining(2);
    await asCoach(
      t,
      payload([
        { slot_index: 0, boat_id: boat.mavi, crew: [extra.alex, extra.ashley] },
        { slot_index: 1, boat_id: boat.mavi, crew: [extra.john, extra.jamie] },
        { slot_index: 0, boat_id: boat.turuncu, crew: [ids.member1, ids.member2] },
      ]),
    );
    expect(await crewOf(t)).toEqual([
      { slot_index: 0, boat: 'Mavi', member_id: extra.alex, seat: 1 },
      { slot_index: 0, boat: 'Mavi', member_id: extra.ashley, seat: 2 },
      { slot_index: 0, boat: 'Turuncu', member_id: ids.member1, seat: 1 },
      { slot_index: 0, boat: 'Turuncu', member_id: ids.member2, seat: 2 },
      { slot_index: 1, boat: 'Mavi', member_id: extra.john, seat: 1 },
      { slot_index: 1, boat: 'Mavi', member_id: extra.jamie, seat: 2 },
    ]);
  });

  it('lets the same member row in several hours, in different boats', async () => {
    const t = await newTraining(2);
    await asCoach(
      t,
      payload([
        { slot_index: 0, boat_id: boat.mavi, crew: [extra.alex] },
        { slot_index: 1, boat_id: boat.turuncu, crew: [extra.alex] },
      ]),
    );
    expect((await crewOf(t)).map((r) => `${r.slot_index}:${r.boat}`)).toEqual(['0:Mavi', '1:Turuncu']);
  });

  it('fills the four-person C4X and lets a boat carry fewer people than its capacity', async () => {
    const t = await newTraining(1);
    await asCoach(
      t,
      payload([
        { slot_index: 0, boat_id: boat.c4x, crew: [extra.alex, extra.ashley, extra.john, extra.jamie] },
        { slot_index: 0, boat_id: boat.mavi, crew: [ids.member1] },
      ]),
    );
    expect(await crewOf(t)).toHaveLength(5);
  });

  it('keeps notes (trimmed) and ignores boats without a crew', async () => {
    const t = await newTraining(1);
    await asCoach(
      t,
      payload(
        [
          { slot_index: 0, boat_id: boat.mavi, crew: [extra.alex], notes: '  teknik çalışma  ' },
          { slot_index: 0, boat_id: boat.turuncu, crew: [] },
        ],
        { weather_note: '  Rüzgâr batıdan  ', training_notes: '  Isınma 10 dk  ' },
      ),
    );
    const notes = (await db.query<{ notes: string | null }>('select notes from public.program_assignments where training_id = $1', [t])).rows;
    expect(notes).toEqual([{ notes: 'teknik çalışma' }]);
    expect(await programOf(t)).toMatchObject({ weather_note: 'Rüzgâr batıdan', training_notes: 'Isınma 10 dk' });
  });

  it('replaces the previous program instead of adding to it', async () => {
    const t = await newTraining(2);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex, extra.ashley] }]));
    await asCoach(t, payload([{ slot_index: 1, boat_id: boat.turuncu, crew: [extra.john] }]));
    expect((await crewOf(t)).map((r) => `${r.slot_index}:${r.boat}:${r.member_id}`)).toEqual([`1:Turuncu:${extra.john}`]);
  });

  it('accepts an empty draft', async () => {
    const t = await newTraining(1);
    await asCoach(t, payload([]));
    expect(await programOf(t)).toMatchObject({ status: 'draft', version: 0 });
    expect(await crewOf(t)).toEqual([]);
  });
});

describe('save_program: draft vs published', () => {
  it('publishes (version 1), republishes (version 2) and can go back to draft', async () => {
    const t = await newTraining(1);
    const body = payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex] }]);

    await asCoach(t, body);
    expect(await programOf(t)).toMatchObject({ status: 'draft', version: 0, published_at: null });

    await asCoach(t, body, true);
    const first = await programOf(t);
    expect(first).toMatchObject({ status: 'published', version: 1, published_by: ids.coach1 });
    expect(first?.published_at).not.toBeNull();

    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex, extra.ashley] }]), true);
    expect(await programOf(t)).toMatchObject({ status: 'published', version: 2 });
    expect(await crewOf(t)).toHaveLength(2);

    await asCoach(t, body, false);
    expect(await programOf(t)).toMatchObject({ status: 'draft', version: 2, published_at: null, published_by: null });
  });

  it('refuses to publish a program without any crew', async () => {
    const t = await newTraining(1);
    await expect(asCoach(t, payload([]), true)).rejects.toThrow(/en az bir tekneye ekip/);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [] }]), true)).rejects.toThrow(/en az bir tekneye ekip/);
  });
});

describe('save_program: validation (all-or-nothing)', () => {
  it('rejects more people than a boat holds', async () => {
    const t = await newTraining(1);
    await expect(
      asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex, extra.ashley, extra.john] }])),
    ).rejects.toThrow(/Mavi teknesine en fazla 2 kişi/);
    await expect(
      asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: [extra.alex, extra.ashley, extra.john, extra.jamie, ids.member1] }])),
    ).rejects.toThrow(/C4X teknesine en fazla 4 kişi/);
  });

  it('rejects a member in two boats in the same hour', async () => {
    const t = await newTraining(1);
    await expect(
      asCoach(t, payload([
        { slot_index: 0, boat_id: boat.mavi, crew: [extra.alex] },
        { slot_index: 0, boat_id: boat.turuncu, crew: [extra.alex] },
      ])),
    ).rejects.toThrow(/Alex Üye aynı seansta iki teknede olamaz/);
  });

  it('rejects the same member twice in one boat', async () => {
    const t = await newTraining(1);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex, extra.alex] }]))).rejects.toThrow(/aynı seansta iki teknede/);
  });

  it('rejects a boat used twice in the same hour', async () => {
    const t = await newTraining(1);
    await expect(
      asCoach(t, payload([
        { slot_index: 0, boat_id: boat.mavi, crew: [extra.alex] },
        { slot_index: 0, boat_id: boat.mavi, crew: [extra.ashley] },
      ])),
    ).rejects.toThrow(/Mavi teknesi aynı seansta iki kez/);
  });

  it('rejects hours the training does not have', async () => {
    const t = await newTraining(2);
    await expect(asCoach(t, payload([{ slot_index: 2, boat_id: boat.mavi, crew: [extra.alex] }]))).rejects.toThrow(/Geçersiz seans/);
    await expect(asCoach(t, payload([{ slot_index: -1, boat_id: boat.mavi, crew: [extra.alex] }]))).rejects.toThrow(/Geçersiz seans/);
  });

  it('rejects unknown boats, unknown or non-member crew, and malformed data', async () => {
    const t = await newTraining(1);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: '00000000-0000-4000-8000-000000000999', crew: [extra.alex] }]))).rejects.toThrow(/Tekne bulunamadı/);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: 'not-a-uuid', crew: [extra.alex] }]))).rejects.toThrow(/Geçersiz tekne/);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: ['zzz'] }]))).rejects.toThrow(/Geçersiz üye/);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [ids.coach2] }]))).rejects.toThrow(/yalnızca üyelerden/);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: ['00000000-0000-4000-8000-000000000999'] }]))).rejects.toThrow(/yalnızca üyelerden/);
    await expect(asCoach(t, { assignments: 'x' })).rejects.toThrow(/Geçersiz program verisi/);
    await expect(asCoach(t, { assignments: [{ boat_id: boat.mavi, crew: [extra.alex] }] })).rejects.toThrow(/Geçersiz program verisi/);
    await expect(asCoach(t, [])).rejects.toThrow(/Geçersiz program verisi/);
  });

  it('rejects over-long notes', async () => {
    const t = await newTraining(1);
    await expect(asCoach(t, payload([], { weather_note: 'x'.repeat(501) }))).rejects.toThrow(/en fazla 500/);
    await expect(asCoach(t, payload([], { training_notes: 'x'.repeat(1001) }))).rejects.toThrow(/en fazla 1000/);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex], notes: 'x'.repeat(201) }]))).rejects.toThrow(/en fazla 200/);
  });

  it('is atomic: a failed save leaves the previous program untouched', async () => {
    const t = await newTraining(1);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex, extra.ashley] }]), true);
    await expect(
      asCoach(t, payload([
        { slot_index: 0, boat_id: boat.mavi, crew: [extra.john] },
        { slot_index: 0, boat_id: boat.turuncu, crew: [extra.john] }, // invalid: same member twice
      ]), true),
    ).rejects.toThrow();
    expect((await crewOf(t)).map((r) => r.member_id)).toEqual([extra.alex, extra.ashley]);
    expect(await programOf(t)).toMatchObject({ status: 'published', version: 1 });
  });

  it('does not accept new deactivated members or inactive boats, but lets existing ones stay', async () => {
    const t = await newTraining(1);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [ids.exMember] }]))).rejects.toThrow(/devre dışı/);

    await db.query(`update public.boats set is_active = false where id = $1`, [boat.turuncu]);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.turuncu, crew: [extra.alex] }]))).rejects.toThrow(/Turuncu teknesi kullanım dışı/);

    // Existing history: put them in directly, then re-save the same program.
    const prog = await db.query(`insert into public.training_programs (training_id) values ($1)`, [t]);
    expect(prog.affectedRows).toBe(1);
    const a1 = (await db.query<{ id: string }>(`insert into public.program_assignments (training_id, slot_index, boat_id) values ($1, 0, $2) returning id`, [t, boat.turuncu])).rows[0]!.id;
    await db.query(`insert into public.program_crew (assignment_id, training_id, slot_index, member_id) values ($1, $2, 0, $3)`, [a1, t, extra.alex]);
    const a2 = (await db.query<{ id: string }>(`insert into public.program_assignments (training_id, slot_index, boat_id) values ($1, 0, $2) returning id`, [t, boat.mavi])).rows[0]!.id;
    await db.query(`update public.profiles set is_active = false where id = $1`, [extra.jamie]);
    await db.query(`insert into public.program_crew (assignment_id, training_id, slot_index, member_id) values ($1, $2, 0, $3)`, [a2, t, extra.jamie]);

    await asCoach(t, payload([
      { slot_index: 0, boat_id: boat.turuncu, crew: [extra.alex] },
      { slot_index: 0, boat_id: boat.mavi, crew: [extra.jamie] },
    ]));
    expect(await crewOf(t)).toHaveLength(2);

    await db.query(`update public.boats set is_active = true where id = $1`, [boat.turuncu]);
    await db.query(`update public.profiles set is_active = true where id = $1`, [extra.jamie]);
  });

  it('only works on scheduled trainings that exist, and only for coaches', async () => {
    const cancelled = await newTraining(1, 'cancelled');
    await expect(asCoach(cancelled, payload([]))).rejects.toThrow(/planlanmış antrenmanların/);
    await expect(asCoach('00000000-0000-4000-8000-000000000999', payload([]))).rejects.toThrow(/Antrenman bulunamadı/);
    const t = await newTraining(1);
    await expect(as(db, ids.member1, () => save(t, payload([])))).rejects.toThrow(/Yetkisiz/);
    await expect(as(db, ids.exCoach, () => save(t, payload([])))).rejects.toThrow(/Yetkisiz/);
    await expect(as(db, 'anon', () => save(t, payload([])))).rejects.toThrow(/permission denied/);
  });
});

describe('program visibility', () => {
  let draft: string;
  let published: string;
  beforeAll(async () => {
    draft = await newTraining(1);
    published = await newTraining(1);
    await asCoach(draft, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex] }], { weather_note: 'taslak' }));
    await asCoach(published, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex, ids.member1] }]), true);
  });

  const visible = (who: string, training: string) =>
    as(db, who, async () => ({
      program: (await db.query('select 1 from public.training_programs where training_id = $1', [training])).rows.length,
      assignments: (await db.query('select 1 from public.program_assignments where training_id = $1', [training])).rows.length,
      crew: (await db.query('select 1 from public.program_crew where training_id = $1', [training])).rows.length,
    }));

  it('hides drafts from members completely', async () => {
    expect(await visible(ids.member1, draft)).toEqual({ program: 0, assignments: 0, crew: 0 });
  });

  it('shows published programs (with crews) to every active member', async () => {
    for (const who of [ids.member1, ids.member2]) {
      expect(await visible(who, published)).toEqual({ program: 1, assignments: 1, crew: 2 });
    }
  });

  it('shows coaches drafts and published programs alike', async () => {
    expect(await visible(ids.coach1, draft)).toEqual({ program: 1, assignments: 1, crew: 1 });
    expect(await visible(ids.coach2, published)).toEqual({ program: 1, assignments: 1, crew: 2 });
  });

  it('shows nothing to deactivated users, and is closed to anonymous callers', async () => {
    expect(await visible(ids.exMember, published)).toEqual({ program: 0, assignments: 0, crew: 0 });
    expect(await visible(ids.exCoach, published)).toEqual({ program: 0, assignments: 0, crew: 0 });
    await expect(as(db, 'anon', () => db.query('select * from public.program_crew'))).rejects.toThrow(/permission denied/);
  });

  it('takes a program away from members again when it is unpublished', async () => {
    const t = await newTraining(1);
    const body = payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex] }]);
    await asCoach(t, body, true);
    expect((await visible(ids.member1, t)).crew).toBe(1);
    await asCoach(t, body, false);
    expect(await visible(ids.member1, t)).toEqual({ program: 0, assignments: 0, crew: 0 });
  });

  it('cannot be written directly by anyone', async () => {
    for (const who of [ids.coach1, ids.member1]) {
      for (const sql of [
        `insert into public.training_programs (training_id) values ('${draft}')`,
        `update public.training_programs set status = 'published' where training_id = '${draft}'`,
        `delete from public.training_programs where training_id = '${draft}'`,
        `insert into public.program_assignments (training_id, slot_index, boat_id) values ('${draft}', 0, '${boat.c4x}')`,
        `update public.program_assignments set boat_id = '${boat.c4x}'`,
        `delete from public.program_assignments`,
        `delete from public.program_crew`,
        `update public.program_crew set member_id = '${ids.member1}'`,
      ]) {
        await expect(as(db, who, () => db.query(sql))).rejects.toThrow(/permission denied/);
      }
    }
  });
});

describe('integrity triggers (bypassing save_program as the database owner)', () => {
  it('still enforces boat capacity', async () => {
    const t = await newTraining(1);
    await db.query(`insert into public.training_programs (training_id) values ($1)`, [t]);
    const a = (await db.query<{ id: string }>(`insert into public.program_assignments (training_id, slot_index, boat_id) values ($1, 0, $2) returning id`, [t, boat.mavi])).rows[0]!.id;
    await db.query(`insert into public.program_crew (assignment_id, training_id, slot_index, member_id) values ($1, $2, 0, $3)`, [a, t, extra.alex]);
    await db.query(`insert into public.program_crew (assignment_id, training_id, slot_index, member_id) values ($1, $2, 0, $3)`, [a, t, extra.ashley]);
    await expect(
      db.query(`insert into public.program_crew (assignment_id, training_id, slot_index, member_id) values ($1, $2, 0, $3)`, [a, t, extra.john]),
    ).rejects.toThrow(/en fazla 2 kişi/);
  });

  it('still enforces one boat per member per hour and one use of a boat per hour', async () => {
    const t = await newTraining(1);
    await db.query(`insert into public.training_programs (training_id) values ($1)`, [t]);
    const a1 = (await db.query<{ id: string }>(`insert into public.program_assignments (training_id, slot_index, boat_id) values ($1, 0, $2) returning id`, [t, boat.mavi])).rows[0]!.id;
    const a2 = (await db.query<{ id: string }>(`insert into public.program_assignments (training_id, slot_index, boat_id) values ($1, 0, $2) returning id`, [t, boat.turuncu])).rows[0]!.id;
    await db.query(`insert into public.program_crew (assignment_id, training_id, slot_index, member_id) values ($1, $2, 0, $3)`, [a1, t, extra.alex]);
    await expect(
      db.query(`insert into public.program_crew (assignment_id, training_id, slot_index, member_id) values ($1, $2, 0, $3)`, [a2, t, extra.alex]),
    ).rejects.toThrow(/program_crew_member_once_per_slot/);
    await expect(
      db.query(`insert into public.program_assignments (training_id, slot_index, boat_id) values ($1, 0, $2)`, [t, boat.mavi]),
    ).rejects.toThrow(/program_assignments_boat_once_per_slot/);
  });

  it('rejects an hour beyond the training and non-member crew', async () => {
    const t = await newTraining(2);
    await db.query(`insert into public.training_programs (training_id) values ($1)`, [t]);
    await expect(
      db.query(`insert into public.program_assignments (training_id, slot_index, boat_id) values ($1, 2, $2)`, [t, boat.mavi]),
    ).rejects.toThrow(/seans sayısını aşıyor/);
    const a = (await db.query<{ id: string }>(`insert into public.program_assignments (training_id, slot_index, boat_id) values ($1, 0, $2) returning id`, [t, boat.mavi])).rows[0]!.id;
    await expect(
      db.query(`insert into public.program_crew (assignment_id, training_id, slot_index, member_id) values ($1, $2, 0, $3)`, [a, t, ids.coach1]),
    ).rejects.toThrow(/yalnızca üyelerden/);
  });
});

describe('changing the number of sessions of a training with a program', () => {
  it('refuses to drop an hour that still has a crew, but allows dropping empty hours and adding hours', async () => {
    const t = await newTraining(3);
    await asCoach(t, payload([{ slot_index: 1, boat_id: boat.mavi, crew: [extra.alex] }]));

    await expect(
      as(db, ids.coach1, () => db.query(`update public.trainings set slot_count = 1 where id = $1`, [t])),
    ).rejects.toThrow(/2 numaralı seansta programda ekip var/);

    const shrink = await as(db, ids.coach1, () => db.query(`update public.trainings set slot_count = 2 where id = $1`, [t]));
    expect(shrink.affectedRows).toBe(1);
    const grow = await as(db, ids.coach1, () => db.query(`update public.trainings set slot_count = 5 where id = $1`, [t]));
    expect(grow.affectedRows).toBe(1);
  });
});
