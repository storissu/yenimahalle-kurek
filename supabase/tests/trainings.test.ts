import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, ids, seedPeople } from './harness';

let db: PGlite;
const t: Record<'open' | 'locked' | 'cancelled' | 'edit', string> = { open: '', locked: '', cancelled: '', edit: '' };

async function insertTraining(startsIn: string, deadlineIn: string, slots = 2): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.trainings (starts_at, slot_count, rsvp_deadline, created_by)
     values (now() + $1::interval, $3, now() + $2::interval, $4) returning id`,
    [startsIn, deadlineIn, slots, ids.coach1],
  );
  return (res.rows[0] as { id: string }).id;
}

beforeAll(async () => {
  db = await createDb();
  await seedPeople(db);
  t.open = await insertTraining('2 days', '1 day');
  t.locked = await insertTraining('3 hours', '-1 hour');
  t.edit = await insertTraining('5 days', '4 days');
  t.cancelled = await insertTraining('4 days', '3 days');
  await db.query(`update public.trainings set status = 'cancelled', cancel_reason = 'Fırtına' where id = $1`, [t.cancelled]);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rsvp = (training: string, response: 'attending' | 'not_attending', note: string | null = null) =>
  db.query('select public.set_rsvp($1, $2, $3)', [training, response, note]);
const answerOf = async (training: string, member: string) =>
  (await db.query<{ response: string; note: string | null; set_by_coach: boolean }>(
    'select response, note, set_by_coach from public.training_responses where training_id = $1 and member_id = $2',
    [training, member],
  )).rows[0];

describe('trainings: access', () => {
  it('is closed to anonymous users', async () => {
    await expect(as(db, 'anon', () => db.query('select * from public.trainings'))).rejects.toThrow(/permission denied/);
  });

  it('is readable by every active user, including cancelled trainings', async () => {
    const res = await as(db, ids.member1, () => db.query('select id from public.trainings'));
    expect(res.rows).toHaveLength(4);
  });

  it('shows nothing to a deactivated user', async () => {
    const res = await as(db, ids.exMember, () => db.query('select id from public.trainings'));
    expect(res.rows).toHaveLength(0);
  });

  it('cannot be created or edited by members', async () => {
    await expect(
      as(db, ids.member1, () =>
        db.query(`insert into public.trainings (starts_at, slot_count, rsvp_deadline) values (now() + interval '1 day', 1, now())`),
      ),
    ).rejects.toThrow(/row-level security/);
    const upd = await as(db, ids.member1, () => db.query(`update public.trainings set title = 'x' where id = $1`, [t.open]));
    expect(upd.affectedRows).toBe(0);
  });

  it('cannot be deleted by anyone', async () => {
    await expect(as(db, ids.coach1, () => db.query('delete from public.trainings where id = $1', [t.open]))).rejects.toThrow(/permission denied/);
  });
});

describe('trainings: coach management', () => {
  it('creates a training and stamps created_by from the session', async () => {
    const res = await as(db, ids.coach2, () =>
      db.query<{ created_by: string; status: string; slot_count: number }>(
        `insert into public.trainings (title, starts_at, slot_count, rsvp_deadline, notes)
         values ('Sabah antrenmanı', now() + interval '2 days', 2, now() + interval '1 day', 'Kısa not') returning created_by, status, slot_count`,
      ),
    );
    expect(res.rows[0]).toEqual({ created_by: ids.coach2, status: 'scheduled', slot_count: 2 });
  });

  it('does not let a client choose created_by, status or cancel_reason', async () => {
    for (const col of ['created_by', 'status', 'cancel_reason']) {
      await expect(
        as(db, ids.coach1, () =>
          db.query(`insert into public.trainings (starts_at, rsvp_deadline, ${col}) values (now() + interval '1 day', now(), null)`),
        ),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      as(db, ids.coach1, () => db.query(`update public.trainings set status = 'completed' where id = $1`, [t.edit])),
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    ['deadline after the start', `now() + interval '1 day', 1, now() + interval '2 days'`, /trainings_deadline_before_start/],
    ['zero sessions', `now() + interval '1 day', 0, now()`, /trainings_slot_count_range/],
    ['seven sessions', `now() + interval '1 day', 7, now()`, /trainings_slot_count_range/],
  ])('rejects invalid data: %s', async (_label, values, error) => {
    await expect(
      as(db, ids.coach1, () => db.query(`insert into public.trainings (starts_at, slot_count, rsvp_deadline) values (${values})`)),
    ).rejects.toThrow(error);
  });

  it('rejects a blank title and an over-long note', async () => {
    await expect(
      as(db, ids.coach1, () =>
        db.query(`insert into public.trainings (title, starts_at, rsvp_deadline) values ('   ', now() + interval '1 day', now())`),
      ),
    ).rejects.toThrow(/trainings_title_len/);
    await expect(
      as(db, ids.coach1, () =>
        db.query(`insert into public.trainings (notes, starts_at, rsvp_deadline) values ($1, now() + interval '1 day', now())`, ['x'.repeat(501)]),
      ),
    ).rejects.toThrow(/trainings_notes_len/);
  });

  it('lets a coach edit a scheduled training but not a cancelled one', async () => {
    const ok = await as(db, ids.coach1, () =>
      db.query(`update public.trainings set title = 'Güncel başlık', slot_count = 3 where id = $1`, [t.edit]),
    );
    expect(ok.affectedRows).toBe(1);
    const cancelled = await as(db, ids.coach1, () =>
      db.query(`update public.trainings set title = 'Olmaz' where id = $1`, [t.cancelled]),
    );
    expect(cancelled.affectedRows).toBe(0);
  });
});

describe('cancel_training', () => {
  it('is coach-only', async () => {
    await expect(as(db, ids.member1, () => db.query(`select public.cancel_training($1, 'Fırtına var')`, [t.edit]))).rejects.toThrow(/Yetkisiz/);
    await expect(as(db, 'anon', () => db.query(`select public.cancel_training($1, 'Fırtına var')`, [t.edit]))).rejects.toThrow(/permission denied/);
  });

  it('needs a reason of 3–200 characters', async () => {
    await expect(as(db, ids.coach1, () => db.query(`select public.cancel_training($1, '  ab ')`, [t.edit]))).rejects.toThrow(/İptal nedeni/);
    await expect(as(db, ids.coach1, () => db.query(`select public.cancel_training($1, $2)`, [t.edit, 'x'.repeat(201)]))).rejects.toThrow(/İptal nedeni/);
  });

  it('cancels a scheduled training once, keeping the reason', async () => {
    const id = await insertTraining('6 days', '5 days');
    await as(db, ids.coach1, () => db.query(`select public.cancel_training($1, '  Şiddetli rüzgâr ')`, [id]));
    const row = (await db.query<{ status: string; cancel_reason: string }>('select status, cancel_reason from public.trainings where id = $1', [id])).rows[0];
    expect(row).toEqual({ status: 'cancelled', cancel_reason: 'Şiddetli rüzgâr' });
    await expect(as(db, ids.coach1, () => db.query(`select public.cancel_training($1, 'Tekrar')`, [id]))).rejects.toThrow(/zaten iptal/);
  });

  it('reports an unknown training', async () => {
    await expect(
      as(db, ids.coach1, () => db.query(`select public.cancel_training('00000000-0000-4000-8000-000000000999', 'Sebep')`)),
    ).rejects.toThrow(/bulunamadı/);
  });
});

describe('set_rsvp (member answers)', () => {
  it('records an answer and lets the member change it (with a note) before the deadline', async () => {
    await as(db, ids.member1, () => rsvp(t.open, 'attending'));
    expect(await answerOf(t.open, ids.member1)).toEqual({ response: 'attending', note: null, set_by_coach: false });
    await as(db, ids.member1, () => rsvp(t.open, 'attending', "  9'dan sonraya yazar mısınız? İşim var  "));
    expect(await answerOf(t.open, ids.member1)).toEqual({
      response: 'attending',
      note: "9'dan sonraya yazar mısınız? İşim var",
      set_by_coach: false,
    });
    await as(db, ids.member1, () => rsvp(t.open, 'not_attending', '   '));
    expect(await answerOf(t.open, ids.member1)).toEqual({ response: 'not_attending', note: null, set_by_coach: false });
  });

  it('refuses answers after the deadline and leaves the existing answer untouched', async () => {
    await db.query(`insert into public.training_responses (training_id, member_id, response) values ($1, $2, 'attending')`, [t.locked, ids.member2]);
    await expect(as(db, ids.member2, () => rsvp(t.locked, 'not_attending', 'vazgeçtim'))).rejects.toThrow(/Yanıt süresi doldu/);
    expect(await answerOf(t.locked, ids.member2)).toEqual({ response: 'attending', note: null, set_by_coach: false });
  });

  it('refuses a first answer after the deadline too', async () => {
    await expect(as(db, ids.member1, () => rsvp(t.locked, 'attending'))).rejects.toThrow(/Yanıt süresi doldu/);
    expect(await answerOf(t.locked, ids.member1)).toBeUndefined();
  });

  it('follows the SERVER clock: open now, locked a moment later', async () => {
    const id = await insertTraining('1 hour', '3 seconds');
    await as(db, ids.member1, () => rsvp(id, 'attending'));
    await sleep(3300);
    await expect(as(db, ids.member1, () => rsvp(id, 'not_attending'))).rejects.toThrow(/Yanıt süresi doldu/);
    expect((await answerOf(id, ids.member1))?.response).toBe('attending');
  });

  it('re-opens when a coach extends the deadline', async () => {
    await as(db, ids.coach1, () =>
      db.query(`update public.trainings set rsvp_deadline = starts_at where id = $1`, [t.locked]),
    );
    await as(db, ids.member1, () => rsvp(t.locked, 'attending'));
    expect((await answerOf(t.locked, ids.member1))?.response).toBe('attending');
    await db.query(`update public.trainings set rsvp_deadline = now() - interval '1 hour' where id = $1`, [t.locked]);
  });

  it('refuses answers for cancelled trainings', async () => {
    await expect(as(db, ids.member1, () => rsvp(t.cancelled, 'attending'))).rejects.toThrow(/iptal edildi/);
  });

  it('refuses unknown trainings and over-long notes', async () => {
    await expect(
      as(db, ids.member1, () => rsvp('00000000-0000-4000-8000-000000000999', 'attending')),
    ).rejects.toThrow(/bulunamadı/);
    await expect(as(db, ids.member1, () => rsvp(t.open, 'attending', 'x'.repeat(201)))).rejects.toThrow(/en fazla 200/);
  });

  it('is only for active members (not coaches, deactivated users or anonymous callers)', async () => {
    await expect(as(db, ids.coach1, () => rsvp(t.open, 'attending'))).rejects.toThrow(/Yetkisiz/);
    await expect(as(db, ids.exMember, () => rsvp(t.open, 'attending'))).rejects.toThrow(/Yetkisiz/);
    await expect(as(db, 'anon', () => rsvp(t.open, 'attending'))).rejects.toThrow(/permission denied/);
  });

  it('cannot be bypassed with direct writes', async () => {
    for (const who of [ids.member1, ids.coach1]) {
      await expect(
        as(db, who, () => db.query(`insert into public.training_responses (training_id, member_id, response) values ($1, $2, 'attending')`, [t.locked, who])),
      ).rejects.toThrow(/permission denied/);
      await expect(
        as(db, who, () => db.query(`update public.training_responses set response = 'attending' where training_id = $1`, [t.locked])),
      ).rejects.toThrow(/permission denied/);
      await expect(
        as(db, who, () => db.query(`delete from public.training_responses where training_id = $1`, [t.locked])),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe('training_responses: visibility', () => {
  it("shows a member only their own answers, never other members'", async () => {
    await as(db, ids.member2, () => rsvp(t.open, 'attending', 'Becca notu'));
    const mine = await as(db, ids.member1, () => db.query<{ member_id: string }>('select member_id from public.training_responses'));
    expect(new Set(mine.rows.map((r) => r.member_id))).toEqual(new Set([ids.member1]));
  });

  it('shows a coach everyone\'s answers, including notes', async () => {
    const res = await as(db, ids.coach1, () => db.query<{ member_id: string; note: string | null }>('select member_id, note from public.training_responses where training_id = $1', [t.open]));
    expect(res.rows.map((r) => r.member_id).sort()).toEqual([ids.member1, ids.member2].sort());
    expect(res.rows.find((r) => r.member_id === ids.member2)?.note).toBe('Becca notu');
  });

  it('shows nothing to deactivated users or anonymous callers', async () => {
    await db.query(`insert into public.training_responses (training_id, member_id, response) values ($1, $2, 'attending') on conflict do nothing`, [t.open, ids.exMember]);
    const res = await as(db, ids.exMember, () => db.query('select * from public.training_responses'));
    expect(res.rows).toHaveLength(0);
    await expect(as(db, 'anon', () => db.query('select * from public.training_responses'))).rejects.toThrow(/permission denied/);
  });
});

describe('coach_set_rsvp (on behalf of a member)', () => {
  it('works after the deadline and is flagged as coach-entered', async () => {
    await as(db, ids.coach1, () =>
      db.query(`select public.coach_set_rsvp($1, $2, 'attending', 'Telefonla bildirdi')`, [t.locked, ids.member1]),
    );
    expect(await answerOf(t.locked, ids.member1)).toEqual({ response: 'attending', note: 'Telefonla bildirdi', set_by_coach: true });
    // ...but the member still cannot change it themselves after the deadline.
    await expect(as(db, ids.member1, () => rsvp(t.locked, 'not_attending'))).rejects.toThrow(/Yanıt süresi doldu/);
  });

  it('can overwrite an existing answer', async () => {
    await as(db, ids.coach2, () => db.query(`select public.coach_set_rsvp($1, $2, 'not_attending')`, [t.locked, ids.member2]));
    expect(await answerOf(t.locked, ids.member2)).toEqual({ response: 'not_attending', note: null, set_by_coach: true });
  });

  it('is coach-only', async () => {
    await expect(
      as(db, ids.member1, () => db.query(`select public.coach_set_rsvp($1, $2, 'attending')`, [t.open, ids.member2])),
    ).rejects.toThrow(/Yetkisiz/);
    await expect(
      as(db, 'anon', () => db.query(`select public.coach_set_rsvp($1, $2, 'attending')`, [t.open, ids.member2])),
    ).rejects.toThrow(/permission denied/);
  });

  it('only targets active members, and only for scheduled trainings', async () => {
    for (const target of [ids.coach2, ids.exMember, '00000000-0000-4000-8000-000000000999']) {
      await expect(
        as(db, ids.coach1, () => db.query(`select public.coach_set_rsvp($1, $2, 'attending')`, [t.open, target])),
      ).rejects.toThrow(/Üye bulunamadı/);
    }
    await expect(
      as(db, ids.coach1, () => db.query(`select public.coach_set_rsvp($1, $2, 'attending')`, [t.cancelled, ids.member1])),
    ).rejects.toThrow(/iptal edildi/);
  });

  it('a later member answer (before the deadline) clears the coach flag', async () => {
    await as(db, ids.coach1, () => db.query(`select public.coach_set_rsvp($1, $2, 'not_attending')`, [t.open, ids.member1]));
    expect((await answerOf(t.open, ids.member1))?.set_by_coach).toBe(true);
    await as(db, ids.member1, () => rsvp(t.open, 'attending'));
    expect((await answerOf(t.open, ids.member1))?.set_by_coach).toBe(false);
  });
});

describe('server_now', () => {
  it('returns the database time to signed-in users only', async () => {
    const before = Date.now();
    const res = await as(db, ids.member1, () => db.query<{ server_now: string }>('select public.server_now() as server_now'));
    const value = new Date(res.rows[0]?.server_now as string).getTime();
    expect(Math.abs(value - before)).toBeLessThan(5000);
    await expect(as(db, 'anon', () => db.query('select public.server_now()'))).rejects.toThrow(/permission denied/);
  });
});
