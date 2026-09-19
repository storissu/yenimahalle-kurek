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

// Sequence matters: two active coaches exist (coach1, coach2).
describe('last active coach guard (applies to the service role too)', () => {
  it('allows deactivating a coach while another active coach remains', async () => {
    await as(db, 'service', () =>
      db.query(`update public.profiles set is_active = false where id = $1`, [ids.coach2]),
    );
    const res = await db.query<{ is_active: boolean }>('select is_active from public.profiles where id = $1', [ids.coach2]);
    expect(res.rows[0]?.is_active).toBe(false);
  });

  it('blocks deactivating the last active coach', async () => {
    await expect(
      as(db, 'service', () => db.query(`update public.profiles set is_active = false where id = $1`, [ids.coach1])),
    ).rejects.toThrow(/Son aktif antrenör/);
  });

  it('blocks demoting the last active coach', async () => {
    await expect(
      as(db, 'service', () => db.query(`update public.profiles set role = 'member' where id = $1`, [ids.coach1])),
    ).rejects.toThrow(/Son aktif antrenör/);
  });

  it('blocks deleting the last active coach', async () => {
    await expect(
      as(db, 'service', () => db.query(`delete from public.profiles where id = $1`, [ids.coach1])),
    ).rejects.toThrow(/Son aktif antrenör/);
  });

  it('allows promoting a member, which frees the previous coach to be demoted', async () => {
    await as(db, 'service', () => db.query(`update public.profiles set role = 'coach' where id = $1`, [ids.member1]));
    await as(db, 'service', () => db.query(`update public.profiles set role = 'member' where id = $1`, [ids.coach1]));
    const res = await db.query<{ role: string }>('select role from public.profiles where id = $1', [ids.coach1]);
    expect(res.rows[0]?.role).toBe('member');
  });
});
