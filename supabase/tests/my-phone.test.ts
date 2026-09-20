import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, ids, seedPeople } from './harness';

// update_my_phone(): a member changes their OWN phone number, nothing else.

let db: PGlite;
const ALI = ids.member1;
const BECCA = ids.member2;

beforeAll(async () => {
  db = await createDb();
  await seedPeople(db);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const setPhone = (who: string, phone: string | null) => as(db, who, () => db.query('select public.update_my_phone($1)', [phone]));
const phoneOf = async (id: string) => (await db.query<{ phone: string | null }>('select phone from public.profiles where id = $1', [id])).rows[0]!.phone;

describe('update_my_phone', () => {
  it('changes the caller\'s own number — and only theirs', async () => {
    await setPhone(ALI, '0532 111 22 33');
    expect(await phoneOf(ALI)).toBe('0532 111 22 33');
    expect(await phoneOf(BECCA)).toBeNull();
  });

  it('accepts the usual ways of writing a number and trims the ends', async () => {
    for (const ok of ['+90 (532) 111-22-33', '0532.111.22.33', '  0532/111 22 33  ', '5321112233']) {
      await setPhone(ALI, ok);
      expect(await phoneOf(ALI)).toBe(ok.trim());
    }
  });

  it('removes the number when it is emptied', async () => {
    await setPhone(ALI, '0532 111 22 33');
    await setPhone(ALI, '   ');
    expect(await phoneOf(ALI)).toBeNull();
    await setPhone(ALI, '0532 111 22 33');
    await setPhone(ALI, null);
    expect(await phoneOf(ALI)).toBeNull();
  });

  it.each([
    ['letters', 'ara beni', /Geçerli bir telefon numarası/],
    ['a link', 'https://kotu.example', /Geçerli bir telefon numarası/],
    ['too few digits', '12345', /Geçerli bir telefon numarası/],
    ['markup', '<b>0532 111 22 33</b>', /Geçerli bir telefon numarası/],
    ['too long', '0'.repeat(31), /en fazla 30/],
  ])('refuses %s and keeps the old number', async (_label, value, message) => {
    await setPhone(ALI, '0532 111 22 33');
    await expect(setPhone(ALI, value)).rejects.toThrow(message);
    expect(await phoneOf(ALI)).toBe('0532 111 22 33');
  });

  it('is what other members see in the member directory', async () => {
    await setPhone(ALI, '0532 999 88 77');
    const seen = await as(db, BECCA, async () => (await db.query<{ phone: string }>('select phone from public.member_directory where id = $1', [ALI])).rows[0]?.phone);
    expect(seen).toBe('0532 999 88 77');
  });

  it('works for a coach too (their own number), and never touches the name, role or status', async () => {
    await setPhone(ids.coach1, '0212 000 11 22');
    expect(await phoneOf(ids.coach1)).toBe('0212 000 11 22');
    const row = (await db.query<{ full_name: string; role: string; is_active: boolean }>('select full_name, role, is_active from public.profiles where id = $1', [ALI])).rows[0]!;
    expect(row).toEqual({ full_name: 'Ali Yılmaz', role: 'member', is_active: true });
  });

  it('is refused for signed-out visitors and deactivated accounts', async () => {
    await expect(as(db, 'anon', () => db.query(`select public.update_my_phone('0532 111 22 33')`))).rejects.toThrow(/permission denied/);
    for (const who of [ids.exMember, ids.exCoach]) await expect(setPhone(who, '0532 111 22 33')).rejects.toThrow(/Yetkisiz/);
    expect(await phoneOf(ids.exMember)).toBeNull();
  });

  it('is logged for the coaches as "the phone was edited", without the number itself', async () => {
    await db.query('delete from public.audit_log');
    await setPhone(ALI, '0532 555 44 33');
    const rows = (await db.query<{ action: string; actor_id: string; detail: unknown; summary: string }>(`select action, actor_id, detail, summary from public.audit_log where entity_id = $1`, [ALI])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'member.edit', actor_id: ALI, detail: { fields: ['phone'] } });
    expect(JSON.stringify(rows)).not.toContain('0532');
  });

  it('is the ONLY way for a member to write to profiles (no direct update of anything, not even their phone)', async () => {
    await expect(as(db, ALI, () => db.query(`update public.profiles set phone = '1' where id = $1`, [ALI]))).resolves.toMatchObject({ rowCount: 0 }); // policy: coaches only
    await expect(as(db, ALI, () => db.query(`update public.profiles set full_name = 'X' where id = $1`, [ALI]))).resolves.toMatchObject({ rowCount: 0 });
  });
});
