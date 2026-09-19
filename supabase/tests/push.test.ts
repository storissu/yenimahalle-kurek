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

const register = (endpoint: string, p256dh = 'key') =>
  db.query('select public.register_push_subscription($1, $2, $3, $4)', [endpoint, p256dh, 'authsecret', 'test-agent']);

describe('push_subscriptions', () => {
  it('lets an active user register a subscription and read only their own', async () => {
    await as(db, ids.member1, () => register('https://push.example/ali-phone'));
    await as(db, ids.member2, () => register('https://push.example/becca-phone'));
    const mine = await as(db, ids.member1, () => db.query<{ endpoint: string }>('select endpoint from public.push_subscriptions'));
    expect(mine.rows.map((r) => r.endpoint)).toEqual(['https://push.example/ali-phone']);
  });

  it('does not let coaches (or anyone else) read other people\'s subscriptions through the API', async () => {
    const res = await as(db, ids.coach1, () => db.query('select * from public.push_subscriptions'));
    expect(res.rows).toHaveLength(0);
  });

  it('re-assigns a device to whoever registers it last', async () => {
    await as(db, ids.member2, () => register('https://push.example/shared-device'));
    await as(db, ids.member1, () => register('https://push.example/shared-device', 'newkey'));
    const res = await db.query<{ user_id: string; p256dh: string }>(
      `select user_id, p256dh from public.push_subscriptions where endpoint = 'https://push.example/shared-device'`,
    );
    expect(res.rows).toEqual([{ user_id: ids.member1, p256dh: 'newkey' }]);
  });

  it('rejects deactivated users and anonymous callers', async () => {
    await expect(as(db, ids.exMember, () => register('https://push.example/ex'))).rejects.toThrow(/Yetkisiz/);
    await expect(as(db, 'anon', () => register('https://push.example/anon'))).rejects.toThrow(/permission denied/);
  });

  it('cannot be written directly, only through the RPC', async () => {
    await expect(
      as(db, ids.member1, () =>
        db.query(
          `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/direct', 'k', 'a')`,
          [ids.member1],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('lets users delete only their own subscriptions', async () => {
    const other = await as(db, ids.member1, () =>
      db.query(`delete from public.push_subscriptions where endpoint = 'https://push.example/becca-phone'`),
    );
    expect(other.affectedRows).toBe(0);
    const own = await as(db, ids.member1, () =>
      db.query(`delete from public.push_subscriptions where endpoint = 'https://push.example/ali-phone'`),
    );
    expect(own.affectedRows).toBe(1);
  });

  it('is fully readable by the service role (used to send notifications)', async () => {
    const res = await as(db, 'service', () => db.query('select * from public.push_subscriptions'));
    expect(res.rows.length).toBeGreaterThan(0);
  });
});
