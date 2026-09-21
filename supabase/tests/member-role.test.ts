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

const roleOf = async (id: string) => (await db.query<{ role: string }>('select role from public.profiles where id = $1', [id])).rows[0]?.role;
const setRole = (who: Parameters<typeof as>[1], member: string, role: string) => as(db, who, () => db.query('select public.set_member_role($1, $2)', [member, role]));
const visibleProfiles = async (who: Parameters<typeof as>[1]) => (await as(db, who, () => db.query<{ n: number }>('select count(*)::int as n from public.profiles'))).rows[0]?.n;
const PERSON_COLUMNS = 'id, full_name, username, phone, is_active, must_change_password, created_at';

describe("set_member_role (a coach changes a member's role)", () => {
  it('promotes a member to coach, who then has coach powers at once', async () => {
    expect(await visibleProfiles(ids.member1)).toBe(1); // a member sees only their own row
    await setRole(ids.coach1, ids.member1, 'coach');
    expect(await roleOf(ids.member1)).toBe('coach');
    expect(await visibleProfiles(ids.member1)).toBeGreaterThan(1); // …a coach sees everybody
  });

  it('demotes a coach to member, who then loses coach powers at once', async () => {
    await setRole(ids.coach1, ids.member1, 'member');
    expect(await roleOf(ids.member1)).toBe('member');
    expect(await visibleProfiles(ids.member1)).toBe(1);
    expect((await as(db, ids.member1, () => db.query('select * from public.audit_log'))).rows).toEqual([]);
  });

  it('changes nothing but the role, and creates no second account', async () => {
    const before = (await db.query(`select ${PERSON_COLUMNS} from public.profiles where id = $1`, [ids.member2])).rows[0];
    const count = (await db.query<{ n: number }>('select count(*)::int as n from public.profiles')).rows[0]?.n;
    await setRole(ids.coach1, ids.member2, 'coach');
    await setRole(ids.coach1, ids.member2, 'member');
    const after = (await db.query(`select ${PERSON_COLUMNS} from public.profiles where id = $1`, [ids.member2])).rows[0];
    expect(after).toEqual(before);
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.profiles')).rows[0]?.n).toBe(count);
  });

  it('is refused for members (even for themselves)', async () => {
    await expect(setRole(ids.member1, ids.member2, 'coach')).rejects.toThrow(/Yetkisiz/);
    await expect(setRole(ids.member1, ids.member1, 'coach')).rejects.toThrow(/Yetkisiz/);
    expect(await roleOf(ids.member1)).toBe('member');
    expect(await roleOf(ids.member2)).toBe('member');
  });

  it('is refused for a deactivated coach and for anonymous callers', async () => {
    await expect(setRole(ids.exCoach, ids.member2, 'coach')).rejects.toThrow(/Yetkisiz/);
    await expect(as(db, 'anon', () => db.query('select public.set_member_role($1, $2)', [ids.member2, 'coach']))).rejects.toThrow(/permission denied/);
    expect(await roleOf(ids.member2)).toBe('member');
  });

  it('never lets a coach change their own role', async () => {
    await expect(setRole(ids.coach1, ids.coach1, 'member')).rejects.toThrow(/Kendi rolünüzü/);
    expect(await roleOf(ids.coach1)).toBe('coach');
  });

  it('refuses a deactivated account and an unknown one', async () => {
    await expect(setRole(ids.coach1, ids.exMember, 'coach')).rejects.toThrow(/Devre dışı/);
    await expect(setRole(ids.coach1, '00000000-0000-4000-8000-0000000000ff', 'coach')).rejects.toThrow(/bulunamadı/);
  });

  it('refuses a made-up role', async () => {
    await expect(setRole(ids.coach1, ids.member2, 'admin')).rejects.toThrow();
    expect(await roleOf(ids.member2)).toBe('member');
  });

  it('does nothing, and logs nothing, when the role is already the one asked for', async () => {
    const count = async () => (await db.query<{ n: number }>("select count(*)::int as n from public.audit_log where action = 'member.role_change'")).rows[0]?.n;
    const before = await count();
    await setRole(ids.coach1, ids.member2, 'member');
    expect(await count()).toBe(before);
  });

  it('writes each change to the audit log: who, whom, from → to', async () => {
    await setRole(ids.coach1, ids.member2, 'coach');
    const entry = (
      await db.query<{ actor_id: string; category: string; summary: string; detail: { from: string; to: string } }>(
        "select actor_id, category, summary, detail from public.audit_log where action = 'member.role_change' and entity_id = $1 order by id desc limit 1",
        [ids.member2],
      )
    ).rows[0];
    expect(entry).toMatchObject({ actor_id: ids.coach1, category: 'member', detail: { from: 'member', to: 'coach' } });
    expect(entry?.summary).toMatch(/Rol değiştirildi: .* → antrenör/);
  });

  it('keeps the last-coach guard as the backstop', async () => {
    // coach1, coach2 and member2 (promoted above) are the active coaches: step the other two down, then try to demote the last one
    await as(db, 'service', () => db.query(`update public.profiles set role = 'member' where id in ($1, $2)`, [ids.member2, ids.coach2]));
    await expect(as(db, 'service', () => db.query(`update public.profiles set role = 'member' where id = $1`, [ids.coach1]))).rejects.toThrow(/Son aktif antrenör/);
  });

  it("no other table keeps a copy of anybody's role, so history and records are untouched by a change", async () => {
    const copies = (await db.query("select table_name from information_schema.columns where table_schema = 'public' and column_name = 'role' and table_name <> 'profiles'")).rows;
    expect(copies).toEqual([]);
  });
});
