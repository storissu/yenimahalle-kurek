import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, ids, seedPeople } from './harness';

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  await seedPeople(db);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const names = (rows: Array<{ full_name: string }>) => rows.map((r) => r.full_name).sort();

describe('profiles', () => {
  it('denies anonymous users everything', async () => {
    await expect(as(db, 'anon', () => db.query('select * from public.profiles'))).rejects.toThrow(/permission denied/);
  });

  it('lets a member read only their own profile', async () => {
    const res = await as(db, ids.member1, () => db.query<{ full_name: string }>('select full_name from public.profiles'));
    expect(names(res.rows)).toEqual(['Ali Yılmaz']);
  });

  it('lets an active coach read every profile', async () => {
    const res = await as(db, ids.coach1, () => db.query('select id from public.profiles'));
    expect(res.rows).toHaveLength(6);
  });

  it('gives a deactivated coach no coach powers (sees only own row)', async () => {
    const res = await as(db, ids.exCoach, () => db.query('select id from public.profiles'));
    expect(res.rows).toHaveLength(1);
  });

  it('does not let a member edit any profile, including their own', async () => {
    const res = await as(db, ids.member1, () =>
      db.query(`update public.profiles set full_name = 'Hacked Name' where id = $1`, [ids.member1]),
    );
    expect(res.affectedRows).toBe(0);
    const check = await db.query<{ full_name: string }>('select full_name from public.profiles where id = $1', [ids.member1]);
    expect(check.rows[0]?.full_name).toBe('Ali Yılmaz');
  });

  it.each([
    ['role', `role = 'coach'`],
    ['is_active', `is_active = true`],
    ['username', `username = 'renamed'`],
    ['must_change_password', `must_change_password = false`],
  ])('never lets a client change %s directly (not even a coach)', async (_col, assignment) => {
    await expect(
      as(db, ids.coach1, () => db.query(`update public.profiles set ${assignment} where id = $1`, [ids.member1])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, ids.member1, () => db.query(`update public.profiles set ${assignment} where id = $1`, [ids.member1])),
    ).rejects.toThrow(/permission denied/);
  });

  it('lets a coach edit full_name and phone of a member', async () => {
    const res = await as(db, ids.coach1, () =>
      db.query(`update public.profiles set full_name = 'Ali Y.', phone = '555 000 00 00' where id = $1`, [ids.member1]),
    );
    expect(res.affectedRows).toBe(1);
    await db.query(`update public.profiles set full_name = 'Ali Yılmaz', phone = null where id = $1`, [ids.member1]);
  });

  it('forbids inserting or deleting profiles from a client', async () => {
    await expect(
      as(db, ids.coach1, () =>
        db.query(`insert into public.profiles (id, username, full_name) values (gen_random_uuid(), 'x.y.z', 'Someone')`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(db, ids.coach1, () => db.query(`delete from public.profiles where id = $1`, [ids.member2])),
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    ['uppercase', 'Ali'],
    ['turkish letters', 'şükrü'],
    ['too short', 'ab'],
    ['spaces', 'ali veli'],
    ['too long', 'a'.repeat(31)],
  ])('rejects invalid usernames (%s)', async (_label, username) => {
    await db.query(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000ffff', 'tmp@kulup.invalid') on conflict do nothing`);
    await expect(
      db.query(`insert into public.profiles (id, username, full_name) values ('00000000-0000-4000-8000-00000000ffff', $1, 'Temp User')`, [username]),
    ).rejects.toThrow(/profiles_username_format/);
  });

  it('rejects duplicate usernames', async () => {
    await db.query(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000fffe', 'dup@kulup.invalid') on conflict do nothing`);
    await expect(
      db.query(`insert into public.profiles (id, username, full_name) values ('00000000-0000-4000-8000-00000000fffe', 'ali', 'Duplicate')`),
    ).rejects.toThrow(/profiles_username_unique/);
  });
});

describe('complete_password_change', () => {
  it('clears only the caller\'s flag', async () => {
    await db.query(`update public.profiles set must_change_password = true where id in ($1, $2)`, [ids.member1, ids.member2]);
    await as(db, ids.member1, () => db.query('select public.complete_password_change()'));
    const res = await db.query<{ id: string; must_change_password: boolean }>(
      'select id, must_change_password from public.profiles where id in ($1, $2)',
      [ids.member1, ids.member2],
    );
    const flag = (id: string) => res.rows.find((r) => r.id === id)?.must_change_password;
    expect(flag(ids.member1)).toBe(false);
    expect(flag(ids.member2)).toBe(true);
    await db.query(`update public.profiles set must_change_password = false where id = $1`, [ids.member2]);
  });

  it('is not callable anonymously', async () => {
    await expect(as(db, 'anon', () => db.query('select public.complete_password_change()'))).rejects.toThrow(/permission denied/);
  });
});

describe('member_directory', () => {
  it('shows active members by name only', async () => {
    const res = await as(db, ids.member1, () => db.query<{ full_name: string }>('select * from public.member_directory'));
    expect(names(res.rows)).toEqual(['Ali Yılmaz', 'Becca Kaya']);
    expect(Object.keys(res.rows[0] ?? {}).sort()).toEqual(['full_name', 'id']);
  });

  it('hides coaches and deactivated members', async () => {
    const res = await as(db, ids.member2, () => db.query<{ full_name: string }>('select * from public.member_directory'));
    expect(names(res.rows)).not.toContain('Ayşe Antrenör');
    expect(names(res.rows)).not.toContain('Eski Üye');
  });

  it('returns nothing to a deactivated user', async () => {
    const res = await as(db, ids.exMember, () => db.query('select * from public.member_directory'));
    expect(res.rows).toHaveLength(0);
  });

  it('is denied to anonymous users', async () => {
    await expect(as(db, 'anon', () => db.query('select * from public.member_directory'))).rejects.toThrow(/permission denied/);
  });
});

describe('boats', () => {
  it('is seeded with the club boats', async () => {
    const res = await as(db, ids.member1, () =>
      db.query<{ name: string; capacity: number }>('select name, capacity from public.boats order by sort_order'),
    );
    expect(res.rows).toEqual([
      { name: 'Mavi', capacity: 2 },
      { name: 'Turuncu', capacity: 2 },
      { name: 'C4X', capacity: 4 },
    ]);
  });

  it('is unreadable for anonymous and deactivated users', async () => {
    await expect(as(db, 'anon', () => db.query('select * from public.boats'))).rejects.toThrow(/permission denied/);
    const res = await as(db, ids.exMember, () => db.query('select * from public.boats'));
    expect(res.rows).toHaveLength(0);
  });

  it('cannot be changed by members', async () => {
    await expect(
      as(db, ids.member1, () => db.query(`insert into public.boats (name, capacity) values ('Sızıntı', 2)`)),
    ).rejects.toThrow(/row-level security/);
    const res = await as(db, ids.member1, () => db.query(`update public.boats set capacity = 8 where name = 'Mavi'`));
    expect(res.affectedRows).toBe(0);
  });

  it('can be managed by coaches, within limits', async () => {
    await as(db, ids.coach1, () => db.query(`insert into public.boats (name, capacity, sort_order) values ('Yeşil', 1, 4)`));
    const upd = await as(db, ids.coach1, () => db.query(`update public.boats set is_active = false where name = 'Yeşil'`));
    expect(upd.affectedRows).toBe(1);
    await expect(
      as(db, ids.coach1, () => db.query(`update public.boats set capacity = 0 where name = 'Mavi'`)),
    ).rejects.toThrow(/boats_capacity_range/);
    await expect(
      as(db, ids.coach1, () => db.query(`insert into public.boats (name, capacity) values ('Mavi', 2)`)),
    ).rejects.toThrow(/boats_name_unique/);
    await expect(
      as(db, ids.coach1, () => db.query(`delete from public.boats where name = 'Yeşil'`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('club_settings', () => {
  it('holds the training site coordinates', async () => {
    const res = await as(db, ids.member1, () =>
      db.query<{ site_lat: number; site_lng: number; timezone: string }>('select site_lat, site_lng, timezone from public.club_settings'),
    );
    expect(res.rows).toEqual([{ site_lat: 41.285318, site_lng: 31.407823, timezone: 'Europe/Istanbul' }]);
  });

  it('cannot be updated by members', async () => {
    const res = await as(db, ids.member1, () => db.query(`update public.club_settings set wind_gust_warn_kmh = 1`));
    expect(res.affectedRows).toBe(0);
  });

  it('lets coaches set warning thresholds but not club identity or timezone', async () => {
    const ok = await as(db, ids.coach1, () =>
      db.query(`update public.club_settings set wind_gust_warn_kmh = 35, wave_warn_m = 1.2`),
    );
    expect(ok.affectedRows).toBe(1);
    await expect(
      as(db, ids.coach1, () => db.query(`update public.club_settings set timezone = 'UTC'`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('stays a singleton', async () => {
    await expect(
      as(db, ids.coach1, () =>
        db.query(`insert into public.club_settings (club_name, site_name, site_lat, site_lng) values ('x','y',1,1)`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
