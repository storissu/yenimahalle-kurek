import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, ids, seedPeople } from './harness';

let db: PGlite;
const boat: Record<'mavi' | 'turuncu' | 'c4x', string> = { mavi: '', turuncu: '', c4x: '' };
const x = {
  alex: '00000000-0000-4000-8000-0000000000b1',
  ashley: '00000000-0000-4000-8000-0000000000b2',
  john: '00000000-0000-4000-8000-0000000000b3',
  jamie: '00000000-0000-4000-8000-0000000000b4',
} as const;
const ALL_MEMBERS = [ids.member1, ids.member2, x.alex, x.ashley, x.john, x.jamie];

beforeAll(async () => {
  db = await createDb();
  await seedPeople(db);
  for (const [key, name] of Object.entries({ alex: 'Alex', ashley: 'Ashley', john: 'John', jamie: 'Jamie' })) {
    const id = x[key as keyof typeof x];
    await db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${key}@kulup.invalid`]);
    await db.query(`insert into public.profiles (id, username, full_name, role, must_change_password) values ($1, $2, $3, 'member', false)`, [id, key, name]);
  }
  const boats = await db.query<{ id: string; name: string }>('select id, name from public.boats');
  for (const b of boats.rows) boat[b.name.toLowerCase() as keyof typeof boat] = b.id;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

type Notif = { user_id: string; type: string; title: string; body: string; url: string; training_id: string | null };
const notifsFor = async (trainingId: string, type?: string): Promise<Notif[]> =>
  (
    await db.query<Notif>(
      `select user_id, type, title, body, url, training_id from public.notification_outbox
        where training_id = $1 ${type ? 'and type = $2' : ''} order by created_at, user_id`,
      type ? [trainingId, type] : [trainingId],
    )
  ).rows;
const recipients = (rows: Notif[]) => rows.map((r) => r.user_id).sort();

/** Insert a training as the DATABASE OWNER with explicit times (fires the same triggers). */
async function insertTraining(opts: { startsAt: string; deadline: string; slots?: number; createdAt?: string; title?: string | null; status?: string }): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.trainings (starts_at, slot_count, rsvp_deadline, created_by, created_at, title, status, cancel_reason)
     values ($1::timestamptz, $2, $3::timestamptz, $4, coalesce($5::timestamptz, now()), $6, $7, $8) returning id`,
    [opts.startsAt, opts.slots ?? 2, opts.deadline, ids.coach1, opts.createdAt ?? null, opts.title ?? null, opts.status ?? 'scheduled', opts.status === 'cancelled' ? 'Fırtına' : null],
  );
  return (res.rows[0] as { id: string }).id;
}
const cleanOutbox = () => db.query('delete from public.notification_outbox');

describe('helpers (Turkish text, club time)', () => {
  const one = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, string>>(sql, params)).rows[0] ?? {})[0];

  it('formats dates in club time with Turkish month and weekday names', async () => {
    expect(await one(`select public.tr_date('2026-10-06T05:00:00Z')`)).toBe('6 Ekim Salı');
    expect(await one(`select public.tr_date('2026-12-31T21:30:00Z')`)).toBe('1 Ocak Cuma'); // already 2027 in Istanbul
    expect(await one(`select public.tr_date('2026-12-31T20:30:00Z')`)).toBe('31 Aralık Perşembe');
  });

  it('formats time ranges across midnight', async () => {
    expect(await one(`select public.tr_range('2026-10-06T05:00:00Z', 2)`)).toBe('08:00–10:00');
    expect(await one(`select public.tr_range('2026-10-06T20:00:00Z', 2)`)).toBe('23:00–01:00');
    expect(await one(`select public.tr_range('2026-10-06T05:00:00Z', 0)`)).toBe('08:00'); // length not planned yet
  });

  it('joins crew mates the Turkish way', async () => {
    expect(await one(`select public.tr_mates(array[]::text[])`)).toBe('tek başına');
    expect(await one(`select public.tr_mates(array['Jamie'])`)).toBe('Jamie ile');
    expect(await one(`select public.tr_mates(array['Jamie','Ali'])`)).toBe('Jamie ve Ali ile');
    expect(await one(`select public.tr_mates(array['Jamie','Ali','Becca'])`)).toBe('Jamie, Ali ve Becca ile');
  });

  it('is not callable by clients', async () => {
    await expect(as(db, ids.member1, () => db.query(`select public.tr_date(now())`))).rejects.toThrow(/permission denied/);
    await expect(as(db, ids.member1, () => db.query(`select public.run_scheduled_notifications()`))).rejects.toThrow(/permission denied/);
  });
});

describe('new training', () => {
  it('notifies every ACTIVE MEMBER (not coaches, not deactivated people) with date, time and deadline', async () => {
    await cleanOutbox();
    const t = await insertTraining({ startsAt: '2026-10-06T05:00:00Z', deadline: '2026-10-05T05:00:00Z', title: 'Sabah antrenmanı' });
    const rows = await notifsFor(t);
    expect(recipients(rows)).toEqual([...ALL_MEMBERS].sort());
    expect(rows[0]).toMatchObject({
      type: 'training_new',
      title: 'Yeni antrenman: Sabah antrenmanı',
      body: '6 Ekim Salı 08:00–10:00\nSon yanıt: 5 Ekim Pazartesi 08:00',
      url: `/uye/antrenmanlar/${t}`,
    });
  });

  it('works when a coach creates it through the API, and does not announce cancelled inserts', async () => {
    await cleanOutbox();
    const created = await as(db, ids.coach1, () =>
      db.query<{ id: string }>(`insert into public.trainings (starts_at, rsvp_deadline) values (now() + interval '3 days', now() + interval '2 days') returning id`),
    );
    expect(await notifsFor(created.rows[0]!.id, 'training_new')).toHaveLength(ALL_MEMBERS.length);
    const cancelled = await insertTraining({ startsAt: '2026-11-06T05:00:00Z', deadline: '2026-11-05T05:00:00Z', status: 'cancelled' });
    expect(await notifsFor(cancelled)).toEqual([]);
  });

  it('is idempotent per recipient (the same event never notifies twice)', async () => {
    await cleanOutbox();
    const t = await insertTraining({ startsAt: '2026-10-07T05:00:00Z', deadline: '2026-10-06T05:00:00Z' });
    const before = (await notifsFor(t)).length;
    await db.query(`select public.notify_active_members('training_new', $1, 'x', 'y', '/z', $2)`, [t, `training-new:${t}`]);
    expect((await notifsFor(t)).length).toBe(before);
  });
});

describe('training changed', () => {
  const edit = (t: string, set: string) => as(db, ids.coach1, () => db.query(`update public.trainings set ${set} where id = $1`, [t]));

  it('announces a new time, a new deadline, or both, to all active members', async () => {
    const t = await insertTraining({ startsAt: '2026-10-08T05:00:00Z', deadline: '2026-10-07T05:00:00Z' });
    await cleanOutbox();

    await edit(t, `starts_at = '2026-10-08T06:00:00Z', rsvp_deadline = '2026-10-07T06:00:00Z'`);
    let rows = await notifsFor(t, 'training_changed');
    expect(recipients(rows)).toEqual([...ALL_MEMBERS].sort());
    expect(rows[0]).toMatchObject({ title: 'Antrenman güncellendi', body: 'Yeni zaman: 8 Ekim Perşembe 09:00–11:00\nSon yanıt: 7 Ekim Çarşamba 09:00', url: `/uye/antrenmanlar/${t}` });

    await cleanOutbox();
    await edit(t, `rsvp_deadline = '2026-10-07T07:00:00Z'`);
    rows = await notifsFor(t, 'training_changed');
    expect(rows[0]?.body).toBe('Son yanıt: 7 Ekim Çarşamba 10:00');

    // the session count follows the program, so it is not "a change" members need to hear about
    await cleanOutbox();
    await db.query(`update public.trainings set slot_count = 3 where id = $1`, [t]);
    expect(await notifsFor(t)).toEqual([]);
  });

  it('announces only the start time while the length of the training is not known yet', async () => {
    await cleanOutbox();
    const t = await insertTraining({ startsAt: '2026-10-20T05:00:00Z', deadline: '2026-10-19T05:00:00Z', slots: 0 });
    expect((await notifsFor(t, 'training_new'))[0]?.body).toBe('20 Ekim Salı 08:00\nSon yanıt: 19 Ekim Pazartesi 08:00');
    await cleanOutbox();
    await edit(t, `starts_at = '2026-10-20T06:00:00Z'`);
    expect((await notifsFor(t, 'training_changed'))[0]?.body).toBe('Yeni zaman: 20 Ekim Salı 09:00');
  });

  it('stays quiet for edits that do not concern members (title, notes)', async () => {
    const t = await insertTraining({ startsAt: '2026-10-09T05:00:00Z', deadline: '2026-10-08T05:00:00Z' });
    await cleanOutbox();
    await edit(t, `title = 'Yeni başlık', notes = 'Not'`);
    expect(await notifsFor(t)).toEqual([]);
  });

  it('treats every edit as its own event', async () => {
    const t = await insertTraining({ startsAt: '2026-10-10T05:00:00Z', deadline: '2026-10-09T05:00:00Z' });
    await cleanOutbox();
    await edit(t, `starts_at = '2026-10-10T06:00:00Z'`);
    await edit(t, `starts_at = '2026-10-10T07:00:00Z'`);
    expect((await notifsFor(t, 'training_changed')).length).toBe(ALL_MEMBERS.length * 2);
  });
});

describe('cancelled training', () => {
  it('tells all active members with the date and the reason, once', async () => {
    const t = await insertTraining({ startsAt: '2026-10-12T05:00:00Z', deadline: '2026-10-11T05:00:00Z' });
    await cleanOutbox();
    await as(db, ids.coach1, () => db.query(`select public.cancel_training($1, 'Şiddetli rüzgâr')`, [t]));
    const rows = await notifsFor(t);
    expect(recipients(rows)).toEqual([...ALL_MEMBERS].sort());
    expect(rows[0]).toMatchObject({ type: 'training_cancelled', title: 'Antrenman iptal edildi', body: '12 Ekim Pazartesi 08:00–10:00\nNeden: Şiddetli rüzgâr' });
    await expect(as(db, ids.coach1, () => db.query(`select public.cancel_training($1, 'Tekrar')`, [t]))).rejects.toThrow();
    expect(await notifsFor(t)).toHaveLength(ALL_MEMBERS.length);
  });
});

describe('deadline reminders and summaries (run_scheduled_notifications)', () => {
  const run = async () => (await db.query<{ reminders: number; summaries: number; pruned: number }>('select * from public.run_scheduled_notifications()')).rows[0]!;
  const in_ = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

  it('reminds only members WITHOUT an answer, once, when the deadline is near', async () => {
    const t = await insertTraining({ startsAt: in_(20), deadline: in_(2), createdAt: in_(-5) });
    await db.query(`insert into public.training_responses (training_id, member_id, response) values ($1, $2, 'attending')`, [t, ids.member1]);
    await cleanOutbox();

    expect((await run()).reminders).toBe(1);
    const rows = await notifsFor(t, 'deadline_reminder');
    expect(recipients(rows)).toEqual(ALL_MEMBERS.filter((m) => m !== ids.member1).sort());
    expect(rows[0]?.title).toBe('Yanıt süresi dolmak üzere');
    expect(rows[0]?.body).toMatch(/Son yanıt: \d\d:\d\d\. Katılacak mısınız\?/);
    expect(rows[0]?.url).toBe(`/uye/antrenmanlar/${t}`);
    expect((await db.query('select deadline_reminder_sent_at from public.trainings where id = $1', [t])).rows[0]).not.toEqual({ deadline_reminder_sent_at: null });

    expect((await run()).reminders).toBe(0); // never twice
    expect(await notifsFor(t, 'deadline_reminder')).toHaveLength(ALL_MEMBERS.length - 1);
  });

  it('does not ask for an answer once the program is published (the answer is locked by then)', async () => {
    const withProgram = await insertTraining({ startsAt: in_(20), deadline: in_(2), createdAt: in_(-5) });
    const draftOnly = await insertTraining({ startsAt: in_(20), deadline: in_(2), createdAt: in_(-5) });
    for (const [t, publish] of [[withProgram, true], [draftOnly, false]] as const) {
      await as(db, ids.coach1, () =>
        db.query(`select public.save_program($1, $2::jsonb, $3, false)`, [t, JSON.stringify({ assignments: [{ slot_index: 0, boat_id: boat.mavi, crew: [x.alex] }] }), publish]),
      );
    }
    await cleanOutbox();
    await run();
    expect(await notifsFor(withProgram, 'deadline_reminder')).toEqual([]);
    expect((await notifsFor(draftOnly, 'deadline_reminder')).length).toBeGreaterThan(0);
  });

  it('ignores trainings whose deadline is far away, already passed, cancelled, or announced less than an hour ago', async () => {
    await cleanOutbox();
    const far = await insertTraining({ startsAt: in_(60), deadline: in_(40), createdAt: in_(-5) });
    const past = await insertTraining({ startsAt: in_(20), deadline: in_(-1), createdAt: in_(-5) });
    const cancelled = await insertTraining({ startsAt: in_(20), deadline: in_(2), createdAt: in_(-5), status: 'cancelled' });
    const fresh = await insertTraining({ startsAt: in_(20), deadline: in_(2) }); // created just now
    await cleanOutbox();
    await run();
    for (const t of [far, cancelled, fresh]) expect(await notifsFor(t, 'deadline_reminder')).toEqual([]);
    expect(await notifsFor(past, 'deadline_reminder')).toEqual([]);
  });

  it('uses the club setting for how early to remind', async () => {
    const t = await insertTraining({ startsAt: in_(30), deadline: in_(5), createdAt: in_(-5) });
    await cleanOutbox();
    await run();
    expect(await notifsFor(t, 'deadline_reminder')).toEqual([]); // 5 h ahead, setting is 3 h
    await as(db, ids.coach1, () => db.query(`update public.club_settings set reminder_lead_hours = 6`));
    await run();
    expect((await notifsFor(t, 'deadline_reminder')).length).toBeGreaterThan(0);
    await db.query(`update public.club_settings set reminder_lead_hours = 3`);
  });

  it('sends the coaches a summary when the deadline passes, once', async () => {
    const t = await insertTraining({ startsAt: in_(5), deadline: in_(-1), createdAt: in_(-50) });
    await db.query(`insert into public.training_responses (training_id, member_id, response) values ($1, $2, 'attending'), ($1, $3, 'attending'), ($1, $4, 'not_attending')`, [t, ids.member1, ids.member2, x.alex]);
    await cleanOutbox();

    expect((await run()).summaries).toBeGreaterThanOrEqual(1);
    const rows = await notifsFor(t, 'deadline_summary');
    expect(recipients(rows)).toEqual([ids.coach1, ids.coach2].sort()); // active coaches only
    expect(rows[0]).toMatchObject({ title: 'Yanıt süresi doldu', url: `/antrenor/antrenmanlar/${t}` });
    expect(rows[0]?.body).toMatch(/\n2 katılıyor, 1 katılmıyor, 3 yanıt yok\.$/);

    await run();
    expect(await notifsFor(t, 'deadline_summary')).toHaveLength(2);
  });

  it('skips old backlog (deadline long gone) and trainings that already started', async () => {
    await cleanOutbox();
    const old = await insertTraining({ startsAt: in_(5), deadline: in_(-13), createdAt: in_(-80) });
    const started = await insertTraining({ startsAt: in_(-1), deadline: in_(-3), createdAt: in_(-80) });
    await cleanOutbox();
    await run();
    expect(await notifsFor(old, 'deadline_summary')).toEqual([]);
    expect(await notifsFor(started, 'deadline_summary')).toEqual([]);
  });

  it('cleans the inbox after 60 days', async () => {
    await cleanOutbox();
    const t = await insertTraining({ startsAt: in_(200), deadline: in_(100), createdAt: in_(-5) });
    await db.query(`update public.notification_outbox set created_at = now() - interval '61 days' where training_id = $1 and user_id = $2`, [t, ids.member1]);
    const before = (await notifsFor(t)).length;
    expect((await run()).pruned).toBe(1);
    expect(await notifsFor(t)).toHaveLength(before - 1);
  });
});

describe('program notifications', () => {
  const save = (t: string, assignments: unknown[], publish: boolean, notify?: boolean, extras: Record<string, unknown> = {}) =>
    as(db, ids.coach1, () =>
      notify === undefined
        ? db.query('select public.save_program($1, $2::jsonb, $3)', [t, JSON.stringify({ assignments, ...extras }), publish])
        : db.query('select public.save_program($1, $2::jsonb, $3, $4)', [t, JSON.stringify({ assignments, ...extras }), publish, notify]),
    );
  const entry = (slot: number, b: string, crew: string[]) => ({ slot_index: slot, boat_id: b, crew });
  const newProgramTraining = async () => {
    const t = await insertTraining({ startsAt: new Date(Date.now() + 3 * 86_400_000).toISOString().replace(/T.*/, 'T05:00:00Z'), deadline: new Date(Date.now() + 2 * 86_400_000).toISOString(), slots: 2 });
    await cleanOutbox();
    return t;
  };
  const byUser = (rows: Notif[]) => Object.fromEntries(rows.map((r) => [r.user_id, r]));

  it('first publish: personal lines for the crew, a heads-up for attendees without a boat, nothing for the rest', async () => {
    const t = await newProgramTraining();
    await db.query(`insert into public.training_responses (training_id, member_id, response) values ($1, $2, 'attending'), ($1, $3, 'not_attending')`, [t, x.alex, x.ashley]);
    await save(t, [entry(0, boat.mavi, [ids.member1, ids.member2]), entry(1, boat.mavi, [x.john, x.jamie]), entry(1, boat.turuncu, [ids.member1])], true);

    const rows = byUser(await notifsFor(t));
    expect(Object.keys(rows).sort()).toEqual([ids.member1, ids.member2, x.john, x.jamie, x.alex].sort());
    expect(rows[ids.member1]).toMatchObject({ type: 'program_published', title: 'Programınız hazır', url: `/uye/antrenmanlar/${t}` });
    expect(rows[ids.member1]?.body.split('\n').slice(1)).toEqual(['08:00–09:00 · Mavi · Becca Kaya ile', '09:00–10:00 · Turuncu · tek başına']); // two hours, in order
    expect(rows[x.john]?.body.split('\n')[1]).toBe('09:00–10:00 · Mavi · Jamie ile');
    expect(rows[x.alex]).toMatchObject({ title: 'Program yayınlandı', body: 'Henüz bir tekneye atanmadınız. Antrenörünüzle görüşün.' });
    expect(rows[x.ashley]).toBeUndefined(); // said "not attending"
  });

  it('lists three crew mates as "A, B ve C ile"', async () => {
    const t = await newProgramTraining();
    await save(t, [entry(0, boat.c4x, [ids.member1, ids.member2, x.john, x.jamie])], true);
    const rows = byUser(await notifsFor(t));
    expect(rows[ids.member1]?.body.split('\n')[1]).toBe('08:00–09:00 · C4X · Becca Kaya, John ve Jamie ile');
  });

  it('draft saves and unpublishing notify nobody', async () => {
    const t = await newProgramTraining();
    await save(t, [entry(0, boat.mavi, [ids.member1])], false);
    await save(t, [entry(0, boat.mavi, [ids.member1])], true, false);
    await cleanOutbox();
    await save(t, [entry(0, boat.mavi, [ids.member1])], false);
    expect(await notifsFor(t)).toEqual([]);
  });

  it('p_notify = false publishes silently', async () => {
    const t = await newProgramTraining();
    await save(t, [entry(0, boat.mavi, [ids.member1, ids.member2])], true, false);
    expect(await notifsFor(t)).toEqual([]);
  });

  it('update: notifies everyone in a boat-hour whose crew changed (also people taken out or with a new mate)', async () => {
    const t = await newProgramTraining();
    await save(t, [entry(0, boat.mavi, [ids.member1, ids.member2]), entry(0, boat.turuncu, [x.john, x.jamie]), entry(1, boat.mavi, [x.alex])], true);
    await cleanOutbox();

    // Becca is replaced by Ashley in Mavi/hour 1; Turuncu and Alex's hour stay untouched.
    await save(t, [entry(0, boat.mavi, [ids.member1, x.ashley]), entry(0, boat.turuncu, [x.john, x.jamie]), entry(1, boat.mavi, [x.alex])], true);
    const rows = byUser(await notifsFor(t));
    expect(Object.keys(rows).sort()).toEqual([ids.member1, ids.member2, x.ashley].sort());
    expect(rows[ids.member1]).toMatchObject({ type: 'program_updated', title: 'Programınız güncellendi' });
    expect(rows[ids.member1]?.body.split('\n')[1]).toBe('08:00–09:00 · Mavi · Ashley ile'); // new mate
    expect(rows[ids.member2]?.body).toBe('Bu antrenmanda artık bir tekneye atanmadınız.'); // taken out
    expect(rows[x.ashley]?.body.split('\n')[1]).toBe('08:00–09:00 · Mavi · Ali Yılmaz ile');
  });

  it('update without any change in boats/crews, or with only notes changed, notifies nobody', async () => {
    const t = await newProgramTraining();
    const program = [entry(0, boat.mavi, [ids.member1, ids.member2])];
    await save(t, program, true);
    await cleanOutbox();
    await save(t, program, true);
    await save(t, program, true, true, { weather_note: 'Rüzgâr batıdan', training_notes: 'Isınma 10 dk' });
    expect(await notifsFor(t)).toEqual([]);
  });

  it('never notifies deactivated members', async () => {
    const t = await newProgramTraining();
    await db.query(`insert into public.training_responses (training_id, member_id, response) values ($1, $2, 'attending')`, [t, ids.exMember]);
    await save(t, [entry(0, boat.mavi, [ids.member1])], true);
    expect(recipients(await notifsFor(t))).toEqual([ids.member1, ids.exMember].filter((m) => m === ids.member1));
  });

  it('keeps the 3-argument call working (notify defaults to true)', async () => {
    const t = await newProgramTraining();
    await save(t, [entry(0, boat.mavi, [ids.member1])], true);
    expect((await notifsFor(t)).length).toBe(1);
  });
});

describe('the inbox (notification_outbox access)', () => {
  let mine: string;
  beforeAll(async () => {
    await cleanOutbox();
    await db.query(
      `insert into public.notification_outbox (user_id, type, title, body, url, dedupe_key) values
       ($1, 'training_new', 'Ali için', 'b', '/uye', 'k-ali'), ($2, 'training_new', 'Becca için', 'b', '/uye', 'k-becca'), ($3, 'deadline_summary', 'Koç için', 'b', '/antrenor', 'k-coach'), ($4, 'training_new', 'Eski üye', 'b', '/uye', 'k-ex')`,
      [ids.member1, ids.member2, ids.coach1, ids.exMember],
    );
    mine = (await db.query<{ id: string }>(`select id from public.notification_outbox where dedupe_key = 'k-ali'`)).rows[0]!.id;
  });
  const titles = (who: string) => as(db, who, async () => (await db.query<{ title: string }>('select title from public.notification_outbox order by title')).rows.map((r) => r.title));

  it('shows everyone only their own rows (a coach does not see members\' messages)', async () => {
    expect(await titles(ids.member1)).toEqual(['Ali için']);
    expect(await titles(ids.coach1)).toEqual(['Koç için']);
  });

  it('shows deactivated users nothing and is closed to anonymous callers', async () => {
    expect(await titles(ids.exMember)).toEqual([]);
    await expect(as(db, 'anon', () => db.query('select * from public.notification_outbox'))).rejects.toThrow(/permission denied/);
  });

  it('lets a user mark their own message read — and only that column, only their own', async () => {
    const ok = await as(db, ids.member1, () => db.query(`update public.notification_outbox set read_at = now() where id = $1`, [mine]));
    expect(ok.affectedRows).toBe(1);
    const others = await as(db, ids.member2, () => db.query(`update public.notification_outbox set read_at = now() where dedupe_key = 'k-ali'`));
    expect(others.affectedRows).toBe(0);
    await expect(as(db, ids.member1, () => db.query(`update public.notification_outbox set title = 'x' where id = $1`, [mine]))).rejects.toThrow(/permission denied/);
    await expect(as(db, ids.member1, () => db.query(`update public.notification_outbox set user_id = $2 where id = $1`, [mine, ids.member2]))).rejects.toThrow(/permission denied/);
    await expect(as(db, ids.member1, () => db.query(`update public.notification_outbox set push_done_at = now() where id = $1`, [mine]))).rejects.toThrow(/permission denied/);
  });

  it('cannot be inserted into or deleted from by clients', async () => {
    await expect(as(db, ids.coach1, () => db.query(`insert into public.notification_outbox (user_id, type, title, body, dedupe_key) values ($1, 'training_new', 'x', 'y', 'spam')`, [ids.member1]))).rejects.toThrow(/permission denied/);
    await expect(as(db, ids.member1, () => db.query(`delete from public.notification_outbox`))).rejects.toThrow(/permission denied/);
  });

  it('only allows links inside the app (a notification can never point to another site)', async () => {
    for (const url of ['http://evil.example', '//evil.example', 'javascript:alert(1)']) {
      await expect(db.query(`insert into public.notification_outbox (user_id, type, title, body, url, dedupe_key) values ($1, 'training_new', 'x', 'y', $2, $3)`, [ids.member1, url, `bad-${url}`])).rejects.toThrow(/notification_outbox_url_internal/);
    }
  });
});

describe('weather_snapshots and club settings', () => {
  it('are readable by signed-in users, writable by nobody through the API', async () => {
    const t = await insertTraining({ startsAt: '2026-10-20T05:00:00Z', deadline: '2026-10-19T05:00:00Z' });
    await db.query(`insert into public.weather_snapshots (training_id, slot_index, source, forecast_for, wind_kmh) values ($1, 0, 'open-meteo', '2026-10-20T05:00:00Z', 12)`, [t]);
    const rows = await as(db, ids.member1, () => db.query('select wind_kmh from public.weather_snapshots where training_id = $1', [t]));
    expect(rows.rows).toHaveLength(1);
    await expect(as(db, 'anon', () => db.query('select * from public.weather_snapshots'))).rejects.toThrow(/permission denied/);
    for (const who of [ids.coach1, ids.member1]) {
      await expect(as(db, who, () => db.query(`insert into public.weather_snapshots (training_id, slot_index, source, forecast_for) values ($1, 1, 'x', now())`, [t]))).rejects.toThrow(/permission denied/);
      await expect(as(db, who, () => db.query(`update public.weather_snapshots set wind_kmh = 99`))).rejects.toThrow(/permission denied/);
    }
    expect((await as(db, ids.exMember, () => db.query('select * from public.weather_snapshots'))).rows).toHaveLength(0);
  });

  it('lets coaches (only) change the reminder lead time within 1–24 hours', async () => {
    const ok = await as(db, ids.coach1, () => db.query(`update public.club_settings set reminder_lead_hours = 4`));
    expect(ok.affectedRows).toBe(1);
    await expect(as(db, ids.coach1, () => db.query(`update public.club_settings set reminder_lead_hours = 0`))).rejects.toThrow(/club_settings_reminder_lead/);
    await expect(as(db, ids.coach1, () => db.query(`update public.club_settings set reminder_lead_hours = 25`))).rejects.toThrow(/club_settings_reminder_lead/);
    expect((await as(db, ids.member1, () => db.query(`update public.club_settings set reminder_lead_hours = 1`))).affectedRows).toBe(0);
    await db.query(`update public.club_settings set reminder_lead_hours = 3`);
  });
});
