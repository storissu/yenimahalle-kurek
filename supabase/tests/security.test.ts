import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createDb, ids, seedPeople } from './harness';

// SECURITY GUARD TESTS — a reviewed snapshot of who may do what in the `public` schema.
//
// The app's real protection is the database: RLS on every table, column-level grants, and definer functions
// as the only write path. These tests read the live catalog after ALL migrations have run and compare it to
// the snapshot below. If a migration adds a table, column, grant or function, one of these tests fails until
// the snapshot is updated *on purpose* — which is the moment to ask "should app users be able to do this?".
//
// (The harness mirrors Supabase's default privileges, which grant everything to anon/authenticated/service_role,
// so a missing REVOKE in a migration shows up here exactly as it would in production.)

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  await seedPeople(db);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const rows = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

/** Table-level privileges of `authenticated` (member/coach sessions). Column-level ones are checked separately. */
const AUTHENTICATED_TABLE_PRIVILEGES: Record<string, string> = {
  attendance_records: 'SELECT',
  audit_log: 'SELECT',
  boats: 'SELECT',
  club_settings: 'SELECT',
  member_directory: 'SELECT',
  notification_outbox: 'SELECT',
  profiles: 'SELECT',
  program_assignments: 'SELECT',
  program_crew: 'SELECT',
  push_subscriptions: 'DELETE,SELECT',
  training_programs: 'SELECT',
  training_responses: 'SELECT',
  trainings: 'SELECT',
  weather_snapshots: 'SELECT',
};

/** Column-level INSERT / UPDATE / SELECT of `authenticated`. Anything not listed is server-only. */
const AUTHENTICATED_COLUMN_PRIVILEGES: Record<string, Record<string, string>> = {
  attendance_records: {
    SELECT: 'ends_at,member_id,note,recorded_at,recorded_by,slot_index,starts_at,status,training_id',
  },
  audit_log: {
    SELECT: 'action,actor_id,actor_name,at,category,detail,entity,entity_id,id,summary,tx',
  },
  boats: {
    INSERT: 'capacity,is_active,name,requires_full_crew,sort_order',
    SELECT: 'capacity,created_at,id,is_active,name,requires_full_crew,sort_order,updated_at',
    UPDATE: 'capacity,is_active,name,requires_full_crew,sort_order',
  },
  club_settings: {
    SELECT: 'club_name,default_rsvp_lead_hours,id,reminder_lead_hours,site_lat,site_lng,site_name,timezone,updated_at,wave_warn_m,wind_gust_warn_kmh',
    UPDATE: 'default_rsvp_lead_hours,reminder_lead_hours,site_lat,site_lng,site_name,wave_warn_m,wind_gust_warn_kmh',
  },
  member_directory: {
    SELECT: 'full_name,id,phone',
  },
  notification_outbox: {
    SELECT: 'body,created_at,dedupe_key,id,push_attempts,push_done_at,push_error,read_at,title,training_id,type,url,user_id',
    UPDATE: 'read_at',
  },
  profiles: {
    SELECT: 'created_at,deleted_at,full_name,id,is_active,must_change_password,phone,role,updated_at,username',
    UPDATE: 'full_name,phone',
  },
  program_assignments: {
    SELECT: 'boat_id,ends_at,id,notes,slot_index,starts_at,training_id',
  },
  program_crew: {
    SELECT: 'assignment_id,member_id,seat,slot_index,training_id',
  },
  push_subscriptions: {
    SELECT: 'auth,created_at,endpoint,id,last_success_at,p256dh,user_agent,user_id',
  },
  training_programs: {
    SELECT: 'created_at,published_at,published_by,status,training_id,training_notes,updated_at,version,weather_note',
  },
  training_responses: {
    SELECT: 'member_id,note,responded_at,response,set_by_coach,training_id',
  },
  trainings: {
    INSERT: 'notes,rsvp_deadline,rsvp_deadline_rule,starts_at,title',
    SELECT: 'cancel_reason,created_at,created_by,deadline_reminder_sent_at,deadline_summary_sent_at,ends_at,id,notes,rsvp_deadline,rsvp_deadline_rule,slot_count,starts_at,status,title,updated_at',
    UPDATE: 'notes,rsvp_deadline,rsvp_deadline_rule,starts_at,title',
  },
  weather_snapshots: {
    SELECT: 'apparent_c,cloud_pct,fetched_at,forecast_for,gust_kmh,precip_mm,precip_prob,slot_index,source,temperature_c,training_id,wave_dir_deg,wave_height_m,wave_period_s,weather_code,wind_dir_deg,wind_kmh',
  },
};

/** Functions app users may call (everything else is internal: triggers, helpers, cron jobs, the audit writer). */
const CALLABLE_BY_AUTHENTICATED = ['update_my_phone', 'member_training_history', 'shared_boat_history', 'attendance_export', 'cancel_training', 'coach_month_table', 'coach_set_rsvp', 'complete_password_change', 'is_active_member', 'is_active_user', 'is_coach', 'monthly_leaderboard', 'my_month_stats', 'ping', 'program_is_published', 'register_push_subscription', 'save_attendance', 'save_program', 'server_now', 'set_rsvp', 'training_attendance_counts'];
const CALLABLE_BY_ANON = ['ping']; // keep-alive: returns the server time, nothing else

describe('anonymous visitors', () => {
  it('have no privileges on any table, view or column', async () => {
    const tables = await rows(`select table_name, privilege_type from information_schema.table_privileges where table_schema = 'public' and grantee = 'anon'`);
    const columns = await rows(`select table_name, column_name from information_schema.column_privileges where table_schema = 'public' and grantee = 'anon'`);
    expect(tables).toEqual([]);
    expect(columns).toEqual([]);
  });

  it('can call only the keep-alive ping()', async () => {
    const callable = await rows<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`,
    );
    expect(callable.map((r) => r.name)).toEqual(CALLABLE_BY_ANON);
  });
});

describe('row level security', () => {
  it('is enabled on every table and every table has at least one policy', async () => {
    const tables = await rows<{ name: string; rls: boolean; policies: number }>(
      `select c.relname as name, c.relrowsecurity as rls, (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    );
    expect(tables.length).toBeGreaterThan(10);
    expect(tables.filter((t) => !t.rls).map((t) => t.name)).toEqual([]);
    expect(tables.filter((t) => t.policies === 0).map((t) => t.name)).toEqual([]);
  });

  it('the only view is member_directory (it filters by itself: signed-in, active members only)', async () => {
    const views = await rows<{ name: string }>(`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'`);
    expect(views.map((v) => v.name)).toEqual(['member_directory']);
  });
});

describe('what signed-in users may do to the tables', () => {
  it('table-level privileges match the reviewed snapshot: read-only, nothing writable directly', async () => {
    const found = await rows<{ table_name: string; privs: string }>(
      `select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs from information_schema.table_privileges
        where table_schema = 'public' and grantee = 'authenticated' group by 1 order by 1`,
    );
    expect(Object.fromEntries(found.map((r) => [r.table_name, r.privs]))).toEqual(AUTHENTICATED_TABLE_PRIVILEGES);
  });

  it('column-level privileges match the reviewed snapshot (no client can write slot_count, status, role, is_active, audit rows …)', async () => {
    const found = await rows<{ table_name: string; privilege_type: string; cols: string }>(
      `select table_name, privilege_type, string_agg(column_name, ',' order by column_name) as cols from information_schema.column_privileges
        where table_schema = 'public' and grantee = 'authenticated' group by 1, 2 order by 1, 2`,
    );
    const actual: Record<string, Record<string, string>> = {};
    for (const r of found) (actual[r.table_name] ??= {})[r.privilege_type] = r.cols;
    expect(actual).toEqual(AUTHENTICATED_COLUMN_PRIVILEGES);
  });

  it('writes to server-owned tables and columns are refused at the door (not only by policies)', async () => {
    const attempts: Array<[string, string]> = [
      [ids.member1, `update public.profiles set role = 'coach' where id = '${ids.member1}'`],
      [ids.member1, `update public.profiles set is_active = true where id = '${ids.member1}'`],
      [ids.coach1, `update public.trainings set slot_count = 4`],
      [ids.coach1, `update public.trainings set status = 'completed'`],
      [ids.coach1, `insert into public.training_responses (training_id, member_id, response) values (gen_random_uuid(), '${ids.member1}', 'attending')`],
      [ids.coach1, `insert into public.attendance_records (training_id, slot_index, member_id, status, recorded_by) values (gen_random_uuid(), 0, '${ids.member1}', 'present', '${ids.coach1}')`],
      [ids.coach1, `insert into public.training_programs (training_id, status) values (gen_random_uuid(), 'published')`],
      [ids.coach1, `insert into public.weather_snapshots (training_id, slot_index, source, forecast_for) values (gen_random_uuid(), 0, 'x', now())`],
      [ids.coach1, `insert into public.notification_outbox (user_id, type, title, body, url, dedupe_key) values ('${ids.member1}', 'training_new', 't', 'b', '/x', 'k')`],
      [ids.coach1, `insert into public.audit_log (category, action, entity, summary) values ('training', 'x', 'x', 'y')`],
      [ids.coach1, `delete from public.trainings`],
      [ids.coach1, `delete from public.profiles`],
      [ids.member1, `update public.notification_outbox set title = 'x'`],
    ];
    for (const [who, sql] of attempts) {
      await expect(as(db, who, () => db.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });
});

describe('functions', () => {
  it('app users can call exactly the reviewed list; everything internal is closed', async () => {
    const callable = await rows<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`,
    );
    expect(callable.map((r) => r.name)).toEqual([...CALLABLE_BY_AUTHENTICATED].sort());
  });

  it('every security-definer function pins its search_path (no schema-shadowing tricks)', async () => {
    const loose = await rows<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig::text ilike '%search_path=%', false) order by 1`,
    );
    expect(loose.map((r) => r.name)).toEqual([]);
  });

  it('coach-only functions refuse members even though members may call them', async () => {
    for (const sql of [
      `select public.cancel_training(gen_random_uuid(), 'neden yok')`,
      `select public.save_program(gen_random_uuid(), '{}'::jsonb, false)`,
      `select public.save_attendance(gen_random_uuid(), '[]'::jsonb, false)`,
      `select public.coach_set_rsvp(gen_random_uuid(), '${ids.member2}', 'attending')`,
      `select * from public.coach_month_table(current_date)`,
      `select * from public.attendance_export(current_date)`,
      `select * from public.training_attendance_counts(array[gen_random_uuid()])`,
    ]) {
      await expect(as(db, ids.member1, () => db.query(sql)), sql).rejects.toThrow(/Yetkisiz/);
    }
  });

  it('deactivated accounts see and may do nothing', async () => {
    for (const who of [ids.exMember, ids.exCoach]) {
      await expect(as(db, who, () => db.query(`select * from public.monthly_leaderboard(current_date)`))).rejects.toThrow(/Yetkisiz/);
      expect((await as(db, who, () => db.query('select id from public.trainings'))).rows).toHaveLength(0);
      expect((await as(db, who, () => db.query('select id from public.member_directory'))).rows).toHaveLength(0);
    }
  });
});
