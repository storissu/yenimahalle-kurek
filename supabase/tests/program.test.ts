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

type Entry = { slot_index: number; boat_id: string; crew: string[]; cox?: string | null; notes?: string };
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

  it('rejects negative session numbers and more than 30 of them', async () => {
    const t = await newTraining(2);
    await expect(asCoach(t, payload([{ slot_index: 30, boat_id: boat.mavi, crew: [extra.alex] }]))).rejects.toThrow(/en fazla 30 seans/);
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

const slotCountOf = async (t: string) => (await db.query<{ slot_count: number }>('select slot_count from public.trainings where id = $1', [t])).rows[0]!.slot_count;

describe('the program decides how many sessions a training has', () => {
  it('starts as "not planned yet" (0) and becomes the last session that has a crew', async () => {
    const t = await newTraining(0);
    expect(await slotCountOf(t)).toBe(0);
    await asCoach(t, payload([{ slot_index: 2, boat_id: boat.mavi, crew: [extra.alex] }]));
    expect(await slotCountOf(t)).toBe(3); // sessions 1 and 2 stay empty, the training still runs three hours
  });

  it('grows and shrinks with the program, also while it is only a draft', async () => {
    const t = await newTraining(0);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex] }, { slot_index: 3, boat_id: boat.mavi, crew: [extra.john] }]));
    expect(await slotCountOf(t)).toBe(4);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex] }, { slot_index: 1, boat_id: boat.mavi, crew: [extra.john] }]), true);
    expect(await slotCountOf(t)).toBe(2);
    expect((await crewOf(t)).map((r) => r.slot_index)).toEqual([0, 1]);
  });

  it('leaves the length alone when a draft has no crew at all', async () => {
    const none = await newTraining(0);
    await asCoach(none, payload([]));
    expect(await slotCountOf(none)).toBe(0);
    const planned = await newTraining(3);
    await asCoach(planned, payload([]));
    expect(await slotCountOf(planned)).toBe(3);
  });

  it('never cuts below a session that has attendance recorded', async () => {
    const t = await newTraining(0);
    await asCoach(t, payload([{ slot_index: 2, boat_id: boat.mavi, crew: [extra.alex] }]));
    await db.query(`insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values ($1, 2, $2, 'present', $3)`, [t, extra.alex, ids.coach1]);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex] }]));
    expect(await slotCountOf(t)).toBe(3);
    await expect(db.query(`update public.trainings set slot_count = 1 where id = $1`, [t])).rejects.toThrow(/3 numaralı seansta programda ekip veya yoklama kaydı var/);
  });

  it('refuses more than 30 session numbers and does not touch the length when a save fails', async () => {
    const t = await newTraining(2);
    await expect(asCoach(t, payload([{ slot_index: 30, boat_id: boat.mavi, crew: [extra.alex] }]))).rejects.toThrow(/en fazla 30/);
    await expect(asCoach(t, payload([{ slot_index: 5, boat_id: boat.mavi, crew: ['zzz'] }]))).rejects.toThrow(/Geçersiz üye/);
    expect(await slotCountOf(t)).toBe(2);
  });

  it('guards the count directly: a session with a crew cannot be dropped, empty ones can', async () => {
    const t = await newTraining(0);
    await asCoach(t, payload([{ slot_index: 1, boat_id: boat.mavi, crew: [extra.alex] }]));
    await expect(db.query(`update public.trainings set slot_count = 1 where id = $1`, [t])).rejects.toThrow(/2 numaralı seansta/);
    await db.query(`update public.trainings set slot_count = 2 where id = $1`, [t]);
    await db.query(`update public.trainings set slot_count = 5 where id = $1`, [t]);
  });
});

describe('boats that must be full (C4X = exactly 4)', () => {
  const four = [extra.alex, extra.ashley, extra.john, extra.jamie];

  it('is set up for the C4X only, out of the box (four rowers + a dümenci)', async () => {
    const rows = (await db.query<{ name: string; requires_full_crew: boolean; has_coxswain: boolean }>('select name, requires_full_crew, has_coxswain from public.boats order by name')).rows;
    expect(rows).toEqual([
      { name: 'C4X', requires_full_crew: true, has_coxswain: true },
      { name: 'Mavi', requires_full_crew: false, has_coxswain: false },
      { name: 'Turuncu', requires_full_crew: false, has_coxswain: false },
    ]);
  });

  it('publishes a C4X with exactly four rowers and its dümenci', async () => {
    const t = await newTraining(0);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: ids.coach1 }]), true);
    expect((await programOf(t))?.status).toBe('published');
  });

  it.each([
    ['three', [extra.alex, extra.ashley, extra.john], 3],
    ['one', [extra.alex], 1],
  ])('refuses to publish a C4X with %s people, naming the boat, the hour and the number', async (_l, crew, n) => {
    const t = await newTraining(0);
    await expect(asCoach(t, payload([{ slot_index: 1, boat_id: boat.c4x, crew }]), true)).rejects.toThrow(
      new RegExp(`C4X teknesinde tam 4 kişi olmalı \\(\\d\\d:\\d\\d–\\d\\d:\\d\\d seansında ${n} kişi var\\)`),
    );
    expect(await programOf(t)).toBeUndefined(); // all-or-nothing
  });

  it('refuses when a later session is short-handed, even if the first one is fine', async () => {
    const t = await newTraining(0);
    await expect(
      asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: ids.coach1 }, { slot_index: 1, boat_id: boat.c4x, crew: [extra.alex, extra.ashley] }]), true),
    ).rejects.toThrow(/seansında 2 kişi var/);
  });

  it('cannot hold more than four either (capacity), and other boats may run short-handed', async () => {
    const t = await newTraining(0);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: [...four, ids.member1] }]), true)).rejects.toThrow(/tam 4 kişi olmalı|en fazla 4 kişi/);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex] }]), true);
    expect((await programOf(t))?.status).toBe('published');
  });

  it('lets an incomplete C4X be saved as a draft — only publishing (and updating a published program) is blocked', async () => {
    const t = await newTraining(0);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: [extra.alex, extra.ashley] }]), false);
    expect((await programOf(t))?.status).toBe('draft');
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: ids.coach1 }]), true);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: [extra.alex, extra.ashley] }]), true)).rejects.toThrow(/tam 4 kişi/);
    expect((await crewOf(t)).filter((r) => r.boat === 'C4X')).toHaveLength(5); // the published program is untouched (four rowers + the dümenci)
  });

  it('can be switched per boat by coaches (and only by coaches)', async () => {
    await as(db, ids.coach1, () => db.query(`update public.boats set requires_full_crew = true where id = $1`, [boat.mavi]));
    const t = await newTraining(0);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex] }]), true)).rejects.toThrow(/Mavi teknesinde tam 2 kişi/);
    await as(db, ids.coach1, () => db.query(`update public.boats set requires_full_crew = false where id = $1`, [boat.mavi]));
    await as(db, ids.coach1, () => db.query(`update public.boats set requires_full_crew = false where id = $1`, [boat.c4x]));
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: [extra.alex], cox: ids.coach1 }]), true);
    await db.query(`update public.boats set requires_full_crew = true where id = $1`, [boat.c4x]);
    const byMember = await as(db, ids.member1, () => db.query(`update public.boats set requires_full_crew = false where id = $1`, [boat.c4x]));
    expect(byMember.affectedRows).toBe(0);
  });
});

describe('the dümenci (coxswain) of a C4X and the order of the crew', () => {
  const four = [extra.alex, extra.ashley, extra.john, extra.jamie];
  const coxRows = async (t: string) =>
    (
      await db.query<{ member_id: string; seat: number | null; is_cox: boolean }>(
        `select c.member_id, c.seat, c.is_cox from public.program_crew c where c.training_id = $1 order by c.is_cox, c.seat`,
        [t],
      )
    ).rows;

  it('is stored as its own row (is_cox, no seat) next to the four rowers — it is not a fifth rowing seat', async () => {
    const t = await newTraining(0);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: ids.member1 }]), true);
    const rows = await coxRows(t);
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => !r.is_cox).map((r) => r.seat)).toEqual([1, 2, 3, 4]);
    expect(rows.filter((r) => r.is_cox)).toEqual([{ member_id: ids.member1, seat: null, is_cox: true }]);
  });

  it('keeps the rowers in exactly the order the coach gave (never sorted), for the C4X and for any other boat', async () => {
    const t = await newTraining(0);
    const backwards = [extra.jamie, extra.john, extra.ashley, extra.alex];
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: backwards, cox: ids.coach1 }, { slot_index: 1, boat_id: boat.mavi, crew: [extra.john, extra.alex] }]));
    const bySeat = (await crewOf(t)).filter((r) => r.boat === 'C4X' && r.seat !== null);
    expect(bySeat.map((r) => r.member_id)).toEqual(backwards);
    expect((await crewOf(t)).filter((r) => r.boat === 'Mavi').map((r) => r.member_id)).toEqual([extra.john, extra.alex]);
    // and a second save with another order replaces it
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex, extra.john] }]));
    expect((await crewOf(t)).map((r) => r.member_id)).toEqual([extra.alex, extra.john]);
  });

  it('can be a member or the coach themselves', async () => {
    const byMember = await newTraining(0);
    await asCoach(byMember, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: ids.member1 }]), true);
    const byCoach = await newTraining(0);
    await asCoach(byCoach, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: ids.coach1 }]), true);
    expect((await coxRows(byCoach)).find((r) => r.is_cox)?.member_id).toBe(ids.coach1);
    const anotherCoach = await newTraining(0);
    await asCoach(anotherCoach, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: ids.coach2 }]), true);
    expect((await coxRows(anotherCoach)).find((r) => r.is_cox)?.member_id).toBe(ids.coach2);
  });

  it('is required to PUBLISH a C4X (it is part of the crew), but a draft may be incomplete', async () => {
    const t = await newTraining(0);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four }]), true)).rejects.toThrow(/C4X teknesinde dümenci olmalı/);
    expect(await programOf(t)).toBeUndefined(); // all-or-nothing
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four }]), false);
    expect((await programOf(t))?.status).toBe('draft');
    expect(await coxRows(t)).toHaveLength(4);
  });

  it('is only for boats that have one (the database refuses it too)', async () => {
    const t = await newTraining(0);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex, extra.ashley], cox: ids.coach1 }]))).rejects.toThrow(/Mavi teknesinde dümenci olmaz/);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex, extra.ashley] }]));
    await expect(
      db.query(
        `insert into public.program_crew (assignment_id, training_id, slot_index, member_id, seat, is_cox)
         select a.id, a.training_id, a.slot_index, $2, null, true from public.program_assignments a where a.training_id = $1`,
        [t, ids.coach1],
      ),
    ).rejects.toThrow(/Mavi teknesinde dümenci olmaz/);
  });

  it('is not one of the rowers: the same person cannot be both in a session', async () => {
    const t = await newTraining(0);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: extra.alex }]))).rejects.toThrow(/Dümenci aynı seansta kürekçi olamaz/);
  });

  it('does not add to the capacity: four rowers + a dümenci fit, a fifth rower does not', async () => {
    const t = await newTraining(0);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: ids.member1 }]));
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: [...four, ids.member2], cox: ids.member1 }]))).rejects.toThrow(/tam 4 kişi olmalı|en fazla 4 kişi/);
  });

  it('follows the "nobody is in two boats at once" rule like a rower does', async () => {
    const t = await newTraining(0);
    // a member who steers the C4X cannot also row another boat at that time
    await expect(
      asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: ids.member1 }, { slot_index: 0, boat_id: boat.mavi, crew: [ids.member1, ids.member2] }])),
    ).rejects.toThrow(/iki teknede/);
    await expect(
      asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: ids.coach1 }, { slot_index: 0, boat_id: boat.turuncu, crew: [ids.member1, ids.member2] }, { slot_index: 0, boat_id: boat.mavi, crew: [extra.alex] }])),
    ).rejects.toThrow(/iki teknede/); // Alex is in the C4X and in Mavi at once
  });

  it('members see the dümenci of a published program (and the coaches\' names); a draft stays hidden', async () => {
    const t = await newTraining(0);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: ids.coach1 }]), false);
    const draft = await as(db, ids.member1, () => db.query('select * from public.program_crew where training_id = $1', [t]));
    expect(draft.rows).toHaveLength(0);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: ids.coach1 }]), true);
    const seen = await as(db, ids.member1, () => db.query<{ member_id: string; is_cox: boolean }>('select member_id, is_cox from public.program_crew where training_id = $1 and is_cox', [t]));
    expect(seen.rows).toEqual([{ member_id: ids.coach1, is_cox: true }]);
    const names = await as(db, ids.member1, () => db.query<{ id: string; full_name: string }>('select id, full_name from public.coach_directory order by full_name'));
    expect(names.rows.map((r) => r.id).sort()).toEqual([ids.coach1, ids.coach2].sort());
    const columns = await as(db, ids.member1, () => db.query('select * from public.coach_directory limit 1'));
    expect(Object.keys(columns.rows[0] ?? {}).sort()).toEqual(['full_name', 'id']); // names only
    await expect(as(db, 'anon', () => db.query('select * from public.coach_directory'))).rejects.toThrow(/permission denied/);
  });

  it('allows one dümenci per session, in the database too', async () => {
    const t = await newTraining(0);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.c4x, crew: four, cox: ids.coach1 }]));
    await expect(
      db.query(
        `insert into public.program_crew (assignment_id, training_id, slot_index, member_id, seat, is_cox)
         select a.id, a.training_id, a.slot_index, $2, null, true from public.program_assignments a where a.training_id = $1`,
        [t, ids.member1],
      ),
    ).rejects.toThrow(/program_crew_one_cox_per_session|duplicate key/);
  });

  it('only a coach can say which boats have a dümenci (and the change is written to the settings log)', async () => {
    await as(db, ids.coach1, () => db.query(`update public.boats set has_coxswain = true where id = $1`, [boat.mavi]));
    const t = await newTraining(0);
    await expect(asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex] }]), true)).rejects.toThrow(/Mavi teknesinde dümenci olmalı/);
    await asCoach(t, payload([{ slot_index: 0, boat_id: boat.mavi, crew: [extra.alex], cox: ids.coach1 }]), true);
    const log = await db.query<{ detail: { fields: string[] } }>(`select detail from public.audit_log where action = 'boat.update' order by at desc limit 1`);
    expect(log.rows[0]?.detail.fields).toContain('has_coxswain');
    await as(db, ids.coach1, () => db.query(`update public.boats set has_coxswain = false where id = $1`, [boat.mavi]));
    const byMember = await as(db, ids.member1, () => db.query(`update public.boats set has_coxswain = false where id = $1`, [boat.c4x]));
    expect(byMember.affectedRows).toBe(0);
  });
});
