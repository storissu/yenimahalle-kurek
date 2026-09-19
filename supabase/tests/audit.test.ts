import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, ids, seedPeople } from './harness';

let db: PGlite;
let mavi = '';

beforeAll(async () => {
  db = await createDb();
  await seedPeople(db);
  mavi = (await db.query<{ id: string }>(`select id from public.boats where name = 'Mavi'`)).rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

type Entry = { category: string; action: string; entity: string; entity_id: string | null; summary: string; detail: Record<string, unknown>; actor_id: string | null; actor_name: string | null };
const entries = async (where = 'true', params: unknown[] = []): Promise<Entry[]> =>
  (await db.query<Entry>(`select category, action, entity, entity_id, summary, detail, actor_id, actor_name from public.audit_log where ${where} order by id`, params)).rows;
const forEntity = (id: string) => entries('entity_id = $1', [id]);
const clear = () => db.query('delete from public.audit_log');

/** A training created THROUGH THE API by a coach (so the actor is known). */
async function coachTraining(startsIn = '3 days'): Promise<string> {
  const res = await as(db, ids.coach1, () =>
    db.query<{ id: string }>(
      `insert into public.trainings (title, starts_at, rsvp_deadline) values ('Sabah', now() + $1::interval, now() + $1::interval - interval '1 day') returning id`,
      [startsIn],
    ),
  );
  return res.rows[0]!.id;
}
const asCoach = <T>(fn: () => Promise<T>) => as(db, ids.coach1, fn);

describe('audit_log: who can see and write it', () => {
  it('is readable by coaches only', async () => {
    await coachTraining();
    expect((await as(db, ids.coach2, () => db.query('select id from public.audit_log'))).rows.length).toBeGreaterThan(0);
    expect((await as(db, ids.member1, () => db.query('select id from public.audit_log'))).rows).toHaveLength(0);
    expect((await as(db, ids.exCoach, () => db.query('select id from public.audit_log'))).rows).toHaveLength(0);
    await expect(as(db, 'anon', () => db.query('select id from public.audit_log'))).rejects.toThrow(/permission denied/);
  });

  it('cannot be written, changed or deleted by any app user, coaches included', async () => {
    await expect(asCoach(() => db.query(`insert into public.audit_log (category, action, entity, summary) values ('training', 'x', 'x', 'y')`))).rejects.toThrow(/permission denied/);
    await expect(asCoach(() => db.query(`update public.audit_log set summary = 'z'`))).rejects.toThrow(/permission denied/);
    await expect(asCoach(() => db.query(`delete from public.audit_log`))).rejects.toThrow(/permission denied/);
    await expect(asCoach(() => db.query(`select public.log_audit('training', 'x', 'x', null, 'y')`))).rejects.toThrow(/permission denied/);
    await expect(as(db, ids.member1, () => db.query(`select public.prune_audit_log()`))).rejects.toThrow(/permission denied/);
  });

  it('only accepts known categories', async () => {
    await expect(db.query(`insert into public.audit_log (category, action, entity, summary) values ('nonsense', 'x', 'x', 'y')`)).rejects.toThrow(/audit_log_category/);
  });
});

describe('trainings', () => {
  it('records who created a training, and when it is', async () => {
    await clear();
    const t = await coachTraining('3 days');
    const [entry] = await forEntity(t);
    expect(entry).toMatchObject({ category: 'training', action: 'training.create', actor_id: ids.coach1, actor_name: 'Ayşe Antrenör' });
    expect(entry?.summary).toMatch(/^Antrenman oluşturuldu: \d+ \S+ \S+ \d\d:\d\d$/);
  });

  it('records edits with WHICH fields changed, but not for bookkeeping changes', async () => {
    const t = await coachTraining();
    await clear();
    await asCoach(() => db.query(`update public.trainings set title = 'Akşam', notes = 'Not' where id = $1`, [t]));
    await asCoach(() => db.query(`update public.trainings set rsvp_deadline = rsvp_deadline - interval '1 hour' where id = $1`, [t]));
    const edits = await forEntity(t);
    expect(edits.map((e) => e.action)).toEqual(['training.edit', 'training.edit']);
    expect(edits[0]?.detail).toEqual({ fields: ['title', 'notes'] });
    expect(edits[1]?.detail).toEqual({ fields: ['rsvp_deadline'] });

    await clear();
    await db.query(`update public.trainings set slot_count = 2, deadline_reminder_sent_at = now(), deadline_summary_sent_at = now() where id = $1`, [t]);
    expect(await forEntity(t)).toEqual([]);
  });

  it('records a cancellation with its reason', async () => {
    const t = await coachTraining();
    await clear();
    await asCoach(() => db.query(`select public.cancel_training($1, 'Şiddetli rüzgâr')`, [t]));
    const [entry] = await forEntity(t);
    expect(entry).toMatchObject({ action: 'training.cancel', actor_name: 'Ayşe Antrenör' });
    expect(entry?.summary).toContain('Şiddetli rüzgâr');
  });

  it('records an answer a coach entered for a member — and never the members\' own answers', async () => {
    const t = await coachTraining();
    await clear();
    await as(db, ids.member1, () => db.query(`select public.set_rsvp($1, 'attending', 'not')`, [t]));
    expect(await forEntity(t)).toEqual([]);
    await asCoach(() => db.query(`select public.coach_set_rsvp($1, $2, 'not_attending')`, [t, ids.member2]));
    const [entry] = await forEntity(t);
    expect(entry).toMatchObject({ action: 'rsvp.coach', actor_id: ids.coach1 });
    expect(entry?.summary).toMatch(/^Becca Kaya için yanıt girildi \(Katılmıyor\)/);
  });
});

describe('programs', () => {
  const save = (t: string, publish: boolean, crew = [ids.member1]) =>
    asCoach(() => db.query(`select public.save_program($1, $2::jsonb, $3, false)`, [t, JSON.stringify({ assignments: [{ slot_index: 0, boat_id: mavi, crew }] }), publish]));

  it('records draft, publish, update and unpublish with the version', async () => {
    const t = await coachTraining();
    await clear();
    await save(t, false);
    await save(t, true);
    await save(t, true, [ids.member2]);
    await save(t, false);
    const rows = (await forEntity(t)).filter((e) => e.category === 'program');
    expect(rows.map((r) => r.action)).toEqual(['program.draft', 'program.publish', 'program.update', 'program.unpublish']);
    expect(rows.map((r) => r.detail.version)).toEqual([0, 1, 2, 2]);
    expect(rows[1]?.summary).toMatch(/^Program yayınlandı \(sürüm 1\): /);
    expect(rows.every((r) => r.actor_id === ids.coach1)).toBe(true);
  });

  it('does not log a failed save (the whole save rolled back)', async () => {
    const t = await coachTraining();
    await clear();
    await expect(save(t, true, ['00000000-0000-4000-8000-000000000999'])).rejects.toThrow();
    expect(await forEntity(t)).toEqual([]);
  });
});

describe('attendance', () => {
  it('records ONE entry per save with the number of records, and the completion', async () => {
    const started = (await db.query<{ id: string }>(
      `insert into public.trainings (starts_at, slot_count, rsvp_deadline, created_by) values (now() - interval '1 hour', 2, now() - interval '1 day', $1) returning id`,
      [ids.coach1],
    )).rows[0]!.id;
    await clear();
    const rows = [
      { slot_index: 0, member_id: ids.member1, status: 'present' },
      { slot_index: 0, member_id: ids.member2, status: 'present' },
      { slot_index: 1, member_id: ids.member1, status: 'absent' },
    ];
    await asCoach(() => db.query(`select public.save_attendance($1, $2::jsonb, false)`, [started, JSON.stringify(rows)]));
    let list = await forEntity(started);
    expect(list.map((e) => e.action)).toEqual(['attendance.save']);
    expect(list[0]?.detail).toEqual({ count: 3 });

    await clear();
    await asCoach(() => db.query(`select public.save_attendance($1, $2::jsonb, true)`, [started, JSON.stringify(rows)]));
    list = await forEntity(started);
    expect(list.map((e) => e.action).sort()).toEqual(['attendance.save', 'training.complete']);
    expect(list.find((e) => e.action === 'training.complete')?.actor_name).toBe('Ayşe Antrenör');
  });
});

describe('settings, boats and members', () => {
  it('records boat and settings changes with the changed fields', async () => {
    await clear();
    await asCoach(() => db.query(`insert into public.boats (name, capacity, sort_order) values ('Yeşil', 1, 9)`));
    await asCoach(() => db.query(`update public.boats set capacity = 2, requires_full_crew = true where name = 'Yeşil'`));
    await asCoach(() => db.query(`update public.boats set sort_order = 8 where name = 'Yeşil'`)); // not interesting
    await asCoach(() => db.query(`update public.club_settings set wind_gust_warn_kmh = 30, wave_warn_m = 1`));
    const list = await entries("category = 'settings'");
    expect(list.map((e) => e.action)).toEqual(['boat.create', 'boat.update', 'settings.update']);
    expect(list[0]?.summary).toBe('Tekne eklendi: Yeşil (1 kişilik)');
    expect(list[1]?.detail).toEqual({ fields: ['capacity', 'requires_full_crew'] });
    expect(list[2]?.detail).toEqual({ fields: ['wind_gust_warn_kmh', 'wave_warn_m'] });
    await db.query(`update public.club_settings set wind_gust_warn_kmh = null, wave_warn_m = null`);
  });

  it('records a coach editing a member, WITHOUT storing the phone number or name values', async () => {
    await clear();
    await asCoach(() => db.query(`update public.profiles set phone = '0555 111 22 33' where id = $1`, [ids.member1]));
    const [entry] = await entries("action = 'member.edit'");
    expect(entry).toMatchObject({ category: 'member', entity_id: ids.member1, actor_id: ids.coach1 });
    expect(entry?.detail).toEqual({ fields: ['phone'] });
    expect(JSON.stringify(entry)).not.toContain('0555');
    await db.query(`update public.profiles set phone = null where id = $1`, [ids.member1]);
  });

  it('does not log service-role profile changes itself (the Edge Function logs those with the coach as actor)', async () => {
    await clear();
    await as(db, 'service', () => db.query(`update public.profiles set full_name = 'Ali Y.' where id = $1`, [ids.member1]));
    expect(await entries("action = 'member.edit'")).toEqual([]);
    await db.query(`update public.profiles set full_name = 'Ali Yılmaz' where id = $1`, [ids.member1]);
  });

  it('lets the service role record an action on a coach\'s behalf (create / reset / deactivate)', async () => {
    await clear();
    await as(db, 'service', () =>
      db.query(`select public.log_audit('member', 'member.create', 'profile', $1, 'Üye eklendi: Ali Yılmaz (@ali)', '{"role":"member"}'::jsonb, $2)`, [ids.member1, ids.coach2]),
    );
    const [entry] = await entries("action = 'member.create'");
    expect(entry).toMatchObject({ actor_id: ids.coach2, actor_name: 'Mehmet Antrenör', detail: { role: 'member' } });
  });
});

describe('housekeeping', () => {
  it('merges identical events inside one transaction into one entry with a count', async () => {
    await clear();
    const t = await coachTraining();
    await clear();
    await db.exec(`begin;
      select public.log_audit('attendance', 'attendance.save', 'training', '${t}', 'x', '{"count": 1}');
      select public.log_audit('attendance', 'attendance.save', 'training', '${t}', 'x', '{"count": 1}');
      select public.log_audit('attendance', 'attendance.save', 'training', '${t}', 'x', '{"count": 1}');
      commit;`);
    const list = await forEntity(t);
    expect(list).toHaveLength(1);
    expect(list[0]?.detail).toEqual({ count: 3 });
  });

  it('keeps the actor\'s name when their account is removed, and drops entries after a year', async () => {
    await clear();
    const t = await coachTraining();
    await db.query(`update public.audit_log set at = now() - interval '400 days' where entity_id = $1`, [t]);
    await db.query(`insert into public.audit_log (category, action, entity, summary, actor_id, actor_name) values ('training', 'training.create', 'training', 'recent', $1, 'Ayşe Antrenör')`, [ids.coach1]);
    expect((await db.query<{ n: number }>('select public.prune_audit_log() as n')).rows[0]?.n).toBe(1);
    const left = await entries();
    expect(left.map((e) => e.summary)).toEqual(['recent']);

    // actor FK is "on delete set null": the name snapshot survives
    await db.query(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000d1', 'gone@kulup.invalid')`);
    await db.query(`insert into public.profiles (id, username, full_name, role, must_change_password) values ('00000000-0000-4000-8000-0000000000d1', 'gone', 'Silinen Üye', 'member', false)`);
    await db.query(`insert into public.audit_log (category, action, entity, summary, actor_id, actor_name) values ('member', 'member.edit', 'profile', 'x', '00000000-0000-4000-8000-0000000000d1', 'Silinen Üye')`);
    await db.query(`delete from public.profiles where id = '00000000-0000-4000-8000-0000000000d1'`);
    const kept = (await entries("summary = 'x'"))[0];
    expect(kept).toMatchObject({ actor_id: null, actor_name: 'Silinen Üye' });
  });

  it('ping() answers everyone (keep-alive) and returns nothing but the time', async () => {
    for (const who of ['anon', ids.member1, ids.coach1] as const) {
      const res = await as(db, who, () => db.query<{ ping: string }>('select public.ping()'));
      expect(Object.keys(res.rows[0] ?? {})).toEqual(['ping']);
      expect(Math.abs(Date.parse(res.rows[0]!.ping) - Date.now())).toBeLessThan(60_000);
    }
  });
});
