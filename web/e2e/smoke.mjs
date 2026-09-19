// Browser smoke test: a production build served by `vite preview` + a MOCKED Supabase backend, driven at phone size.
// It checks the whole Phase-1 UI flow (login, role routing, forced password change, member management,
// PWA install basics, offline shell) without needing a real backend.
//
//   npm run e2e            (expects the app built with dummy env and served on BASE_URL; see docs/RUNBOOK.md)
//   BASE_URL=http://localhost:4173  BROWSER_CHANNEL=msedge|chrome|  (empty = Playwright's bundled Chromium)
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const CHANNEL = process.env.BROWSER_CHANNEL || undefined;
const SUPA = 'https://test.supabase.co';
const OUT = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

const people = {
  coach: { id: '11111111-1111-4111-8111-111111111111', full_name: 'Ayşe Yılmaz', username: 'ayse', role: 'coach', phone: null, is_active: true, must_change_password: false },
  member: { id: '22222222-2222-4222-8222-222222222222', full_name: 'Ali Kaya', username: 'ali', role: 'member', phone: null, is_active: true, must_change_password: true },
};
const roster = [
  people.coach,
  people.member,
  { id: '33333333-3333-4333-8333-333333333333', full_name: 'Çağla Şahin', username: 'cagla', role: 'member', phone: null, is_active: true, must_change_password: false },
  { id: '44444444-4444-4444-8444-444444444444', full_name: 'Eski Üye', username: 'eski', role: 'member', phone: null, is_active: false, must_change_password: false },
];
const state = { current: null, log: [], offline: false };

// --- mocked Phase-2 backend: trainings, answers, boats, server clock -------------------------------
const HOUR = 3_600_000;
const db = {
  trainings: [],
  responses: [], // { training_id, member_id, response, note, responded_at, set_by_coach }
  boats: [
    { id: 'boat-1', name: 'Mavi', capacity: 2, is_active: true, sort_order: 1, requires_full_crew: false },
    { id: 'boat-2', name: 'Turuncu', capacity: 2, is_active: true, sort_order: 2, requires_full_crew: false },
    { id: 'boat-3', name: 'C4X', capacity: 4, is_active: true, sort_order: 3, requires_full_crew: true },
  ],
  serverSkewMs: 0, // server clock minus phone clock
  rejectRsvp: null, // when set, set_rsvp answers with this business-rule error
  seq: 1,
};
const serverNowMs = () => Date.now() + db.serverSkewMs;
const iso = (ms) => new Date(ms).toISOString();
const makeTraining = (over) => ({
  id: `tr-${db.seq++}`,
  title: null,
  slot_count: 1,
  status: 'scheduled',
  cancel_reason: null,
  notes: null,
  deadline_reminder_sent_at: null,
  created_by: people.coach.id,
  created_at: iso(Date.now()),
  updated_at: iso(Date.now()),
  ...over,
});
// Who is calling? Read the user id out of the bearer token (two people can be signed in at once).
const callerOf = (req) => {
  try {
    const token = (req.headers()['authorization'] ?? '').replace(/^Bearer /i, '');
    const sub = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
    return Object.values(people).find((p) => p.id === sub) ?? null;
  } catch {
    return null;
  }
};
db.programs = {}; // trainingId -> { program, assignments, crew }
db.attendance = []; // { training_id, slot_index, member_id, status, note, recorded_by, recorded_at }
db.attendanceSaves = []; // what save_attendance received
db.saves = []; // payloads received by save_program
// ---- Phase 5 ----
db.settings = { id: true, club_name: 'Kulüp', timezone: 'Europe/Istanbul', site_name: 'Ereğli', site_lat: 41.285318, site_lng: 31.407823, default_rsvp_lead_hours: 12, reminder_lead_hours: 3, wind_gust_warn_kmh: null, wave_warn_m: null, updated_at: '' };
db.notifications = []; // notification_outbox rows (user_id decides whose inbox)
db.weather = {}; // trainingId -> weather_snapshots rows
db.weatherRefreshes = []; // training ids the refresh-weather function was called for
const weatherRow = (trainingId, slot, startMs, over = {}) => ({
  training_id: trainingId,
  slot_index: slot,
  fetched_at: iso(Date.now()),
  source: 'open-meteo',
  forecast_for: iso(startMs + slot * 3_600_000),
  temperature_c: 21.4,
  apparent_c: 20,
  wind_kmh: 14.2,
  gust_kmh: 24,
  wind_dir_deg: 315,
  precip_prob: 10,
  precip_mm: 0,
  weather_code: 2,
  cloud_pct: 40,
  wave_height_m: 0.6,
  wave_period_s: 4,
  wave_dir_deg: 300,
  ...over,
});
const dbError = (route, code, message, status = 400) => json(route, { code, details: null, hint: null, message }, status);
const istanbulDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(ms));
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' };
const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });

const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });

async function newPage(scheme = 'light') {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    colorScheme: scheme,
    serviceWorkers: 'block',
  });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|Service worker registration failed/.test(m.text())) problems.push('console: ' + m.text());
  });
  await ctx.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (state.offline) return route.abort('internetdisconnected'); // a dropped connection: the request never gets an answer
    state.log.push(`${req.method()} ${url.pathname}${url.search}`);

    if (url.pathname === '/auth/v1/token') {
      const body = JSON.parse(req.postData() ?? '{}');
      const username = String(body.email ?? '').split('@')[0];
      const person = Object.values(people).find((p) => p.username === username);
      if (!person || body.password === 'Wrong123') {
        return json(route, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      }
      state.current = person;
      return json(route, {
        access_token: jwt(person.id),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'refresh-' + person.id,
        user: { id: person.id, aud: 'authenticated', role: 'authenticated', email: `${person.username}@kulup.invalid`, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
      });
    }
    if (url.pathname === '/auth/v1/user') {
      if (req.method() === 'PUT') return json(route, { id: state.current?.id, email: 'x@kulup.invalid' });
      return json(route, { id: state.current?.id });
    }
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === '/rest/v1/profiles') {
      const id = url.searchParams.get('id');
      if (id) return json(route, roster.filter((p) => `eq.${p.id}` === id).map((p) => ({ ...p, created_at: '', updated_at: '' })));
      return json(route, roster.map((p) => ({ ...p, created_at: '', updated_at: '' })));
    }
    if (url.pathname === '/rest/v1/rpc/complete_password_change') {
      people.member.must_change_password = false;
      return route.fulfill({ status: 204, headers: cors });
    }
    if (url.pathname === '/rest/v1/push_subscriptions') return json(route, []);
    if (url.pathname === '/functions/v1/admin-create-member') {
      const body = JSON.parse(req.postData() ?? '{}');
      if (body.username === 'ali') return json(route, { error: 'Bu kullanıcı adı zaten kullanılıyor' }, 409);
      return json(route, { id: 'new-id', username: body.username, full_name: body.full_name, role: body.role, password: 'Kx7mQp9Ret' }, 201);
    }
    if (url.pathname === '/functions/v1/admin-reset-password') return json(route, { username: 'cagla', password: 'Zt4nHw6Vab' });
    if (url.pathname === '/functions/v1/admin-set-active') return json(route, { ok: true, is_active: false });
    // ---- Phase 2 ----
    const path = url.pathname;
    const body = () => JSON.parse(req.postData() || '{}');
    const wantsObject = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    const eqParam = (name) => {
      const v = url.searchParams.get(name);
      return v?.startsWith('eq.') ? v.slice(3) : null;
    };

    if (path === '/rest/v1/rpc/server_now') return json(route, iso(serverNowMs()));
    if (path === '/rest/v1/club_settings') {
      if (req.method() === 'PATCH') {
        if (callerOf(req)?.role !== 'coach') return dbError(route, '42501', 'permission denied for table club_settings');
        Object.assign(db.settings, body());
        db.settingsSaves = [...(db.settingsSaves ?? []), body()];
        return route.fulfill({ status: 204, headers: cors });
      }
      return json(route, db.settings);
    }

    // ---- Phase 5: inbox (own rows only, like the RLS policy), weather, refresh function ----
    if (path === '/rest/v1/notification_outbox') {
      const me = callerOf(req)?.id;
      const mine = db.notifications.filter((n) => n.user_id === me);
      if (req.method() === 'HEAD') {
        const unread = mine.filter((n) => n.read_at === null).length;
        return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `*/${unread}` } });
      }
      if (req.method() === 'PATCH') {
        const raw = url.searchParams.get('id');
        const ids = raw?.startsWith('in.(') ? raw.slice(4, -1).split(',') : null;
        for (const n of mine) if (n.read_at === null && (!ids || ids.includes(n.id))) n.read_at = iso(serverNowMs());
        return route.fulfill({ status: 204, headers: cors });
      }
      return json(route, [...mine].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    }
    if (path === '/rest/v1/audit_log') {
      if (callerOf(req)?.role !== 'coach') return json(route, []);
      const category = url.searchParams.get('category');
      const limit = Number(url.searchParams.get('limit') ?? 50);
      return json(route, (db.audit ?? []).filter((e) => !category || category === `eq.${e.category}`).sort((x, y) => y.at.localeCompare(x.at) || y.id - x.id).slice(0, limit));
    }
    if (path === '/rest/v1/weather_snapshots') return json(route, db.weather[eqParam('training_id')] ?? []);
    if (path === '/functions/v1/refresh-weather') {
      const b = body();
      if (callerOf(req)?.role !== 'coach') return json(route, { error: 'Yetkiniz yok' }, 403);
      db.weatherRefreshes.push(b.training_id);
      const t = db.trainings.find((x) => x.id === b.training_id);
      if (t && !db.weather[t.id]) db.weather[t.id] = Array.from({ length: t.slot_count }, (_, i) => weatherRow(t.id, i, Date.parse(t.starts_at)));
      return json(route, { updated: t?.slot_count ?? 0 });
    }

    if (path === '/rest/v1/trainings') {
      if (req.method() === 'GET') {
        const id = eqParam('id');
        const rawId = url.searchParams.get('id');
        const idList = rawId?.startsWith('in.(') ? rawId.slice(4, -1).split(',') : null;
        const bounds = url.searchParams.getAll('starts_at');
        const lo = bounds.find((b) => b.startsWith('gte.'))?.slice(4);
        const hi = bounds.find((b) => b.startsWith('lt.'))?.slice(3);
        return json(route, db.trainings.filter((t) => (!id || t.id === id) && (!idList || idList.includes(t.id)) && (!lo || t.starts_at >= lo) && (!hi || t.starts_at < hi)));
      }
      if (req.method() === 'POST') {
        const t = makeTraining({ slot_count: 0, ...body() }); // the coach no longer picks a length: 0 = not planned yet
        db.trainings.push(t);
        return json(route, wantsObject ? t : [t], 201);
      }
      if (req.method() === 'PATCH') {
        const t = db.trainings.find((x) => x.id === eqParam('id'));
        if (!t || t.status !== 'scheduled') return dbError(route, 'PGRST116', 'no rows', 406);
        Object.assign(t, body(), { updated_at: iso(Date.now()) });
        return json(route, wantsObject ? t : [t]);
      }
    }
    if (path === '/rest/v1/rpc/cancel_training') {
      const { p_training_id, p_reason } = body();
      const t = db.trainings.find((x) => x.id === p_training_id && x.status === 'scheduled');
      if (!t) return dbError(route, 'P0001', 'Antrenman bulunamadı veya zaten iptal edilmiş / tamamlanmış');
      if ((p_reason ?? '').trim().length < 3) return dbError(route, 'P0001', 'İptal nedeni 3–200 karakter olmalı');
      t.status = 'cancelled';
      t.cancel_reason = p_reason.trim();
      return route.fulfill({ status: 204, headers: cors });
    }
    if (path === '/rest/v1/training_responses') {
      const memberId = eqParam('member_id');
      const trainingId = eqParam('training_id');
      const inList = url.searchParams.get('training_id')?.startsWith('in.(') ? url.searchParams.get('training_id').slice(4, -1).split(',') : null;
      return json(
        route,
        db.responses.filter((r) => (!memberId || r.member_id === memberId) && (!trainingId || r.training_id === trainingId) && (!inList || inList.includes(r.training_id))),
      );
    }
    if (path === '/rest/v1/rpc/set_rsvp' || path === '/rest/v1/rpc/coach_set_rsvp') {
      const b = body();
      const t = db.trainings.find((x) => x.id === b.p_training_id);
      if (!t) return dbError(route, 'P0001', 'Antrenman bulunamadı');
      const byCoach = path.endsWith('coach_set_rsvp');
      if (t.status !== 'scheduled') return dbError(route, 'P0001', 'Bu antrenman iptal edildi veya tamamlandı');
      if (!byCoach && db.rejectRsvp) return dbError(route, 'P0001', db.rejectRsvp);
      if (!byCoach && db.programs[t.id]?.program.status === 'published') return dbError(route, 'P0001', 'Program yayınlandığı için yanıtlar kilitlendi. Değişiklik için antrenörünüzle görüşün.');
      if (!byCoach && serverNowMs() >= Date.parse(t.rsvp_deadline)) return dbError(route, 'P0001', 'Yanıt süresi doldu. Değişiklik için antrenörünüzle görüşün.');
      const member_id = byCoach ? b.p_member_id : callerOf(req)?.id;
      const row = { training_id: t.id, member_id, response: b.p_response, note: (b.p_note ?? '').trim() || null, responded_at: iso(serverNowMs()), set_by_coach: byCoach };
      db.responses = [...db.responses.filter((r) => !(r.training_id === t.id && r.member_id === member_id)), row];
      return route.fulfill({ status: 204, headers: cors });
    }

    // ---- Phase 3: program (drafts are visible to coaches only, like the RLS policies) ----
    const visibleProgram = (trainingId) => {
      const entry = db.programs[trainingId];
      if (!entry) return null;
      return callerOf(req)?.role === 'coach' || entry.program.status === 'published' ? entry : null;
    };
    if (path === '/rest/v1/member_directory') {
      return json(route, roster.filter((p) => p.role === 'member' && p.is_active).map((p) => ({ id: p.id, full_name: p.full_name, phone: p.phone })));
    }
    if (path === '/rest/v1/training_programs') {
      if (!eqParam('training_id')) {
        return json(route, Object.entries(db.programs).filter(([, e]) => e.program.status === 'published').map(([id]) => ({ training_id: id })));
      }
      return json(route, [visibleProgram(eqParam('training_id'))?.program].filter(Boolean));
    }
    if (path === '/rest/v1/program_assignments') return json(route, visibleProgram(eqParam('training_id'))?.assignments ?? []);
    if (path === '/rest/v1/program_crew') return json(route, visibleProgram(eqParam('training_id'))?.crew ?? []);
    if (path === '/rest/v1/rpc/save_program') {
      if (callerOf(req)?.role !== 'coach') return dbError(route, '42501', 'permission denied for function save_program');
      const b = body();
      const t = db.trainings.find((x) => x.id === b.p_training_id);
      if (!t) return dbError(route, 'P0001', 'Antrenman bulunamadı');
      const assignments = [];
      const crew = [];
      const seen = new Set();
      for (const a of b.p_payload.assignments) {
        if (a.crew.length === 0) continue;
        const boat = db.boats.find((x) => x.id === a.boat_id);
        if (b.p_publish && boat.requires_full_crew && a.crew.length !== boat.capacity) {
          return dbError(route, 'P0001', `${boat.name} teknesinde tam ${boat.capacity} kişi olmalı (${a.slot_index + 1}. seansta ${a.crew.length} kişi var). Eksik veya fazla ekiple yayınlanamaz.`);
        }
        if (a.crew.length > boat.capacity) return dbError(route, 'P0001', `${boat.name} teknesine en fazla ${boat.capacity} kişi atanabilir`);
        const id = `as-${db.seq++}`;
        assignments.push({ id, training_id: t.id, slot_index: a.slot_index, boat_id: a.boat_id, notes: a.notes ?? null });
        for (const [i, memberId] of a.crew.entries()) {
          const key = `${a.slot_index}:${memberId}`;
          if (seen.has(key)) return dbError(route, 'P0001', 'Aynı seansta iki teknede olamaz');
          seen.add(key);
          crew.push({ assignment_id: id, training_id: t.id, slot_index: a.slot_index, member_id: memberId, seat: i + 1 });
        }
      }
      if (b.p_publish && assignments.length === 0) return dbError(route, 'P0001', 'Yayınlamak için en az bir tekneye ekip atayın');
      const previous = db.programs[t.id]?.program;
      // like the database: the training is as long as the last session that has a crew
      if (assignments.length > 0) t.slot_count = Math.max(...assignments.map((a) => a.slot_index)) + 1;
      db.saves.push(b.p_payload);
      db.saveNotify = [...(db.saveNotify ?? []), b.p_notify];
      db.programs[t.id] = {
        program: {
          training_id: t.id,
          status: b.p_publish ? 'published' : 'draft',
          version: (previous?.version ?? 0) + (b.p_publish ? 1 : 0),
          weather_note: b.p_payload.weather_note,
          training_notes: b.p_payload.training_notes,
          published_at: b.p_publish ? iso(Date.now()) : null,
          published_by: b.p_publish ? people.coach.id : null,
          created_at: '',
          updated_at: '',
        },
        assignments,
        crew,
      };
      return route.fulfill({ status: 204, headers: cors });
    }

    // ---- Phase 4: attendance + monthly statistics (mirrors the SQL rules) ----
    const caller = callerOf(req);
    const monthOfTraining = (t) => istanbulDate(Date.parse(t.starts_at)).slice(0, 7);
    const monthKeyParam = () => String(body().p_month ?? '').slice(0, 7);
    const monthRows = (monthKey) => {
      const rows = roster.filter((p) => p.role === 'member' && p.is_active).map((p) => ({ member_id: p.id, full_name: p.full_name, sessions: 0, training_days: 0, rank: null }));
      const days = new Map();
      for (const a of db.attendance) {
        if (a.status !== 'present') continue;
        const t = db.trainings.find((x) => x.id === a.training_id);
        const row = rows.find((r) => r.member_id === a.member_id);
        if (!t || !row || t.status !== 'completed' || monthOfTraining(t) !== monthKey) continue;
        row.sessions += 1;
        days.set(row.member_id, (days.get(row.member_id) ?? new Set()).add(a.training_id));
      }
      rows.forEach((r) => (r.training_days = days.get(r.member_id)?.size ?? 0));
      const ranked = rows.filter((r) => r.sessions > 0).sort((a, b) => b.sessions - a.sessions);
      ranked.forEach((r, i) => (r.rank = i > 0 && ranked[i - 1].sessions === r.sessions ? ranked[i - 1].rank : i + 1));
      return rows;
    };
    if (path === '/rest/v1/attendance_records') {
      const memberId = eqParam('member_id');
      const trainingId = eqParam('training_id');
      return json(
        route,
        db.attendance.filter((a) => (caller?.role === 'coach' || a.member_id === caller?.id) && (!memberId || a.member_id === memberId) && (!trainingId || a.training_id === trainingId)),
      );
    }
    if (path === '/rest/v1/rpc/save_attendance') {
      if (caller?.role !== 'coach') return dbError(route, '42501', 'permission denied');
      const b = body();
      const t = db.trainings.find((x) => x.id === b.p_training_id);
      if (!t) return dbError(route, 'P0001', 'Antrenman bulunamadı');
      if (t.status === 'cancelled') return dbError(route, 'P0001', 'İptal edilen antrenmanın yoklaması alınamaz');
      if (serverNowMs() < Date.parse(t.starts_at)) return dbError(route, 'P0001', 'Yoklama antrenman başladıktan sonra alınabilir');
      if ((b.p_complete || t.status === 'completed') && b.p_rows.length === 0) return dbError(route, 'P0001', 'Yoklamayı tamamlamak için en az bir kayıt girin');
      // like the database: recording more sessions than planned extends the training
      const needed = b.p_rows.length ? Math.max(...b.p_rows.map((r) => r.slot_index)) + 1 : 0;
      if (needed > t.slot_count) t.slot_count = needed;
      db.attendance = db.attendance.filter((a) => a.training_id !== t.id);
      for (const r of b.p_rows) db.attendance.push({ training_id: t.id, slot_index: r.slot_index, member_id: r.member_id, status: r.status, note: r.note ?? null, recorded_by: caller.id, recorded_at: iso(Date.now()) });
      db.attendanceSaves.push({ trainingId: t.id, complete: Boolean(b.p_complete), rows: b.p_rows });
      if (b.p_complete && t.status === 'scheduled') t.status = 'completed';
      return route.fulfill({ status: 204, headers: cors });
    }
    // every active member, ranked ones first; members without a session come last with rank null (like the database)
    if (path === '/rest/v1/rpc/monthly_leaderboard') return json(route, monthRows(monthKeyParam()).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.full_name.localeCompare(b.full_name, 'tr')));
    if (path === '/rest/v1/rpc/shared_boat_history') {
      const other = roster.find((r) => r.id === body().p_member);
      if (!caller?.is_active) return dbError(route, 'P0001', 'Yetkisiz');
      if (!other || other.role !== 'member' || !other.is_active) return dbError(route, 'P0001', 'Üye bulunamadı');
      if (other.id === caller.id) return json(route, []);
      const rows = [];
      for (const [trainingId, entry] of Object.entries(db.programs)) {
        const t = db.trainings.find((x) => x.id === trainingId);
        if (!t || t.status !== 'completed' || entry.program.status !== 'published') continue;
        for (const a of entry.assignments) {
          const crew = entry.crew.filter((c) => c.assignment_id === a.id).map((c) => c.member_id);
          const present = (m) => db.attendance.some((x) => x.training_id === trainingId && x.slot_index === a.slot_index && x.member_id === m && x.status === 'present');
          if (crew.includes(caller.id) && crew.includes(other.id) && present(caller.id) && present(other.id)) {
            rows.push({ training_id: trainingId, starts_at: t.starts_at, title: t.title, slot_index: a.slot_index, boat_id: a.boat_id, boat_name: db.boats.find((b) => b.id === a.boat_id)?.name ?? '?' });
          }
        }
      }
      return json(route, rows.sort((a, b) => b.starts_at.localeCompare(a.starts_at) || a.slot_index - b.slot_index));
    }
    if (path === '/rest/v1/rpc/my_month_stats') {
      const rows = monthRows(monthKeyParam());
      const me = rows.find((r) => r.member_id === caller?.id);
      return json(route, [{ sessions: me?.sessions ?? 0, training_days: me?.training_days ?? 0, rank: me?.rank ?? null, participants: rows.filter((r) => r.sessions > 0).length }]);
    }
    if (path === '/rest/v1/rpc/coach_month_table') {
      if (caller?.role !== 'coach') return dbError(route, 'P0001', 'Yetkisiz');
      return json(route, monthRows(monthKeyParam()).sort((a, b) => b.sessions - a.sessions || a.full_name.localeCompare(b.full_name, 'tr')));
    }
    if (path === '/rest/v1/rpc/attendance_export') {
      if (caller?.role !== 'coach') return dbError(route, 'P0001', 'Yetkisiz');
      const monthKey = monthKeyParam();
      const out = db.attendance
        .map((a) => ({ a, t: db.trainings.find((x) => x.id === a.training_id), p: roster.find((x) => x.id === a.member_id) }))
        .filter(({ t }) => t && t.status === 'completed' && monthOfTraining(t) === monthKey)
        .map(({ a, t, p }) => ({ training_id: t.id, starts_at: t.starts_at, slot_index: a.slot_index, member_id: a.member_id, full_name: p.full_name, status: a.status, note: a.note }))
        .sort((x, y) => x.starts_at.localeCompare(y.starts_at) || x.slot_index - y.slot_index || x.full_name.localeCompare(y.full_name, 'tr'));
      return json(route, out);
    }
    if (path === '/rest/v1/rpc/training_attendance_counts') {
      if (caller?.role !== 'coach') return dbError(route, 'P0001', 'Yetkisiz');
      const counts = body().p_training_ids.map((id) => {
        const present = db.attendance.filter((a) => a.training_id === id && a.status === 'present');
        return present.length ? { training_id: id, sessions: present.length, members: new Set(present.map((a) => a.member_id)).size } : null;
      });
      return json(route, counts.filter(Boolean));
    }

    if (path === '/rest/v1/boats') {
      if (req.method() === 'GET') return json(route, [...db.boats].sort((a, b) => a.sort_order - b.sort_order));
      if (req.method() === 'POST') {
        const b = body();
        if (db.boats.some((x) => x.name === b.name)) return dbError(route, '23505', 'duplicate key value violates unique constraint "boats_name_unique"', 409);
        db.boats.push({ id: `boat-${db.boats.length + 1}`, ...b });
        return route.fulfill({ status: 201, headers: cors });
      }
      if (req.method() === 'PATCH') {
        const boat = db.boats.find((x) => x.id === eqParam('id'));
        Object.assign(boat, body());
        return route.fulfill({ status: 204, headers: cors });
      }
    }
    return json(route, { error: 'unmocked ' + url.pathname }, 404);
  });
  return { page, ctx, problems };
}

// Every screenshot is also an accessibility scan (axe-core, WCAG 2.0/2.1 A + AA + best practices) of exactly what is on
// screen: serious and critical findings fail the run, lesser ones are only listed. Both colour schemes are covered because
// the scenarios open pages in light and dark.
const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];
const a11yNotes = [];
async function a11y(page, name) {
  const result = await new AxeBuilder({ page }).withTags(A11Y_TAGS).analyze();
  const blocking = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  for (const v of result.violations.filter((x) => !blocking.includes(x))) a11yNotes.push(`${name}: ${v.impact} ${v.id} (${v.nodes.length})`);
  check(
    `a11y (${name}): no serious or critical axe violations`,
    blocking.length === 0,
    blocking.map((v) => `${v.id} [${v.impact}] x${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' ; ')}`).join(' | '),
  );
}
const shot = async (page, name, fullPage = false) => {
  await a11y(page, name);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage });
};

// ---------- 1. signed out ----------
{
  const { page, ctx, problems } = await newPage();
  await page.goto(BASE + '/');
  await page.waitForURL('**/giris');
  check('signed-out visitor is redirected to /giris', true);
  check('login page has Turkish title', await page.getByRole('heading', { name: 'Giriş yap' }).isVisible());
  await shot(page, '01-login');

  await page.getByRole('button', { name: 'Giriş yap' }).click();
  check('empty submit shows both validation messages', (await page.getByText('Kullanıcı adınızı yazın.').isVisible()) && (await page.getByText('Şifrenizi yazın.').isVisible()));

  await page.getByLabel('Kullanıcı adı').fill('ayse');
  await page.getByLabel('Şifre').fill('Wrong123');
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.getByText('Kullanıcı adı veya şifre hatalı.').waitFor();
  check('wrong password shows Turkish error', true);
  await shot(page, '02-login-error');

  await page.goto(BASE + '/antrenor/uyeler');
  await page.waitForURL('**/giris');
  check('protected URL redirects to login when signed out', true);

  await page.goto(BASE + '/gizlilik');
  await page.getByRole('heading', { name: 'Gizlilik bildirimi' }).waitFor();
  check('privacy notice is public', true);
  check('signed-out: no unexpected errors', problems.length === 0, problems.join(' | '));
  await ctx.close();
}

// ---------- 2. coach ----------
{
  const { page, ctx, problems } = await newPage();
  await page.goto(BASE + '/giris');
  await page.getByLabel('Kullanıcı adı').fill('  Ayse ');
  await page.getByLabel('Şifre').fill('Coach1234');
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL('**/antrenor');
  check('coach lands on /antrenor', true);
  check('login sent the synthetic email (lower-cased username)', state.log.some((l) => l.includes('/auth/v1/token')));
  await page.getByRole('heading', { name: 'Merhaba, Ayşe' }).waitFor();
  await shot(page, '03-coach-dashboard');

  await page.goto(BASE + '/uye');
  await page.waitForURL('**/antrenor');
  check('coach cannot open the member area', true);

  await page.getByRole('link', { name: 'Üyeler', exact: true }).click();
  await page.getByText('Çağla Şahin').waitFor();
  check('members list renders (coach first, Turkish order)', (await page.locator('ul li button p.font-semibold').allTextContents()).join(',') === 'Ayşe Yılmaz,Ali Kaya,Çağla Şahin,Eski Üye', (await page.locator('ul li button p.font-semibold').allTextContents()).join(','));
  check('inactive and first-login badges are shown', (await page.getByText('Devre dışı').first().isVisible()) && (await page.getByText('İlk giriş bekleniyor').isVisible()));
  await shot(page, '04-members');

  await page.getByRole('searchbox').fill('cagla');
  check('search ignores Turkish diacritics', (await page.locator('main ul li').count()) === 1);
  await page.getByRole('searchbox').fill('');

  await page.getByRole('button', { name: 'Üye ekle' }).first().click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Hesabı oluştur' }).click();
  check('add-member form validates', await page.getByText('Ad soyad en az 2 karakter olmalı.').isVisible());
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Ad soyad').fill('Deniz Aksoy');
  await dlg.getByLabel('Kullanıcı adı').fill('ali');
  await page.getByRole('button', { name: 'Hesabı oluştur' }).click();
  await page.getByText('Bu kullanıcı adı zaten kullanılıyor').waitFor();
  check('server error (duplicate username) shows inline in the dialog', await dlg.getByRole('alert').filter({ hasText: 'zaten kullanılıyor' }).isVisible());
  await dlg.getByLabel('Kullanıcı adı').fill('Deniz.Aksoy');
  await shot(page, '05-add-member');
  await page.getByRole('button', { name: 'Hesabı oluştur' }).click();
  await page.getByText('Geçici şifre').waitFor();
  check('one-time password dialog appears', (await page.getByText('Kx7mQp9Ret').isVisible()) && (await page.getByText('deniz.aksoy').isVisible()));
  await shot(page, '06-credentials');
  await page.getByRole('button', { name: 'Davet mesajını kopyala' }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('invite message copied with app URL, username and password', clip.includes(BASE) && clip.includes('deniz.aksoy') && clip.includes('Kx7mQp9Ret'), clip.replace(/\n/g, ' | '));
  await page.getByRole('button', { name: 'Kapat' }).last().click();
  check('password is gone after closing', (await page.getByText('Kx7mQp9Ret').count()) === 0);

  await page.getByRole('button', { name: /Çağla Şahin/ }).click();
  await page.getByRole('button', { name: 'Şifreyi sıfırla' }).click();
  await page.getByText('Eski şifre geçersiz olur').waitFor();
  await shot(page, '07-reset-confirm');
  await page.getByRole('button', { name: 'Evet, devam et' }).click();
  await page.getByText('Zt4nHw6Vab').waitFor();
  check('password reset flow shows the new one-time password', true);
  await page.getByRole('button', { name: 'Kapat' }).last().click();

  await page.getByRole('button', { name: /Ayşe Yılmaz/ }).click();
  check('coach cannot deactivate/reset themselves', (await page.getByRole('button', { name: 'Hesabı devre dışı bırak' }).count()) === 0 && (await page.getByText('Siz').isVisible()));
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'Diğer', exact: true }).click();
  await page.getByRole('heading', { name: 'Bildirimler' }).waitFor();
  check('coach "Diğer" page has notifications + install + logout', (await page.getByText('Uygulamayı telefonunuza yükleyin').first().isVisible()) && (await page.getByRole('button', { name: 'Çıkış yap' }).isVisible()));
  await shot(page, '08-coach-more');

  await page.getByRole('button', { name: 'Çıkış yap' }).click();
  await page.waitForURL('**/giris');
  check('logout returns to login', true);
  check('coach: no unexpected errors', problems.length === 0, problems.join(' | '));
  await ctx.close();
}

// ---------- 3. member with a temporary password ----------
{
  const { page, ctx, problems } = await newPage('dark');
  await page.goto(BASE + '/giris');
  await page.getByLabel('Kullanıcı adı').fill('ali');
  await page.getByLabel('Şifre').fill('Temp12345');
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL('**/sifre-degistir');
  check('temporary password forces /sifre-degistir', true);
  await shot(page, '09-force-change-dark');

  await page.goto(BASE + '/uye');
  await page.waitForURL('**/sifre-degistir');
  check('cannot bypass the forced change by URL', true);

  await page.getByLabel('Yeni şifre', { exact: true }).fill('short');
  await page.getByLabel('Yeni şifre (tekrar)').fill('short');
  await page.getByRole('button', { name: 'Şifreyi kaydet' }).click();
  check('weak password rejected client-side', await page.getByText('Şifre en az 8 karakter olmalı.').isVisible());
  await page.getByLabel('Yeni şifre', { exact: true }).fill('Kurek2026x');
  await page.getByLabel('Yeni şifre (tekrar)').fill('Kurek2026x');
  await page.getByRole('button', { name: 'Şifreyi kaydet' }).click();
  await page.waitForURL('**/uye');
  check('after changing password the member reaches /uye', true);
  await page.getByRole('heading', { name: 'Merhaba, Ali' }).waitFor();
  await page.getByText('Yaklaşan antrenman yok').waitFor();
  check('member home shows the empty state', true);
  await shot(page, '10-member-home-dark');

  await page.goto(BASE + '/antrenor/uyeler');
  await page.waitForURL('**/uye');
  check('member cannot open the coach panel', true);

  await page.getByRole('link', { name: 'Profil', exact: true }).click();
  await page.getByText('@ali').waitFor();
  await shot(page, '11-member-profile-dark');
  check('member profile shows role badge', await page.getByText('Üye', { exact: true }).first().isVisible());
  check('member: no unexpected errors', problems.length === 0, problems.join(' | '));
  await ctx.close();
}

// ---------- 5. coach: trainings, responses, cancel, boats ----------
{
  db.trainings = [];
  db.responses = [];
  people.member.must_change_password = false;
  const { page, ctx, problems } = await newPage();
  const login = async () => {
    await page.goto(BASE + '/giris');
    await page.getByLabel('Kullanıcı adı').fill('ayse');
    await page.getByLabel('Şifre').fill('Coach1234');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await page.waitForURL('**/antrenor');
  };
  await login();

  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Antrenmanlar', exact: true }).click();
  await page.getByText('Yaklaşan antrenman yok').waitFor();
  check('coach trainings list starts empty with guidance', await page.getByText('İlk antrenmanı eklemek için').isVisible());
  await shot(page, '12-coach-trainings-empty');

  // create — validation first
  await page.getByRole('link', { name: 'Antrenman ekle' }).click();
  await page.getByRole('heading', { name: 'Yeni antrenman' }).waitFor();
  await page.getByLabel('Tarih', { exact: true }).fill(istanbulDate(Date.now() - 24 * HOUR));
  await page.getByRole('button', { name: 'Antrenmanı oluştur' }).click();
  check('a start time in the past is rejected', await page.getByText('Başlangıç zamanı geçmişte olamaz.').isVisible());

  // create — happy path (3 days ahead so the "24 saat önce" deadline is in the future at any time of day)
  await page.getByLabel('Tarih', { exact: true }).fill(istanbulDate(Date.now() + 3 * 24 * HOUR));
  await page.getByLabel('Başlangıç saati').fill('08:00');
  check('the form does not ask for a number of sessions (the coach adds sessions while preparing the program)', (await page.getByLabel('Seans sayısı').count()) === 0 && (await page.getByText(/Kaç seans süreceğini şimdi girmenize gerek yok/).isVisible()));
  check('deadline choices: 12 / 24 / 48 hours before, the evening before at 20:00, or a custom time', (await page.getByRole('radio').allInnerTexts()).join('|') === '12 saat önce|24 saat önce|48 saat önce|Bir önceki akşam 20:00|Özel zaman');
  await page.getByRole('radio', { name: '24 saat önce' }).click();
  check('form previews the start time only', await page.getByText(/Antrenman 08:00 · Son yanıt:/).isVisible());
  await page.getByLabel('Başlık (isteğe bağlı)').fill('Sabah antrenmanı');
  await shot(page, '13-training-form');
  await page.getByRole('button', { name: 'Antrenmanı oluştur' }).click();
  await page.getByText('08:00 · süre program hazırlanınca belli olur').waitFor();
  check('created training opens its detail page: start time only, the length is decided by the program', true);
  check('server stored start/deadline as UTC instants (08:00 Istanbul = 05:00Z; deadline 24 h earlier)', (() => {
    const t = db.trainings[0];
    return t && new Date(t.starts_at).getUTCHours() === 5 && Date.parse(t.starts_at) - Date.parse(t.rsvp_deadline) === 24 * HOUR && t.slot_count === 0 && !('slotCount' in t);
  })());
  check('roster of active members is unanswered (2 members; deactivated one excluded)', await page.getByRole('region', { name: 'Yanıt yok (2)' }).isVisible());
  await shot(page, '14-coach-training-detail');

  // answer on a member's behalf
  await page.getByRole('button', { name: 'Ali Kaya için yanıtı değiştir' }).click();
  const dlg5 = page.getByRole('dialog');
  await dlg5.getByRole('radio', { name: 'Katılıyorum' }).click();
  await dlg5.getByLabel('Antrenöre not').fill('Telefonla bildirdi');
  await dlg5.getByRole('button', { name: 'Kaydet' }).click();
  const attendingRegion = page.getByRole('region', { name: 'Katılıyor (1)' });
  await attendingRegion.waitFor();
  check('coach can record an answer for a member (shown with note and coach badge)', (await attendingRegion.getByText('Ali Kaya').isVisible()) && (await attendingRegion.getByText('Telefonla bildirdi').isVisible()) && (await attendingRegion.getByText('Antrenör girdi').isVisible()));
  await shot(page, '15-coach-responses');

  // list shows counts
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Antrenmanlar', exact: true }).click();
  await page.getByText('1 katılıyor').waitFor();
  check('list summarises answers per training', await page.getByText('1 yanıt yok').isVisible());

  // edit
  await page.getByRole('link', { name: /Sabah antrenmanı|seans/ }).first().click();
  await page.getByRole('link', { name: 'Düzenle' }).click();
  await page.getByRole('heading', { name: 'Antrenmanı düzenle' }).waitFor();
  check('edit form is pre-filled (no session field, 24 h preset recognised)', (await page.getByLabel('Seans sayısı').count()) === 0 && (await page.getByRole('radio', { name: '24 saat önce' }).getAttribute('aria-checked')) === 'true');
  await page.getByRole('radio', { name: 'Bir önceki akşam 20:00' }).click();
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/duzenle'));
  await page.getByRole('link', { name: 'Düzenle' }).waitFor();
  const eveningBefore = Date.parse(`${istanbulDate(Date.now() + 2 * 24 * HOUR)}T20:00:00+03:00`); // training is 3 days ahead at 08:00
  check('"the evening before at 20:00" stores 20:00 Istanbul time on the previous calendar day, and the length stays unset', Date.parse(db.trainings[0].rsvp_deadline) === eveningBefore && db.trainings[0].slot_count === 0, db.trainings[0].rsvp_deadline);
  await page.getByRole('link', { name: 'Düzenle' }).click();
  check('and reopening the form shows that choice again', (await page.getByRole('radio', { name: 'Bir önceki akşam 20:00' }).getAttribute('aria-checked')) === 'true');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/duzenle'));

  // cancel
  await page.getByRole('button', { name: 'İptal et' }).click();
  const cancelDlg = page.getByRole('dialog');
  await cancelDlg.getByRole('button', { name: 'Antrenmanı iptal et' }).click();
  check('cancel needs a reason', await cancelDlg.getByText('İptal nedeni 3–200 karakter olmalı.').isVisible());
  await cancelDlg.getByLabel('İptal nedeni').fill('Şiddetli rüzgâr');
  await cancelDlg.getByRole('button', { name: 'Antrenmanı iptal et' }).click();
  await page.getByText('İptal nedeni: Şiddetli rüzgâr').waitFor();
  check('cancelled training shows badge + reason and can no longer be edited', (await page.getByText('İptal edildi').first().isVisible()) && (await page.getByRole('link', { name: 'Düzenle' }).count()) === 0);
  await shot(page, '16-coach-cancelled');

  // boats
  await page.getByRole('link', { name: 'Diğer', exact: true }).click();
  await page.getByRole('link', { name: /Tekneler/ }).click();
  await page.getByRole('heading', { name: 'Tekneler' }).waitFor();
  await page.getByText('C4X').waitFor(); // list loads after the heading
  check('boats list shows Mavi (2), Turuncu (2), C4X (4)', (await page.getByText('Mavi').isVisible()) && (await page.getByText('Turuncu').isVisible()) && (await page.getByText('C4X').isVisible()) && (await page.getByText('4 kişilik').isVisible()));
  await shot(page, '17-boats');
  await page.getByRole('button', { name: 'Tekne ekle' }).first().click();
  const boatDlg = page.getByRole('dialog');
  await boatDlg.getByLabel('Tekne adı').fill('Mavi');
  await boatDlg.getByRole('button', { name: 'Kaydet' }).click();
  await boatDlg.getByText('Bu isimde bir tekne zaten var.').waitFor();
  check('duplicate boat name is explained', true);
  await boatDlg.getByLabel('Tekne adı').fill('Yeşil');
  await boatDlg.getByLabel('Kişi kapasitesi').selectOption('1');
  await boatDlg.getByRole('button', { name: 'Kaydet' }).click();
  await page.getByText('1 kişilik').waitFor();
  check('a new boat can be added', await page.getByText('Yeşil').isVisible());
  await page.getByRole('button', { name: /Turuncu/ }).click();
  await page.getByRole('dialog').getByLabel('Tekne kullanımda').uncheck();
  await page.getByRole('dialog').getByRole('button', { name: 'Kaydet' }).click();
  await page.getByText('Kullanım dışı').waitFor();
  check('a boat can be taken out of use', db.boats.find((b) => b.name === 'Turuncu').is_active === false);

  check('coach trainings: no unexpected errors', problems.length === 0, problems.join(' | '));
  await ctx.close();
}

// ---------- 6. member: answering, deadline lock, cancellations, phone-clock skew ----------
{
  const now = Date.now();
  db.trainings = [];
  db.responses = [];
  db.serverSkewMs = 0;
  db.trainings.push(
    makeTraining({ title: 'Kilitli antrenman', starts_at: iso(now + 3 * HOUR), rsvp_deadline: iso(now - HOUR), slot_count: 1 }),
    makeTraining({ title: 'Açık antrenman', starts_at: iso(now + 3 * 24 * HOUR), rsvp_deadline: iso(now + 2 * 24 * HOUR), slot_count: 2, notes: 'Ekipman getirin' }),
    makeTraining({ title: 'İkinci antrenman', starts_at: iso(now + 4 * 24 * HOUR), rsvp_deadline: iso(now + 3 * 24 * HOUR) }),
    makeTraining({ title: 'İptal antrenmanı', starts_at: iso(now + 5 * 24 * HOUR), rsvp_deadline: iso(now + 4 * 24 * HOUR), status: 'cancelled', cancel_reason: 'Şiddetli rüzgâr' }),
    makeTraining({ title: 'Geçmiş antrenman', starts_at: iso(now - 3 * 24 * HOUR), rsvp_deadline: iso(now - 4 * 24 * HOUR) }),
  );
  const open = db.trainings[1];

  const { page, ctx, problems } = await newPage();
  await page.goto(BASE + '/giris');
  await page.getByLabel('Kullanıcı adı').fill('ali');
  await page.getByLabel('Şifre').fill('Kurek2026x');
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL('**/uye');

  // home: next training is the one already locked; cancellation is called out
  await page.getByText('Sıradaki antrenman').waitFor();
  check('home: next training (locked) explains the deadline has passed', await page.getByRole('heading', { name: 'Yanıt süresi doldu' }).isVisible());
  check('home: a cancellation in the coming week is highlighted with its reason', await page.getByText('İptal nedeni: Şiddetli rüzgâr').first().isVisible());
  check('home: further upcoming trainings show the member\'s answer status', (await page.getByText('Yanıt bekleniyor').first().isVisible()));
  await shot(page, '18-member-home-trainings');

  // list + tab keyboard navigation
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Antrenmanlar', exact: true }).click();
  await page.getByText('Açık antrenman').waitFor();
  await page.getByRole('tab', { name: 'Yaklaşan' }).focus();
  await page.keyboard.press('ArrowRight');
  check('tabs work with the keyboard (ArrowRight → Geçmiş)', (await page.getByRole('tab', { name: 'Geçmiş' }).getAttribute('aria-selected')) === 'true');
  check('past trainings list shows the finished training', await page.getByText('Geçmiş antrenman').isVisible());
  await page.getByRole('tab', { name: 'Yaklaşan' }).click();

  // answer
  await page.getByRole('link', { name: /Açık antrenman/ }).click();
  await page.getByRole('heading', { name: 'Bu antrenmana katılacak mısınız?' }).waitFor();
  check('detail shows the coach note and the deadline countdown', (await page.getByText('Ekipman getirin').isVisible()) && (await page.getByText(/gün .* kaldı|sa .* kaldı/).first().isVisible()));
  await shot(page, '19-member-rsvp');
  await page.getByRole('radio', { name: 'Katılıyorum' }).click();
  await page.getByText('Yanıtınız kaydedildi.').waitFor();
  check('choosing "Katılıyorum" saves immediately', (await page.getByRole('radio', { name: 'Katılıyorum' }).getAttribute('aria-checked')) === 'true' && db.responses[0]?.response === 'attending');

  await page.getByLabel('Antrenöre not').fill("9'dan sonraya yazar mısınız? İşim var.");
  await page.getByRole('button', { name: 'Notu kaydet' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Yanıtınız kaydedildi.'));
  check('the note is saved separately from the choice', db.responses[0]?.note === "9'dan sonraya yazar mısınız? İşim var.");

  await page.getByRole('radio', { name: 'Katılmıyorum' }).click();
  await page.waitForFunction(() => document.querySelector('[role=radio][aria-checked=true]')?.textContent?.includes('Katılmıyorum'));
  check('the answer can be changed before the deadline (note kept)', db.responses[0]?.response === 'not_attending' && db.responses[0]?.note !== null);

  await page.reload();
  await page.getByRole('heading', { name: 'Bu antrenmana katılacak mısınız?' }).waitFor();
  check('the answer and note survive a reload', (await page.getByRole('radio', { name: 'Katılmıyorum' }).getAttribute('aria-checked')) === 'true' && (await page.getByLabel('Antrenöre not').inputValue()).startsWith("9'dan"));

  // the server refuses (deadline passed there): visible error and the choice rolls back
  db.rejectRsvp = 'Yanıt süresi doldu. Değişiklik için antrenörünüzle görüşün.';
  await page.getByRole('radio', { name: 'Katılıyorum' }).click();
  await page.getByRole('alert').filter({ hasText: 'Yanıt süresi doldu' }).waitFor();
  check('a server refusal shows the reason and rolls the choice back', (await page.getByRole('radio', { name: 'Katılmıyorum' }).getAttribute('aria-checked')) === 'true' && db.responses[0].response === 'not_attending');
  await shot(page, '20-member-rsvp-refused');
  db.rejectRsvp = null;

  // a locked training offers no buttons
  await page.goto(BASE + '/uye');
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Antrenmanlar', exact: true }).click();
  await page.getByRole('link', { name: /Kilitli antrenman/ }).click();
  await page.getByRole('heading', { name: 'Yanıt süresi doldu' }).waitFor();
  check('after the deadline there are no answer buttons, only the outcome', (await page.getByRole('radio').count()) === 0 && (await page.getByText('Süre içinde yanıt vermediniz.').isVisible()));

  // a cancelled training
  await page.goto(BASE + '/uye/antrenmanlar');
  await page.getByRole('link', { name: /İptal antrenmanı/ }).click();
  await page.getByRole('heading', { name: 'Bu antrenman iptal edildi' }).waitFor();
  check('cancelled training shows why and offers no answer buttons', (await page.getByRole('radio').count()) === 0 && (await page.getByText('İptal nedeni: Şiddetli rüzgâr').first().isVisible()));
  await shot(page, '21-member-cancelled');
  check('member trainings: no unexpected errors', problems.length === 0, problems.join(' | '));
  await ctx.close();

  // phone clock is 2 hours behind the server: the deadline (1 h ahead by the phone) has already passed on the server
  db.serverSkewMs = 2 * HOUR;
  const skew = makeTraining({ title: 'Saat farkı antrenmanı', starts_at: iso(Date.now() + 5 * HOUR), rsvp_deadline: iso(Date.now() + HOUR) });
  db.trainings.push(skew);
  {
    const { page: p2, ctx: c2, problems: pr2 } = await newPage();
    await p2.goto(BASE + '/giris');
    await p2.getByLabel('Kullanıcı adı').fill('ali');
    await p2.getByLabel('Şifre').fill('Kurek2026x');
    await p2.getByRole('button', { name: 'Giriş yap' }).click();
    await p2.waitForURL('**/uye');
    await p2.goto(BASE + `/uye/antrenmanlar/${skew.id}`);
    await p2.getByRole('heading', { name: 'Yanıt süresi doldu' }).waitFor({ timeout: 8000 });
    check('a wrong phone clock cannot re-open a closed deadline (UI follows the server clock)', (await p2.getByRole('radio').count()) === 0);
    check('skew: no unexpected errors', pr2.length === 0, pr2.join(' | '));
    await c2.close();
  }
  db.serverSkewMs = 0;
  check('untouched training keeps no answer from the failed attempts', !db.responses.some((r) => r.training_id === open.id && r.response === 'attending'));
}

// ---------- 7. program: the coach builds it hour by hour, members see their own boat ----------
{
  const now = Date.now();
  const at8 = (days) => Date.parse(`${istanbulDate(now + days * 24 * HOUR)}T08:00:00+03:00`);
  db.trainings = [];
  db.responses = [];
  db.programs = {};
  db.saves = [];
  db.boats.find((b) => b.name === 'Turuncu').is_active = true;
  const newcomers = [['alex', 'Alex'], ['ashley', 'Ashley'], ['john', 'John'], ['jamie', 'Jamie']].map(([username, full_name], i) => ({
    id: `55555555-5555-4555-8555-55555555555${i}`, full_name, username, role: 'member', phone: null, is_active: true, must_change_password: false,
  }));
  roster.push(...newcomers);
  const [alex, ashley, john, jamie] = newcomers;
  const cagla = roster.find((p) => p.username === 'cagla');
  alex.phone = '0555 111 22 33';
  const t = makeTraining({ title: 'Program antrenmanı', starts_at: iso(at8(3)), slot_count: 2, rsvp_deadline: iso(at8(2)) });
  db.trainings.push(t);
  const answer = (m, response, note = null) => db.responses.push({ training_id: t.id, member_id: m.id, response, note, responded_at: iso(now), set_by_coach: false });
  answer(people.member, 'attending', "9'dan sonraya yazar mısınız?");
  [alex, ashley, john, jamie].forEach((m) => answer(m, 'attending'));
  answer(cagla, 'not_attending');

  const { page, ctx, problems } = await newPage();
  await page.goto(BASE + '/giris');
  await page.getByLabel('Kullanıcı adı').fill('ayse');
  await page.getByLabel('Şifre').fill('Coach1234');
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL('**/antrenor');
  await page.goto(BASE + `/antrenor/antrenmanlar/${t.id}`);
  await page.getByRole('tab', { name: 'Program' }).click();
  await page.getByText('Taslak — üyeler görmüyor').waitFor();

  const slotTabs = page.getByRole('tablist', { name: 'Seanslar' }).getByRole('tab');
  check('one tab per one-hour session (08:00, 09:00)', (await slotTabs.count()) === 2 && (await slotTabs.allTextContents()).join(',') === '08:00,09:00');
  const boat = (name) => page.getByRole('group', { name, exact: true });
  check('active boats are offered (Mavi, Turuncu, C4X, Yeşil)', (await boat('Mavi').isVisible()) && (await boat('Turuncu').isVisible()) && (await boat('C4X').isVisible()));
  await shot(page, '22-program-editor-empty');

  const openPicker = async (name) => {
    await boat(name).getByRole('button', { name: /Ekip seç|Ekibi düzenle/ }).click();
    return page.getByRole('dialog');
  };

  // hour 1 (08:00): Mavi = Alex + Ashley ; Turuncu = Ali + John
  let d = await openPicker('Mavi');
  check('picker is titled with boat and hour', await d.getByRole('heading', { name: 'Mavi · 08:00–09:00' }).isVisible());
  check("a member's note is shown while choosing the crew", await d.getByText("9'dan sonraya yazar mısınız?").isVisible());
  check('members who said "not attending" are tucked away, not offered first', !(await d.getByRole('checkbox', { name: /Çağla/ }).isVisible()));
  await d.getByRole('checkbox', { name: /Alex/ }).click();
  await d.getByRole('checkbox', { name: /Ashley/ }).click();
  check('a full boat refuses a third person', (await d.getByRole('checkbox', { name: /John/ }).getAttribute('aria-disabled')) === 'true' && (await d.getByText('Tekne dolu').first().isVisible()));
  await shot(page, '23-crew-picker');
  await d.getByRole('button', { name: 'Tamam' }).click();
  check('Mavi shows its crew and 2/2', (await boat('Mavi').getByText('Alex').isVisible()) && (await boat('Mavi').getByText('2/2').isVisible()));

  d = await openPicker('Turuncu');
  await d.getByRole('checkbox', { name: /Ali Kaya/ }).click();
  await d.getByRole('checkbox', { name: /John/ }).click();
  await d.getByRole('button', { name: 'Tamam' }).click();

  d = await openPicker('C4X');
  check('a member already in another boat that hour cannot be picked again', (await d.getByRole('checkbox', { name: /Ali Kaya/ }).getAttribute('aria-disabled')) === 'true' && (await d.getByText('Bu seansta Turuncu teknesinde').first().isVisible()));
  await d.getByRole('button', { name: 'Tamam' }).click();

  await boat('Mavi').getByLabel('Tekne notu (isteğe bağlı)').fill('teknik çalışma');

  // hour 2 (09:00): copy, then clear (with confirmation), then a different crew on the same boat
  await slotTabs.nth(1).click();
  await page.getByRole('button', { name: 'Önceki seansı kopyala' }).click();
  check('copying the previous hour brings boats, crews and notes along', (await boat('Mavi').getByText('Alex').isVisible()) && (await boat('Turuncu').getByText('John').isVisible()));
  await page.getByRole('button', { name: 'Seansı temizle' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Evet, temizle' }).click();
  check('clearing an hour asks first, then empties it', (await boat('Mavi').getByRole('button', { name: 'Ekip seç' }).isVisible()) && (await boat('Turuncu').getByRole('button', { name: 'Ekip seç' }).isVisible()));
  d = await openPicker('Mavi');
  await d.getByRole('checkbox', { name: /John/ }).click();
  await d.getByRole('button', { name: 'Tamam' }).click();
  d = await openPicker('Turuncu');
  await d.getByRole('checkbox', { name: /Ali Kaya/ }).click();
  await d.getByRole('button', { name: 'Tamam' }).click();
  check('the same boat can carry a different crew in the next hour', (await boat('Mavi').getByText('John').isVisible()) && !(await boat('Mavi').getByText('Alex').isVisible()));

  await page.getByLabel('Hava durumu notu').fill('Rüzgâr batıdan 15 km/s');
  await page.getByLabel('Antrenman notu').fill('Isınma 10 dk');
  await shot(page, '24-program-editor');

  // publishing with someone forgotten warns first
  await page.getByRole('button', { name: 'Yayınla' }).click();
  const warn = page.getByRole('dialog');
  await warn.getByText('Jamie hiçbir seansa atanmadı.').waitFor();
  check('publishing warns about attendees who are in no hour, and sends nothing yet', (await warn.getByRole('heading', { name: 'Yayınlamadan önce' }).isVisible()) && !db.programs[t.id]);
  await shot(page, '25-program-warning');
  await warn.getByRole('button', { name: 'Düzenlemeye dön' }).click();
  check('the summary shows who still has no hour', await page.getByText('Hiç seansta yok').isVisible());

  d = await openPicker('Mavi');
  await d.getByRole('checkbox', { name: /Jamie/ }).click();
  await d.getByRole('button', { name: 'Tamam' }).click();

  await page.getByRole('button', { name: 'Taslağı kaydet' }).click();
  await page.getByText('Taslak kaydedildi.').waitFor();
  const draftRow = db.programs[t.id];
  check('draft saved atomically with all four boat assignments and the notes', draftRow?.program.status === 'draft' && draftRow.assignments.length === 4 && draftRow.crew.length === 7 && draftRow.program.weather_note === 'Rüzgâr batıdan 15 km/s' && draftRow.assignments.some((a) => a.notes === 'teknik çalışma'));

  // a member cannot see a draft
  {
    const { page: mp, ctx: mc, problems: mprob } = await newPage();
    await mp.goto(BASE + '/giris');
    await mp.getByLabel('Kullanıcı adı').fill('ali');
    await mp.getByLabel('Şifre').fill('Kurek2026x');
    await mp.getByRole('button', { name: 'Giriş yap' }).click();
    await mp.waitForURL('**/uye');
    await mp.goto(BASE + `/uye/antrenmanlar/${t.id}`);
    await mp.getByText('Program henüz yayınlanmadı').waitFor();
    check('members see no program while it is a draft', (await mp.getByText('Sizin programınız').count()) === 0);
    check('draft: no unexpected errors (member)', mprob.length === 0, mprob.join(' | '));
    await mc.close();
  }

  // publish (nobody forgotten now → no warning)
  await page.getByRole('button', { name: 'Yayınla' }).click();
  await page.getByText('Program yayınlandı.').waitFor();
  await page.getByText('Yayında (sürüm 1)').waitFor();
  check('published: version 1, published by the coach', db.programs[t.id].program.status === 'published' && db.programs[t.id].program.version === 1);

  // unsaved changes are protected
  await page.getByLabel('Antrenman notu').fill('Isınma 10 dk, sonra uzun set');
  check('editing marks the program as unsaved', await page.getByText('Kaydedilmemiş değişiklikler var').isVisible());
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Üyeler', exact: true }).click();
  const leave = page.getByRole('dialog');
  await leave.getByRole('heading', { name: 'Kaydedilmemiş değişiklikler' }).waitFor();
  await leave.getByRole('button', { name: 'Kal' }).click();
  check('leaving with unsaved changes asks first; "Kal" keeps the editor', page.url().includes(`/antrenor/antrenmanlar/${t.id}`) && (await page.getByLabel('Antrenman notu').inputValue()).includes('uzun set'));
  await page.getByRole('button', { name: 'Güncelle' }).click();
  await page.getByText('Program güncellendi.').waitFor();
  await page.getByText('Yayında (sürüm 2)').waitFor();
  check('updating a published program bumps the version', db.programs[t.id].program.version === 2 && db.programs[t.id].program.training_notes.includes('uzun set'));

  // the member's view
  {
    const { page: mp, ctx: mc, problems: mprob } = await newPage('dark');
    await mp.goto(BASE + '/giris');
    await mp.getByLabel('Kullanıcı adı').fill('ali');
    await mp.getByLabel('Şifre').fill('Kurek2026x');
    await mp.getByRole('button', { name: 'Giriş yap' }).click();
    await mp.waitForURL('**/uye');
    const mine = mp.getByRole('region', { name: 'Sizin programınız' });
    await mine.waitFor();
    check('home: "my boat" card shows each hour, boat and crew mates', (await mine.getByText('08:00–09:00').isVisible()) && (await mine.getByText('Turuncu').first().isVisible()) && (await mine.getByText('John ile').isVisible()) && (await mine.getByText('09:00–10:00').isVisible()) && (await mine.getByText('tek başına').isVisible()));
    const above = async (a, b) => (await a.boundingBox()).y < (await b.boundingBox()).y;
    check('home: my boat comes BEFORE the RSVP card (the first thing a member sees)', await above(mine, mp.getByRole('heading', { name: 'Program yayınlandı, yanıtlar kilitlendi' })));
    // the whole program is on Home too, grouped by boat, my sessions highlighted
    const turuncu = mp.getByRole('region', { name: /^Turuncu( Sizin tekneniz)?$/ });
    const mavi = mp.getByRole('region', { name: /^Mavi( Sizin tekneniz)?$/ });
    await turuncu.waitFor();
    check('home: the full program is grouped by boat (Mavi, Turuncu), each with its sessions and crews', (await mavi.getByText('Alex').isVisible()) && (await mavi.getByText('Jamie').isVisible()) && (await turuncu.getByText('John').first().isVisible()));
    check('home: my two Turuncu sessions are highlighted, the Mavi ones are not', (await turuncu.getByText('Sizin seansınız').count()) === 2 && (await mavi.getByText('Sizin seansınız').count()) === 0);
    const solid = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
    const pageBg = await solid(mp.locator('body'));
    const mineRows = mp.locator('li[data-mine="true"]');
    check('home: my sessions are SOLID blocks (own background, not the page background) — one per session of mine', (await mineRows.count()) === 2 && (await solid(mineRows.first())) !== pageBg && (await solid(mineRows.first())) === (await solid(mineRows.last())));
    check('home: the boat I row in comes first and is tagged "Sizin tekneniz"', (await above(turuncu, mavi)) && (await turuncu.getByText('Sizin tekneniz').isVisible()) && (await mavi.getByText('Sizin tekneniz').count()) === 0);
    check('home: each boat carries its icon (drawn, decorative)', (await mp.locator('section svg[data-boat]').count()) >= 2);
    await mine.getByRole('group', { name: /^Hava durumu, / }).first().waitFor();
    check('home: my card shows the forecast under EACH of my two sessions (the coach\'s publish fetched it)', (await mine.getByRole('group', { name: /^Hava durumu, / }).count()) === 2);
    await shot(mp, '26-member-my-boat-dark', true);
    await mp.goto(BASE + `/uye/antrenmanlar/${t.id}`);
    await mp.getByRole('heading', { name: 'Tüm program' }).waitFor();
    check('detail: whole program by boat with everyone\'s crew, notes and weather', (await mp.getByRole('region', { name: /^Mavi( Sizin tekneniz)?$/ }).getByText('08:00–09:00').isVisible()) && (await mp.getByText('Alex').first().isVisible()) && (await mp.getByText('teknik çalışma').isVisible()) && (await mp.getByText('Rüzgâr batıdan 15 km/s').isVisible()) && (await mp.getByText('Isınma 10 dk, sonra uzun set').isVisible()));
    check('detail: the reader\'s own sessions are marked', (await mp.getByText('Sizin seansınız').count()) >= 1);
    check('detail: the answer is locked because the program is published (the deadline is still days away)', (await mp.getByRole('heading', { name: 'Program yayınlandı, yanıtlar kilitlendi' }).isVisible()) && (await mp.getByRole('radio', { name: 'Katılmıyorum' }).count()) === 0);
    await shot(mp, '27-member-full-program-dark');
    check('published: no unexpected errors (member)', mprob.length === 0, mprob.join(' | '));
    await mc.close();
  }

  // unpublish takes it away from members again
  await page.getByRole('button', { name: 'Yayından kaldır' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yayından kaldır' }).click();
  await page.getByText('Program yayından kaldırıldı.').waitFor();
  check('unpublished: back to draft, version kept', db.programs[t.id].program.status === 'draft' && db.programs[t.id].program.version === 2);
  {
    const { page: mp, ctx: mc } = await newPage();
    await mp.goto(BASE + '/giris');
    await mp.getByLabel('Kullanıcı adı').fill('ali');
    await mp.getByLabel('Şifre').fill('Kurek2026x');
    await mp.getByRole('button', { name: 'Giriş yap' }).click();
    await mp.waitForURL('**/uye');
    await mp.goto(BASE + `/uye/antrenmanlar/${t.id}`);
    await mp.getByText('Program henüz yayınlanmadı').waitFor();
    check('after unpublishing members no longer see the program', true);
    await mc.close();
  }

  check('program: no unexpected errors (coach)', problems.length === 0, problems.join(' | '));
  await ctx.close();
}

// ---------- 8. attendance (per session), history, monthly statistics ----------
{
  const now = Date.now();
  const currentMonth = istanbulDate(now).slice(0, 7);
  const shiftKey = (key, d) => {
    const [y, m] = key.split('-').map(Number);
    const i = y * 12 + (m - 1) + d;
    return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
  };
  const labelOf = (key) => new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5)) - 1, 1)));
  const prevMonth = shiftKey(currentMonth, -1);
  const byName = (n) => roster.find((p) => p.full_name === n);
  const [ali, alex, ashley, john, jamie] = ['Ali Kaya', 'Alex', 'Ashley', 'John', 'Jamie'].map(byName);

  db.trainings = [];
  db.responses = [];
  db.programs = {};
  db.attendance = [];
  db.attendanceSaves = [];

  // A: started 3 hours ago (2 sessions). Program: hour 1 Mavi = Alex + Ashley, hour 2 Mavi = John.
  const tA = makeTraining({ title: 'Yoklama antrenmanı', starts_at: iso(now - 3 * HOUR), slot_count: 2, rsvp_deadline: iso(now - 27 * HOUR) });
  db.trainings.push(tA);
  const crewRow = (assignment, slot, member, seat) => ({ assignment_id: assignment, training_id: tA.id, slot_index: slot, member_id: member.id, seat });
  db.programs[tA.id] = {
    program: { training_id: tA.id, status: 'published', version: 1, weather_note: null, training_notes: null, published_at: iso(now - 48 * HOUR), published_by: people.coach.id, created_at: '', updated_at: '' },
    assignments: [
      { id: 'as-x1', training_id: tA.id, slot_index: 0, boat_id: 'boat-1', notes: null },
      { id: 'as-x2', training_id: tA.id, slot_index: 1, boat_id: 'boat-1', notes: null },
    ],
    crew: [crewRow('as-x1', 0, alex, 1), crewRow('as-x1', 0, ashley, 2), crewRow('as-x2', 1, john, 1)],
  };
  // B: last month, already completed, Ali rowed once.
  const tB = makeTraining({ title: 'Geçen ayın antrenmanı', starts_at: iso(Date.parse(`${prevMonth}-15T08:00:00+03:00`)), slot_count: 1, rsvp_deadline: iso(Date.parse(`${prevMonth}-14T08:00:00+03:00`)), status: 'completed' });
  db.trainings.push(tB);
  db.attendance.push({ training_id: tB.id, slot_index: 0, member_id: ali.id, status: 'present', note: null, recorded_by: people.coach.id, recorded_at: iso(now) });
  // C: 200 days ago — outside the default 90-day window
  const tOld = makeTraining({ title: 'Eski antrenman', starts_at: iso(now - 200 * 24 * HOUR), slot_count: 1, rsvp_deadline: iso(now - 201 * 24 * HOUR), status: 'completed' });
  db.trainings.push(tOld);
  db.attendance.push({ training_id: tOld.id, slot_index: 0, member_id: ali.id, status: 'present', note: null, recorded_by: people.coach.id, recorded_at: iso(now) });

  const login = async (page, user, password) => {
    await page.goto(BASE + '/giris');
    await page.getByLabel('Kullanıcı adı').fill(user);
    await page.getByLabel('Şifre').fill(password);
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await page.waitForURL(user === 'ayse' ? '**/antrenor' : '**/uye');
  };
  const memberStatsPage = async (scheme = 'light') => {
    const m = await newPage(scheme);
    await login(m.page, 'ali', 'Kurek2026x');
    return m;
  };

  const { page, ctx, problems } = await newPage();
  // Desktop Edge has a native share sheet for files; force the plain-download path so the test can catch the file.
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }));
  await login(page, 'ayse', 'Coach1234');

  // the coach's to-do list points at the training whose attendance is due
  await page.getByRole('heading', { name: 'Yoklaması bekleyenler' }).waitFor();
  await page.getByRole('link', { name: /Yoklama al/ }).click();
  await page.getByRole('tab', { name: 'Yoklama', selected: true }).waitFor();
  check('dashboard lists trainings waiting for attendance and opens the Yoklama tab directly', true);

  const section = (n) => page.getByRole('region', { name: new RegExp(`^${n}\\. seans`) });
  const mark = (s, name, label) => s.getByRole('radiogroup', { name: `${name} için durum` }).getByRole('radio', { name: label });
  await section(1).getByText('Alex').waitFor();
  check('the sheet starts from the program: hour 1 Alex + Ashley (Mavi), hour 2 John', (await section(1).getByText('Ashley').isVisible()) && (await section(1).getByText('Mavi').first().isVisible()) && (await section(2).getByText('John').isVisible()) && !(await section(2).getByText('Alex').isVisible()));
  check('everyone planned starts as "Geldi"', (await mark(section(1), 'Alex', 'Geldi').getAttribute('aria-checked')) === 'true' && (await page.getByText('3 kişi · 3 seans geldi').isVisible()));
  await shot(page, '28-attendance-sheet');

  await mark(section(1), 'Ashley', 'Gelmedi').click();
  check('marking someone "Gelmedi" updates the summary', await page.getByText(/2 kişi · 2 seans geldi/).isVisible());

  // walk-ins: Ali rowed both hours although he was in no boat; Jamie is added and removed again
  const addPerson = async (n, search, name) => {
    await section(n).getByRole('button', { name: 'Kişi ekle' }).click();
    const d = page.getByRole('dialog');
    await d.getByRole('searchbox').fill(search);
    await d.getByRole('button', { name }).click();
    await d.getByRole('button', { name: 'Tamam' }).click();
  };
  await addPerson(1, 'ali', 'Ali Kaya');
  await addPerson(2, 'ali', 'Ali Kaya');
  check('walk-ins are added as present and marked "Ek kişi"', (await section(2).getByText('Ek kişi').isVisible()) && (await mark(section(2), 'Ali Kaya', 'Geldi').getAttribute('aria-checked')) === 'true');
  await addPerson(1, 'jamie', 'Jamie');
  await page.getByRole('button', { name: 'Jamie listeden çıkar' }).click();
  check('a walk-in can be removed again (planned people can only be marked absent)', (await section(1).getByText('Jamie').count()) === 0 && (await page.getByRole('button', { name: 'Ashley listeden çıkar' }).count()) === 0);
  check('summary counts present hours: Ali rowed 2 hours = 2 sessions', await page.getByText(/3 kişi · 4 seans geldi/).isVisible());
  await shot(page, '29-attendance-walkins');

  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await page.getByText('Yoklama kaydedildi.').waitFor();
  check('progress saved (5 records incl. the absence) and the training is not completed yet', db.attendance.filter((a) => a.training_id === tA.id).length === 5 && tA.status === 'scheduled' && db.attendance.some((a) => a.member_id === ashley.id && a.status === 'absent'));
  check('the sheet says it is not in the statistics yet', await page.getByText('Henüz istatistiklere işlenmedi').isVisible());

  // in-progress attendance never counts
  {
    const { page: mp, ctx: mc } = await memberStatsPage();
    await mp.goto(BASE + '/uye/istatistik');
    await mp.getByText(/Bu ay henüz kimse kürek çekmedi/).waitFor();
    check('statistics ignore attendance that is not completed (everybody is listed with 0)', (await mp.locator('main ol li').count()) >= 1 && (await mp.getByRole('img', { name: 'henüz sıralamada değil' }).count()) === (await mp.locator('main ol li').count()));
    await mc.close();
  }

  await page.getByRole('button', { name: 'Yoklamayı tamamla' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Evet, tamamla' }).click();
  await page.getByText('Yoklama tamamlandı.').waitFor();
  await page.getByText('Tamamlandı — istatistiklere işlendi').waitFor();
  check('completing marks the training completed', tA.status === 'completed');

  await mark(section(1), 'Ashley', 'Geldi').click();
  await page.getByRole('button', { name: 'Güncelle' }).click();
  await page.getByText('Yoklama güncellendi.').waitFor();
  check('a completed attendance can still be corrected', db.attendance.find((a) => a.member_id === ashley.id && a.training_id === tA.id).status === 'present' && tA.status === 'completed');

  // coach history list
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Antrenmanlar', exact: true }).click();
  await page.getByRole('tab', { name: 'Geçmiş' }).click();
  await page.getByText('4 kişi · 5 seans').waitFor();
  check('past trainings show who came: "4 kişi · 5 seans"', (await page.getByText('1 kişi · 1 seans').isVisible()));

  // coach statistics for the month
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'İstatistik', exact: true }).click();
  await page.getByText(labelOf(currentMonth)).waitFor();
  await page.getByText('4 üye · toplam 5 seans').waitFor();
  const rowsText = await page.locator('main ul li').allInnerTexts();
  check('every active member is listed, most sessions first (Ali 2, then the 1-session tie)', rowsText[0].includes('Ali Kaya') && rowsText[0].startsWith('1') && rowsText.slice(1, 4).every((t) => t.startsWith('2')) && rowsText.slice(4).every((t) => t.startsWith('–')), rowsText.map((t) => t.replace(/\s+/g, ' ')).join(' | '));
  await shot(page, '30-coach-stats');

  await page.getByRole('link', { name: /Ali Kaya/ }).click();
  await page.getByRole('heading', { name: 'Ali Kaya' }).waitFor();
  await page.getByText('Katıldığı antrenmanlar').waitFor();
  check('member history: 2 sessions this month', (await page.locator('main .text-4xl').innerText()) === '2');
  check('member history lists the training with both of Ali\'s hours', (await page.locator('main section li ul li').count()) === 2);
  await shot(page, '31-coach-member-history');
  await page.getByRole('button', { name: 'Önceki ay' }).click();
  await page.getByText(labelOf(prevMonth)).waitFor();
  check('last month is one click away and shows its own history', (await page.locator('main section li ul li').count()) === 1);
  await page.getByRole('link', { name: 'İstatistik' }).first().click();

  // CSV exports (Excel-friendly)
  const [summaryDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Özet (CSV)' }).click()]);
  const summary = readFileSync(await summaryDownload.path(), 'utf8');
  check('summary CSV: BOM, ";" separators, Turkish header, one line per member', summaryDownload.suggestedFilename() === `yoklama-ozet-${currentMonth}.csv` && summary.startsWith(String.fromCharCode(0xfeff)) && summary.includes('Sıra;Ad Soyad;Seans;Antrenman günü') && summary.includes('1;Ali Kaya;2;1'), JSON.stringify(summary.slice(0, 120)));
  const [detailDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Ayrıntılı (CSV)' }).click()]);
  const detail = readFileSync(await detailDownload.path(), 'utf8');
  check('detail CSV: one line per person per hour, absences included', detail.includes('Tarih;Seans saati;Ad Soyad;Durum;Not') && detail.split('\r\n').filter((l) => l.includes(';Geldi;')).length === 5, `${detail.split('\r\n').length} lines`);

  check('attendance: no unexpected errors (coach)', problems.length === 0, problems.join(' | '));
  await ctx.close();

  // the member's side
  {
    const { page: mp, ctx: mc, problems: mprob } = await memberStatsPage('dark');
    await mp.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'İstatistik', exact: true }).click();
    await mp.getByText('1. sıra · 4 kişi arasında').waitFor();
    const myCard = await mp.locator('main section').first().innerText();
    const flat = myCard.split(/\s+/).join(' ');
    check('my month: 2 sessions, 1 training day, rank 1 of 4', flat.includes('2 seans') && flat.includes('1 antrenman günü'), flat);
    const board = mp.locator('main ol li');
    check('leaderboard: I am first (marked "Siz"); the others share second place', (await board.first().innerText()).includes('Ali Kaya') && (await board.first().getByText('Siz').isVisible()) && (await board.count()) === roster.filter((r) => r.role === 'member' && r.is_active).length && (await mp.getByText('eşit').count()) >= 3);
    const unrankedRows = mp.locator('main ol li', { has: mp.getByRole('img', { name: 'henüz sıralamada değil' }) });
    check('leaderboard: members without a session are listed too — last, with "–" instead of a place and 0 seans', (await unrankedRows.count()) >= 1 && (await unrankedRows.first().innerText()).replace(/\s+/g, ' ').includes('0 seans') && (await board.last().getByRole('img', { name: 'henüz sıralamada değil' }).count()) === 1);
    check('the leaderboard shows names and counts only, no phone numbers or usernames', !(await mp.locator('main ol').innerText()).match(/@|\d{3} \d{3}/));
    await shot(mp, '32-member-stats-dark');
    check('I cannot go past the current month', await mp.getByRole('button', { name: 'Sonraki ay' }).isDisabled());
    await mp.getByRole('button', { name: 'Önceki ay' }).click();
    await mp.getByText(labelOf(prevMonth)).waitFor();
    await mp.getByText('1. sıra · 1 kişi arasında').waitFor();
    check('past months stay browsable and each month stands alone (the board "resets")', await mp.getByRole('button', { name: 'Sonraki ay' }).isEnabled());

    await mp.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Antrenmanlar', exact: true }).click();
    await mp.getByRole('tab', { name: 'Geçmiş' }).click();
    await mp.getByText('2 seans katıldınız').waitFor();
    check('history: each finished training shows how many hours I rowed', await mp.getByText('1 seans katıldınız').first().isVisible());
    const matched = await mp.getByText('Eski antrenman', { exact: true }).evaluateAll((els) => els.map((e) => e.outerHTML.slice(0, 160)));
    check('history: only the last 90 days at first', matched.length === 0, matched.join(' | '));
    await mp.getByRole('button', { name: 'Daha eski antrenmanları göster' }).click();
    await mp.getByText('Eski antrenman', { exact: true }).waitFor();
    check('"Daha eski" loads older history, with my attendance there too', (await mp.getByText('1 seans katıldınız').count()) === 2);
    await mp.getByRole('link', { name: /Yoklama antrenmanı/ }).click();
    const mine = mp.getByRole('region', { name: 'Yoklamanız' });
    await mine.waitFor();
    check('detail: my attendance per hour', (await mine.getByText('Katıldınız').count()) === 2);
    await shot(mp, '33-member-attendance-dark');
    check('member attendance: no unexpected errors', mprob.length === 0, mprob.join(' | '));
    await mc.close();
  }
}

// ---------- 9. weather, notification inbox, club settings ----------
{
  const now = Date.now();
  const at8 = (days) => Date.parse(`${istanbulDate(now + days * 24 * HOUR)}T08:00:00+03:00`);
  db.trainings = [];
  db.responses = [];
  db.programs = {};
  db.saves = [];
  db.saveNotify = [];
  db.notifications = [];
  db.weather = {};
  db.weatherRefreshes = [];
  db.settingsSaves = [];
  db.settings.wind_gust_warn_kmh = null;
  db.settings.wave_warn_m = null;
  const ali = people.member;
  const t = makeTraining({ title: 'Hava antrenmanı', starts_at: iso(at8(2)), slot_count: 2, rsvp_deadline: iso(at8(1)) });
  db.trainings.push(t);
  // hour 1 is calm; hour 2 is gusty and choppy
  db.weather[t.id] = [weatherRow(t.id, 0, Date.parse(t.starts_at)), weatherRow(t.id, 1, Date.parse(t.starts_at), { gust_kmh: 38, wind_kmh: 27, wave_height_m: 1.4, weather_code: 63, precip_prob: 70 })];
  db.responses.push({ training_id: t.id, member_id: ali.id, response: 'attending', note: null, responded_at: iso(now), set_by_coach: false });
  db.programs[t.id] = {
    program: { training_id: t.id, status: 'published', version: 1, weather_note: null, training_notes: null, published_at: iso(now), published_by: people.coach.id, created_at: '', updated_at: '' },
    assignments: [{ id: 'as-w1', training_id: t.id, slot_index: 0, boat_id: 'boat-1', notes: null }],
    crew: [{ assignment_id: 'as-w1', training_id: t.id, slot_index: 0, member_id: ali.id, seat: 1 }],
  };
  const notice = (id, type, title, body, ageMin, read) => ({
    id, user_id: ali.id, type, training_id: t.id, title, body, url: `/uye/antrenmanlar/${t.id}`, dedupe_key: id, created_at: iso(now - ageMin * 60_000), read_at: read ? iso(now) : null, push_done_at: null, push_attempts: 0, push_error: null,
  });
  db.notifications.push(
    notice('n-1', 'program_published', 'Programınız yayınlandı', 'Mavi · 08:00–09:00', 5, false),
    notice('n-2', 'training_new', 'Yeni antrenman', 'Perşembe 08:00 · Yanıt için son zaman: yarın', 90, false),
    notice('n-3', 'training_changed', 'Antrenman değişti', 'Başlangıç saati güncellendi', 60 * 30, true),
  );

  const signIn = async (page, user, password) => {
    await page.goto(BASE + '/giris');
    await page.getByLabel('Kullanıcı adı').fill(user);
    await page.getByLabel('Şifre').fill(password);
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await page.waitForURL(user === 'ayse' ? '**/antrenor' : '**/uye');
  };

  // ---- the coach ----
  const { page, ctx, problems } = await newPage();
  await signIn(page, 'ayse', 'Coach1234');
  await page.getByRole('link', { name: 'Bildirimler', exact: true }).waitFor();
  check('coach: bell without unread messages has no count', (await page.getByRole('link', { name: /okunmamış/ }).count()) === 0);

  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Diğer', exact: true }).click();
  await page.getByRole('link', { name: 'Kulüp ayarları' }).click();
  await page.getByRole('heading', { name: 'Kulüp ayarları' }).waitFor();
  check('settings: shows the current values', (await page.getByLabel('Varsayılan yanıt süresi (saat)').inputValue()) === '12' && (await page.getByLabel('Hatırlatma zamanı (saat)').inputValue()) === '3' && (await page.getByLabel('Rüzgâr hamlesi uyarı eşiği (km/s)').inputValue()) === '');
  await page.getByLabel('Hatırlatma zamanı (saat)').fill('30');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  check('settings: an out-of-range value is refused with a Turkish message and nothing is sent', (await page.getByText('1 ile 24 arasında olmalı.').isVisible()) && db.settingsSaves.length === 0);
  await page.getByLabel('Hatırlatma zamanı (saat)').fill('3');
  await page.getByLabel('Rüzgâr hamlesi uyarı eşiği (km/s)').fill('30');
  await page.getByLabel('Dalga yüksekliği uyarı eşiği (m)').fill('1,0');
  await shot(page, '34-settings');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.getByText('Ayarlar kaydedildi.').waitFor();
  check('settings: saved with numbers (decimal comma accepted)', JSON.stringify(db.settingsSaves.at(-1)) === JSON.stringify({ default_rsvp_lead_hours: 12, reminder_lead_hours: 3, wind_gust_warn_kmh: 30, wave_warn_m: 1 }), JSON.stringify(db.settingsSaves.at(-1)));

  await page.goto(BASE + `/antrenor/antrenmanlar/${t.id}`);
  const strip = page.getByRole('region', { name: 'Hava durumu' });
  await strip.waitFor();
  check('coach detail: forecast per hour with wind, gust and waves', (await strip.getByText('08:00–09:00', { exact: true }).isVisible()) && (await strip.getByText('09:00–10:00', { exact: true }).isVisible()) && (await strip.getByText(/hamle 24 km\/s/).isVisible()) && (await strip.getByText(/dalga 0,6 m/).isVisible()));
  check('coach detail: attribution and forecast time', (await strip.getByRole('link', { name: 'Open-Meteo' }).isVisible()) && (await strip.getByText(/Tahmin: \d\d:\d\d/).isVisible()));
  const advisory = strip.getByRole('alert');
  check('coach detail: only the gusty hour warns (thresholds are coach-set, nothing is cancelled)', (await advisory.getByText(/09:00–10:00: Rüzgâr hamlesi 38 km\/s \(eşik 30\)/).isVisible()) && (await advisory.getByText(/09:00–10:00: Dalga 1,4 m \(eşik 1\)/).isVisible()) && !(await advisory.getByText('08:00–09:00').isVisible()) && (await advisory.getByText(/Karar antrenöre aittir/).isVisible()));
  await shot(page, '35-coach-weather-advisory');
  await strip.getByRole('button', { name: 'Yenile' }).click();
  await page.getByText('Hava durumu güncellendi.').waitFor();
  check('coach can refresh the forecast on demand', db.weatherRefreshes.at(-1) === t.id);

  // the editor shows each hour's forecast under its tab
  await page.getByRole('tab', { name: 'Program' }).click();
  await page.getByText('Yayında (sürüm 1)').waitFor();
  const slotTabs = page.getByRole('tablist', { name: 'Seanslar' }).getByRole('tab');
  const alerts = () => page.getByRole('alert').count();
  const beforeSecond = await alerts();
  await slotTabs.nth(1).click();
  check('program editor: the gusty hour shows its own warning, the calm hour does not', (await alerts()) === beforeSecond + 1);
  await slotTabs.nth(0).click();
  check('program editor: back on the calm hour the extra warning is gone', (await alerts()) === beforeSecond);

  // "notify" choice travels with the save
  const notifyBox = page.getByRole('checkbox', { name: /Üyelere bildirim gönder/ });
  check('program editor: notifying is on by default', await notifyBox.isChecked());
  await page.getByLabel('Antrenman notu').fill('Isınma 10 dk');
  await page.getByRole('button', { name: 'Güncelle' }).click();
  await page.getByText('Program güncellendi.').waitFor();
  await notifyBox.uncheck();
  await page.getByLabel('Antrenman notu').fill('Isınma 15 dk');
  await page.getByRole('button', { name: 'Güncelle' }).click();
  await page.getByText('Yayında (sürüm 3)').waitFor();
  check('program editor: p_notify true by default, false when the coach unticks it', JSON.stringify(db.saveNotify) === JSON.stringify([true, false]), JSON.stringify(db.saveNotify));

  // inbox is per person: Ali's messages are not in the coach's inbox
  await page.goto(BASE + '/antrenor/bildirimler');
  await page.getByText('Henüz bildirim yok').waitFor();
  check('coach inbox is empty (each person only sees their own messages)', (await page.getByText('Programınız yayınlandı').count()) === 0);
  check('coach: no unexpected errors', problems.length === 0, problems.join(' | '));
  await ctx.close();

  // ---- the member ----
  {
    const { page: mp, ctx: mc, problems: mprob } = await newPage('dark');
    await signIn(mp, 'ali', 'Kurek2026x');
    const bell = mp.getByRole('link', { name: 'Bildirimler, 2 okunmamış' });
    await bell.waitFor();
    check('member: bell shows the unread count (2)', (await bell.innerText()).trim() === '2');
    const mstrip = mp.getByRole('region', { name: 'Hava durumu' });
    await mstrip.waitFor();
    check('member home: sees the forecast', (await mstrip.getByText(/hamle 24 km\/s/).isVisible()) && (await mstrip.getByText(/Bofor \d/).first().isVisible()));
    check('member: never sees the coach warning or the refresh button', (await mstrip.getByRole('alert').count()) === 0 && (await mp.getByText('uyarı eşiği aşıldı').count()) === 0 && (await mstrip.getByRole('button', { name: 'Yenile' }).count()) === 0);
    await shot(mp, '36-member-home-weather-dark');

    await bell.click();
    await mp.getByRole('heading', { name: 'Bildirimler' }).waitFor();
    check('inbox: newest first, unread ones marked', (await mp.locator('main ul li').allInnerTexts()).map((s) => s.split('\n')[0]).join('|').startsWith('Programınız yayınlandı') && (await mp.getByText('(Okunmadı)').count()) === 2);
    check('inbox: relative times in Turkish', (await mp.getByText('5 dk önce').isVisible()) && (await mp.getByText('1 sa önce').isVisible()));
    await shot(mp, '37-member-inbox-dark');

    await mp.getByRole('button', { name: /Programınız yayınlandı/ }).click();
    await mp.waitForURL(`**/uye/antrenmanlar/${t.id}`);
    check('opening a message goes to its training and marks it read', db.notifications.find((n) => n.id === 'n-1').read_at !== null && db.notifications.find((n) => n.id === 'n-2').read_at === null);
    await mp.goBack();
    await mp.waitForFunction(() => document.querySelectorAll('main ul li .sr-only').length === 1);
    check('back in the inbox exactly one message is still unread', (await mp.getByText('(Okunmadı)').count()) === 1);
    await mp.getByRole('button', { name: 'Tümünü okundu yap' }).click();
    await mp.getByRole('button', { name: 'Tümünü okundu yap' }).waitFor({ state: 'detached' });
    check('"Tümünü okundu yap" clears the rest', db.notifications.every((n) => n.read_at !== null));
    await mp.getByRole('link', { name: 'Ana Sayfa' }).first().click();
    await mp.getByRole('link', { name: 'Bildirimler', exact: true }).waitFor();
    check('the bell has no count once everything is read', true);

    // profile also links to the inbox
    await mp.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Profil', exact: true }).click();
    await mp.getByRole('link', { name: 'Bildirim kutusu' }).click();
    await mp.getByRole('heading', { name: 'Bildirimler' }).waitFor();
    check('profile links to the inbox', mp.url().endsWith('/uye/bildirimler'));

    // a member cannot reach the coach's club settings
    await mp.goto(BASE + '/antrenor/diger/ayarlar');
    await mp.waitForURL('**/uye');
    check('member cannot open club settings', true);
    check('member weather/inbox: no unexpected errors', mprob.length === 0, mprob.join(' | '));
    await mc.close();
  }
}

// ---------- 10. coach feedback round: sessions added while planning, full C4X, RSVP lock, phone numbers ----------
{
  const now = Date.now();
  const at8 = (days) => Date.parse(`${istanbulDate(now + days * 24 * HOUR)}T08:00:00+03:00`);
  db.trainings = [];
  db.responses = [];
  db.programs = {};
  db.saves = [];
  db.saveNotify = [];
  db.attendance = [];
  db.attendanceSaves = [];
  db.weather = {};
  db.notifications = [];
  db.boats.forEach((b) => (b.is_active = true));
  const person = (username) => roster.find((p) => p.username === username);
  const [alex, ashley, john, jamie] = ['alex', 'ashley', 'john', 'jamie'].map(person);
  const ali = people.member;
  alex.phone = '0555 111 22 33';
  ashley.phone = null;
  john.phone = '+90 532 000 11 22';
  jamie.phone = '0544 987 65 43';
  const t = makeTraining({ title: 'Yeni kurallar', starts_at: iso(at8(4)), slot_count: 0, rsvp_deadline: iso(at8(3)) });
  db.trainings.push(t);
  for (const m of [alex, ashley, john, jamie]) db.responses.push({ training_id: t.id, member_id: m.id, response: 'attending', note: null, responded_at: iso(now), set_by_coach: false });
  const answerOfAli = () => db.responses.find((r) => r.training_id === t.id && r.member_id === ali.id);

  const signIn = async (pg, user, password) => {
    await pg.goto(BASE + '/giris');
    await pg.getByLabel('Kullanıcı adı').fill(user);
    await pg.getByLabel('Şifre').fill(password);
    await pg.getByRole('button', { name: 'Giriş yap' }).click();
    await pg.waitForURL(user === 'ayse' ? '**/antrenor' : '**/uye');
  };

  // ---- a member has the page open BEFORE the program exists ----
  const member = await newPage('dark');
  const mp = member.page;
  await signIn(mp, 'ali', 'Kurek2026x');
  await mp.getByText('08:00 · süre program hazırlanınca belli olur').first().waitFor();
  check('a training without a program shows only its start time (its length is decided by the program)', true);
  await mp.getByRole('radio', { name: 'Katılıyorum' }).click();
  await mp.getByText('Yanıtınız kaydedildi.').waitFor();
  check('before the program is published the member can answer', answerOfAli()?.response === 'attending');

  // ---- the coach plans the training: sessions are added while preparing the program ----
  const { page, ctx, problems } = await newPage();
  await signIn(page, 'ayse', 'Coach1234');
  await page.goto(BASE + `/antrenor/antrenmanlar/${t.id}`);
  await page.getByRole('tab', { name: 'Program' }).click();
  await page.getByText('Taslak — üyeler görmüyor').waitFor();
  const tabs = page.getByRole('tablist', { name: 'Seanslar' }).getByRole('tab');
  check('a new training starts with one session, and the editor explains that sessions are added here', (await tabs.count()) === 1 && (await page.getByText(/Antrenman kaç saat sürecekse o kadar seans ekleyin/).isVisible()));
  await page.getByRole('button', { name: 'Seans ekle' }).click();
  await page.getByRole('button', { name: 'Seans ekle' }).click();
  check('"Seans ekle" adds sessions one by one (08:00, 09:00, 10:00) and jumps to the new one', (await tabs.allTextContents()).join(',') === '08:00,09:00,10:00' && (await page.getByRole('tab', { name: '10:00', selected: true }).isVisible()) && (await page.getByText('Antrenman şu an 3 seans (3 saat) sürüyor.').isVisible()));
  await shot(page, '38-program-add-sessions');

  // ---- the C4X must have exactly four people ----
  await tabs.nth(0).click();
  const boat = (name) => page.getByRole('group', { name, exact: true });
  const openPicker = async (name) => {
    await boat(name).getByRole('button', { name: /Ekip seç|Ekibi düzenle/ }).click();
    return page.getByRole('dialog');
  };
  check('the C4X card says it needs exactly four people', await boat('C4X').getByText('Tam 4 kişi gerekli').isVisible());
  let d = await openPicker('C4X');
  for (const name of [/Alex/, /Ashley/, /John/]) await d.getByRole('checkbox', { name }).click();
  await d.getByRole('button', { name: 'Tamam' }).click();
  const publishButton = page.getByRole('button', { name: 'Yayınla', exact: true });
  await page.getByText('Yayınlanamıyor: eksik veya fazla ekip').waitFor();
  check('a C4X with three people cannot be published: the warning names boat, hour and head count, and the button is disabled', (await page.getByText('C4X, 1. seans: 3/4 kişi — tam 4 kişi olmalı.').isVisible()) && (await publishButton.isDisabled()));
  await shot(page, '39-c4x-needs-four');

  await page.getByRole('button', { name: 'Taslağı kaydet' }).click();
  await page.getByText('Taslak kaydedildi.').waitFor();
  check('an incomplete C4X can still be saved as a draft; the empty sessions at the end do not count (the training is 1 session)', db.programs[t.id].program.status === 'draft' && t.slot_count === 1, `slot_count=${t.slot_count}`);

  d = await openPicker('C4X');
  await d.getByRole('checkbox', { name: /Jamie/ }).click();
  await d.getByRole('button', { name: 'Tamam' }).click();
  check('with the fourth person the warning is gone and publishing is allowed', (await page.getByText('Yayınlanamıyor: eksik veya fazla ekip').count()) === 0 && (await publishButton.isEnabled()));

  // hour 2: Mavi = Ali + Ashley; hour 3 gets a crew, then the coach takes the last session back
  await tabs.nth(1).click();
  d = await openPicker('Mavi');
  await d.getByRole('checkbox', { name: /Ali Kaya/ }).click();
  await d.getByRole('checkbox', { name: /Ashley/ }).click();
  await d.getByRole('button', { name: 'Tamam' }).click();
  await tabs.nth(2).click();
  d = await openPicker('Turuncu');
  await d.getByRole('checkbox', { name: /Ashley/ }).click();
  await d.getByRole('button', { name: 'Tamam' }).click();
  await page.getByRole('button', { name: 'Son seansı kaldır' }).click();
  await page.getByRole('dialog').getByRole('heading', { name: 'Son seans kaldırılsın mı?' }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Evet, kaldır' }).click();
  check('removing a session that has a crew asks first; the session (and its crew) is gone afterwards', (await tabs.count()) === 2);

  await publishButton.click(); // everybody who answered is placed, so no "are you sure?" is needed
  await page.getByText('Program yayınlandı.').waitFor();
  check('published: the training is exactly 2 sessions long — derived from the program, not chosen up front', t.slot_count === 2 && db.programs[t.id].program.status === 'published', `slot_count=${t.slot_count}`);

  // ---- the member who still has the old page open is refused; the screen then locks ----
  await mp.getByRole('radio', { name: 'Katılmıyorum' }).click();
  await mp.getByRole('heading', { name: 'Program yayınlandı, yanıtlar kilitlendi' }).waitFor();
  check('a stale page cannot change the answer after publishing (the server refuses), and the card switches to the locked state', answerOfAli()?.response === 'attending' && (await mp.getByRole('radio').count()) === 0);
  await mp.reload();
  const c4x = mp.getByRole('region', { name: /^C4X( Sizin tekneniz)?$/ });
  const mavi = mp.getByRole('region', { name: /^Mavi( Sizin tekneniz)?$/ });
  await c4x.waitFor();
  check('the member sees every boat with its whole crew: the C4X has four names', (await Promise.all(['Alex', 'Ashley', 'John', 'Jamie'].map((n) => c4x.getByText(n).isVisible()))).every(Boolean));
  check('the length is known now: 08:00–10:00 · 2 seans', await mp.getByText('08:00–10:00 · 2 seans').first().isVisible());
  check('only my own session (Mavi, 09:00–10:00) is highlighted', (await mavi.getByText('Sizin seansınız').count()) === 1 && (await c4x.getByText('Sizin seansınız').count()) === 0 && (await mavi.getByText('09:00–10:00').isVisible()));
  check('the boat I row in (Mavi) is listed before the C4X, tagged "Sizin tekneniz"', (await mavi.boundingBox()).y < (await c4x.boundingBox()).y && (await mavi.getByText('Sizin tekneniz').isVisible()) && (await c4x.getByText('Sizin tekneniz').count()) === 0);
  check('the C4X shows the four-seat icon and Mavi the two-seat icon', (await c4x.locator('svg[data-boat="quad"]').count()) === 1 && (await mavi.locator('svg[data-boat="double"]').count()) === 1);
  await shot(mp, '40-member-by-boat-dark', true);

  // ---- phone numbers of the other members ----
  await c4x.getByRole('button', { name: 'Alex — telefon numarasını göster' }).click();
  const callLink = mp.getByRole('link', { name: /^Ara: Alex/ });
  await callLink.waitFor();
  check("tapping a crew member's name shows their phone number with a call link", (await callLink.getAttribute('href')) === 'tel:05551112233' && (await callLink.innerText()).includes('0555 111 22 33'));
  check('the contact card also offers "Profili aç"', (await mp.getByRole('dialog').getByRole('link', { name: 'Alex profilini aç' }).getAttribute('href')) === `/uye/uyeler/${alex.id}`);
  await shot(mp, '41-contact-dialog-dark');
  await mp.getByRole('dialog').getByRole('button', { name: 'Kapat' }).click();
  await c4x.getByRole('button', { name: 'Ashley — telefon numarasını göster' }).click();
  await mp.getByText('Bu üye için telefon numarası eklenmemiş.').waitFor();
  check('a member without a saved number says so instead of a dead link', (await mp.getByRole('link', { name: /^Ara:/ }).count()) === 0);
  await mp.getByRole('dialog').getByRole('button', { name: 'Kapat' }).click();
  check('my own name in the crew is plain text (no phone card for myself)', (await mavi.getByRole('button', { name: /Ali Kaya/ }).count()) === 0);

  await mp.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Profil', exact: true }).click();
  await mp.getByRole('link', { name: 'Kulüp üyeleri' }).click();
  await mp.getByRole('heading', { name: 'Kulüp üyeleri' }).waitFor();
  await mp.getByText('Jamie', { exact: true }).waitFor();
  const directoryText = await mp.locator('main').innerText();
  check('the member directory lists every active member with their phone number', ['Alex', 'Ashley', 'Çağla Şahin', 'Jamie', 'John', '0555 111 22 33', '0544 987 65 43'].every((x) => directoryText.includes(x)) && !directoryText.includes('Eski Üye'));
  check('...and nothing else about them (no usernames)', !/@|ayse|cagla/.test(directoryText));
  check('numbers are call links (international format tidied)', (await mp.getByRole('link', { name: 'John kişisini ara' }).getAttribute('href')) === 'tel:+905320001122');
  await mp.getByRole('searchbox').fill('jam');
  check('the directory can be searched by name', (await mp.locator('main ul li').count()) === 1 && (await mp.getByText('Jamie').isVisible()));
  await shot(mp, '42-member-directory-dark');

  // ---- taking the program back opens the answers again ----
  await page.getByRole('button', { name: 'Yayından kaldır' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yayından kaldır' }).click();
  await page.getByText('Program yayından kaldırıldı.').waitFor();
  await mp.goto(BASE + '/uye');
  await mp.getByRole('radio', { name: 'Katılmıyorum' }).waitFor();
  check('when the coach takes the program back to a draft the member can answer again', true);

  // ---- boats: the "must be full" switch ----
  await page.goto(BASE + '/antrenor/diger/tekneler');
  await page.getByText('4 kişilik · Tam kadro').waitFor();
  check('the boat list marks the C4X as "Tam kadro"', (await page.getByText('2 kişilik · Tam kadro').count()) === 0);
  await page.getByRole('button', { name: /Mavi/ }).click();
  const boatDialog = page.getByRole('dialog');
  check('the boat form has the switch, off for Mavi', (await boatDialog.getByLabel('Tam kadro zorunlu').isChecked()) === false);
  await boatDialog.getByLabel('Tam kadro zorunlu').check();
  await boatDialog.getByRole('button', { name: 'Kaydet' }).click();
  await page.getByText('2 kişilik · Tam kadro').waitFor();
  check('a coach can require a full crew for another boat', db.boats.find((b) => b.name === 'Mavi').requires_full_crew === true);
  db.boats.find((b) => b.name === 'Mavi').requires_full_crew = false;

  // ---- attendance without a program: the sheet can be extended by a session ----
  const started = makeTraining({ title: 'Uzun antrenman', starts_at: iso(now - HOUR), slot_count: 0, rsvp_deadline: iso(now - 25 * HOUR) });
  db.trainings.push(started);
  for (const m of [ali, alex]) db.responses.push({ training_id: started.id, member_id: m.id, response: 'attending', note: null, responded_at: iso(now), set_by_coach: false });
  await page.goto(BASE + `/antrenor/antrenmanlar/${started.id}`);
  await page.getByRole('tab', { name: 'Yoklama' }).click();
  const section = (n) => page.getByRole('region', { name: new RegExp(`^${n}\\. seans`) });
  await section(1).getByText('Ali Kaya').waitFor();
  check('a training whose length was never planned starts its attendance sheet with one session (from the answers)', (await section(2).count()) === 0);
  await page.getByRole('button', { name: 'Seans ekle' }).click();
  check('"Seans ekle" carries the people over as present in a second session', (await section(2).getByText('Ali Kaya').isVisible()) && (await section(2).getByText('Alex').isVisible()));
  await page.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await page.getByText('Yoklama kaydedildi.').waitFor();
  check('saving extends the training to 2 sessions and records both', started.slot_count === 2 && db.attendance.filter((a) => a.training_id === started.id).length === 4, `slot_count=${started.slot_count}`);

  check('coach feedback round: no unexpected errors (coach)', problems.length === 0, problems.join(' | '));
  check('coach feedback round: no unexpected errors (member)', member.problems.length === 0, member.problems.join(' | '));
  await ctx.close();
  await member.ctx.close();
}

// ---------- 11. audit log, keyboard / screen-reader support, going offline ----------
{
  const now = Date.now();
  const at8 = (days) => Date.parse(`${istanbulDate(now + days * 24 * HOUR)}T08:00:00+03:00`);
  db.trainings = [];
  db.responses = [];
  db.programs = {};
  db.weather = {};
  db.notifications = [];
  db.settingsSaves = [];
  db.settings.wind_gust_warn_kmh = null;
  db.settings.wave_warn_m = null;
  const coach = people.coach;
  let auditId = 1;
  const entry = (minutesAgo, category, action, summary, detail = {}, actor = 'Ayşe Yılmaz') => ({
    id: auditId++, at: iso(now - minutesAgo * 60_000), tx: auditId, actor_id: actor ? coach.id : null, actor_name: actor, category, action, entity: 'training', entity_id: null, summary, detail,
  });
  db.audit = [
    entry(5, 'program', 'program.publish', 'Program yayınlandı (sürüm 2): 23 Eylül Çarşamba 08:00', { version: 2 }),
    entry(20, 'training', 'training.edit', 'Antrenman düzenlendi: 23 Eylül Çarşamba 08:00', { fields: ['title', 'notes'] }),
    entry(30, 'attendance', 'attendance.save', 'Yoklama kaydedildi: 22 Eylül Salı 08:00', { count: 12 }),
    entry(26 * 60, 'settings', 'settings.update', 'Kulüp ayarları güncellendi', { fields: ['wind_gust_warn_kmh'] }, null),
    ...Array.from({ length: 55 }, (_, i) => entry(5000 + i, 'attendance', 'attendance.save', `Eski yoklama ${i + 1}`, { count: 3 })),
  ];

  const { page, ctx, problems } = await newPage();
  await page.goto(BASE + '/giris');
  await page.getByLabel('Kullanıcı adı').fill('ayse');
  await page.getByLabel('Şifre').fill('Coach1234');
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL('**/antrenor');

  // ---- keyboard: the skip link is the first tab stop and jumps to the content ----
  await page.getByRole('heading', { name: /Merhaba/ }).waitFor();
  await page.keyboard.press('Tab');
  check('the first Tab stop is "Ana içeriğe geç" and it becomes visible', (await page.evaluate(() => document.activeElement?.textContent)) === 'Ana içeriğe geç' && (await page.getByRole('link', { name: 'Ana içeriğe geç' }).isVisible()));
  await page.keyboard.press('Enter');
  check('activating it moves focus to the main content', (await page.evaluate(() => document.activeElement?.id)) === 'main');

  // ---- screen readers: a page change moves focus to the new heading and updates the title ----
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Diğer', exact: true }).click();
  await page.getByRole('link', { name: 'Değişiklik geçmişi' }).click();
  await page.getByRole('heading', { name: 'Değişiklik geçmişi', level: 1 }).waitFor();
  await page.waitForFunction(() => document.activeElement?.tagName === 'H1');
  check('after navigating, focus is on the new page heading (so it is announced)', (await page.evaluate(() => document.activeElement?.textContent)) === 'Değişiklik geçmişi');
  check('and the tab title follows the page', (await page.title()) === 'Değişiklik geçmişi · Yeni Mahalle Kürek', await page.title());

  // ---- the audit log itself ----
  await page.getByText('Program yayınlandı (sürüm 2): 23 Eylül Çarşamba 08:00').waitFor();
  check('entries are grouped by day, newest first, each with time, summary and who did it', (await page.locator('main h2').count()) >= 2 && (await page.locator('main li').first().innerText()).includes('Program yayınlandı (sürüm 2)') && (await page.getByText('Ayşe Yılmaz tarafından').first().isVisible()));
  check('an edit lists WHICH fields changed (never the values)', await page.getByText('Değişen: başlık, notlar').isVisible());
  check('merged entries show their count, and unknown actors are "Sistem"', (await page.getByText('12 kayıt').isVisible()) && (await page.getByText('Sistem tarafından').isVisible()));
  await shot(page, '43-audit-log');
  check('a full page offers older entries (50 shown)', (await page.locator('main li').count()) === 50 && (await page.getByRole('button', { name: 'Daha eski kayıtlar' }).isVisible()));
  await page.getByRole('button', { name: 'Daha eski kayıtlar' }).click();
  await page.waitForFunction(() => document.querySelectorAll('main li').length === 59);
  check('"Daha eski kayıtlar" loads the rest and the button goes away', (await page.getByRole('button', { name: 'Daha eski kayıtlar' }).count()) === 0);
  await page.getByRole('button', { name: 'Program', exact: true }).click();
  await page.getByText('Antrenman düzenlendi').waitFor({ state: 'detached' });
  check('the filter chips narrow the list (aria-pressed marks the active one)', (await page.locator('main li').count()) === 1 && (await page.getByRole('button', { name: 'Program', exact: true }).getAttribute('aria-pressed')) === 'true');
  await page.getByRole('button', { name: 'Üyeler', exact: true }).click();
  await page.getByText('Henüz kayıt yok').waitFor();
  check('a filter without entries shows the empty state', true);
  await page.getByRole('button', { name: 'Tümü', exact: true }).click();

  // ---- a member cannot open it ----
  const member = await newPage('dark');
  const mp = member.page;
  await mp.goto(BASE + '/giris');
  await mp.getByLabel('Kullanıcı adı').fill('ali');
  await mp.getByLabel('Şifre').fill('Kurek2026x');
  await mp.getByRole('button', { name: 'Giriş yap' }).click();
  await mp.waitForURL('**/uye');
  await mp.goto(BASE + '/antrenor/diger/gecmis');
  await mp.waitForURL('**/uye');
  check('members are sent away from the change history', true);

  // ---- keyboard: the RSVP radios (arrow keys move focus, Space/Enter chooses; only one tab stop) ----
  const open = makeTraining({ title: 'Klavye antrenmanı', starts_at: iso(at8(3)), slot_count: 1, rsvp_deadline: iso(at8(2)) });
  db.trainings.push(open);
  await mp.goto(BASE + '/uye');
  const yes = mp.getByRole('radio', { name: 'Katılıyorum' });
  const no = mp.getByRole('radio', { name: 'Katılmıyorum' });
  await yes.waitFor();
  check('the answer radios are ONE tab stop (roving tabindex)', (await mp.locator('[role="radiogroup"] [role="radio"][tabindex="0"]').count()) === 1);
  await yes.focus();
  await mp.keyboard.press('ArrowRight');
  check('ArrowRight moves focus to "Katılmıyorum" without saving anything', (await mp.evaluate(() => document.activeElement?.textContent)) === 'Katılmıyorum' && db.responses.length === 0);
  await mp.keyboard.press('Space');
  await mp.getByText('Yanıtınız kaydedildi.').waitFor();
  check('Space chooses it', db.responses[0]?.response === 'not_attending' && (await no.getAttribute('aria-checked')) === 'true');
  await mp.getByRole('radio', { name: 'Katılıyorum' }).focus();
  await mp.keyboard.press('ArrowLeft');
  check('arrow keys wrap around', (await mp.evaluate(() => document.activeElement?.textContent)) === 'Katılmıyorum');

  // ---- going offline in the middle of a form ----
  await page.goto(BASE + '/antrenor/diger/ayarlar');
  await page.getByLabel('Rüzgâr hamlesi uyarı eşiği (km/s)').fill('35');
  await ctx.setOffline(true);
  state.offline = true;
  await page.getByText('Çevrimdışısınız. Görünen bilgiler güncel olmayabilir.').waitFor();
  check('offline: a banner says so', true);
  await page.getByRole('button', { name: 'Kaydet' }).click();
  const offlineAlert = page.getByRole('alert').filter({ hasText: 'Bağlantı kurulamadı' });
  await offlineAlert.waitFor();
  check('offline: saving explains the connection problem in Turkish and keeps what was typed', (await page.getByLabel('Rüzgâr hamlesi uyarı eşiği (km/s)').inputValue()) === '35' && db.settingsSaves.length === 0);
  await shot(page, '44-offline-save');
  await ctx.setOffline(false);
  state.offline = false;
  await page.getByText('Çevrimdışısınız.').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.getByText('Ayarlar kaydedildi.').waitFor();
  check('back online the same form saves', db.settingsSaves.at(-1)?.wind_gust_warn_kmh === 35);
  db.settings.wind_gust_warn_kmh = null;

  check('history/keyboard/offline: no unexpected errors (coach)', problems.filter((p) => !/Failed to fetch|net::ERR/.test(p)).length === 0, problems.join(' | '));
  check('history/keyboard/offline: no unexpected errors (member)', member.problems.length === 0, member.problems.join(' | '));
  await ctx.close();
  await member.ctx.close();
}

// ---------- 12. help pages (members and coaches) ----------
{
  const member = await newPage('dark');
  const mp = member.page;
  await mp.goto(BASE + '/giris');
  await mp.getByLabel('Kullanıcı adı').fill('ali');
  await mp.getByLabel('Şifre').fill('Kurek2026x');
  await mp.getByRole('button', { name: 'Giriş yap' }).click();
  await mp.waitForURL('**/uye');
  await mp.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Profil', exact: true }).click();
  await mp.getByRole('link', { name: 'Yardım ve sık sorulan sorular' }).click();
  await mp.getByRole('heading', { name: 'Yardım', level: 1 }).waitFor();
  check('members find the help under Profil, with their own questions (not the coach ones)', (await mp.getByText('Şifremi unuttum.').isVisible()) && (await mp.getByText('Antrenmanı nasıl oluştururum?').count()) === 0);
  check('without a feedback address the page says to tell the coach', await mp.getByText('Görüşlerinizi antrenörünüze iletin.').isVisible());
  const question = mp.getByText('Yanıtımı neden değiştiremiyorum?');
  await question.click();
  await mp.getByText(/programı yayınlayınca kilitlenir/).waitFor();
  check('a question opens to show its answer', true);
  await mp.keyboard.press('Tab'); // keyboard users can move on; native <details> needs no scripting
  await shot(mp, '45-member-help-dark');

  const { page, ctx, problems } = await newPage();
  await page.goto(BASE + '/giris');
  await page.getByLabel('Kullanıcı adı').fill('ayse');
  await page.getByLabel('Şifre').fill('Coach1234');
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL('**/antrenor');
  await page.getByRole('navigation', { name: 'Ana gezinme' }).getByRole('link', { name: 'Diğer', exact: true }).click();
  await page.getByRole('link', { name: 'Yardım ve sık sorulan sorular' }).click();
  await page.getByRole('heading', { name: 'Yardım', level: 1 }).waitFor();
  check('coaches get the coach questions (training, program, attendance …)', (await page.getByText('Antrenmanı nasıl oluştururum?').isVisible()) && (await page.getByText('Yoklamayı nasıl alırım?').isVisible()) && (await page.getByText('Şifremi unuttum.').count()) === 0);
  await page.getByText('Programı nasıl hazırlar ve yayınlarım?').click();
  await page.getByText(/C4X tam 4 kişi olmadan yayınlanamaz/).waitFor();
  await shot(page, '46-coach-help');
  await page.getByRole('link', { name: /^Diğer/ }).first().click();
  await page.waitForURL('**/antrenor/diger');
  check('the way back leads to Diğer', true);

  check('help pages: no unexpected errors', problems.length === 0 && member.problems.length === 0, [...problems, ...member.problems].join(' | '));
  await ctx.close();
  await member.ctx.close();
}

// ---------- 13. another member's profile: phone + trained together (same boat only) ----------
{
  const now = Date.now();
  const byName = (n) => roster.find((p) => p.full_name === n);
  const ali = people.member;
  const [cagla, alex, jamie] = ['Çağla Şahin', 'Alex', 'Jamie'].map(byName);
  cagla.phone = '0532 111 22 33';
  db.trainings = [];
  db.responses = [];
  db.programs = {};
  db.attendance = [];
  db.notifications = [];
  db.weather = {};
  const at8 = (daysAgo) => Date.parse(`${istanbulDate(now - daysAgo * 24 * 3_600_000)}T08:00:00+03:00`);
  const publishedProgram = (t, assignments, crew) => {
    db.programs[t.id] = {
      program: { training_id: t.id, status: 'published', version: 1, weather_note: null, training_notes: null, published_at: iso(now - 300 * 3_600_000), published_by: people.coach.id, created_at: '', updated_at: '' },
      assignments: assignments.map(([id, slot, boat]) => ({ id, training_id: t.id, slot_index: slot, boat_id: boat, notes: null })),
      crew: crew.map(([assignment, slot, member, seat]) => ({ assignment_id: assignment, training_id: t.id, slot_index: slot, member_id: member.id, seat })),
    };
  };
  const present = (t, slot, member) => db.attendance.push({ training_id: t.id, slot_index: slot, member_id: member.id, status: 'present', note: null, recorded_by: people.coach.id, recorded_at: iso(now) });

  // T1 (3 days ago, 2 sessions): hour 1 Ali + Çağla in Mavi; hour 2 Ali in Turuncu with Alex
  const t1 = makeTraining({ title: 'Ortak antrenman', starts_at: iso(at8(3)), slot_count: 2, rsvp_deadline: iso(at8(4)), status: 'completed' });
  // T2 (10 days ago, 1 session, no title): Ali in Mavi, Çağla in Turuncu -> NOT shared
  const t2 = makeTraining({ title: null, starts_at: iso(at8(10)), slot_count: 1, rsvp_deadline: iso(at8(11)), status: 'completed' });
  db.trainings.push(t1, t2);
  publishedProgram(t1, [['as-1', 0, 'boat-1'], ['as-2', 1, 'boat-2']], [['as-1', 0, ali, 1], ['as-1', 0, cagla, 2], ['as-2', 1, ali, 1], ['as-2', 1, alex, 2]]);
  publishedProgram(t2, [['as-3', 0, 'boat-1'], ['as-4', 0, 'boat-2']], [['as-3', 0, ali, 1], ['as-4', 0, cagla, 1]]);
  for (const [t, slot, m] of [[t1, 0, ali], [t1, 0, cagla], [t1, 1, ali], [t1, 1, alex], [t2, 0, ali], [t2, 0, cagla]]) present(t, slot, m);
  // an upcoming training with a forecast, for the "my session" card
  const up = makeTraining({ title: 'Sıradaki', starts_at: iso(Date.parse(`${istanbulDate(now + 2 * 24 * 3_600_000)}T08:00:00+03:00`)), slot_count: 2, rsvp_deadline: iso(now + 24 * 3_600_000) });
  db.trainings.push(up);
  db.responses.push({ training_id: up.id, member_id: ali.id, response: 'attending', note: null, responded_at: iso(now), set_by_coach: false });
  publishedProgram(up, [['as-5', 0, 'boat-1'], ['as-6', 1, 'boat-1']], [['as-5', 0, jamie, 1], ['as-6', 1, ali, 1]]);
  db.weather[up.id] = [weatherRow(up.id, 0, Date.parse(up.starts_at)), weatherRow(up.id, 1, Date.parse(up.starts_at), { temperature_c: 23.6, wind_kmh: 27, gust_kmh: 38, wave_height_m: 1.4, weather_code: 63, precip_prob: 70 })];

  const { page: mp, ctx, problems } = await newPage('dark');
  await mp.goto(BASE + '/giris');
  await mp.getByLabel('Kullanıcı adı').fill('ali');
  await mp.getByLabel('Şifre').fill('Kurek2026x');
  await mp.getByRole('button', { name: 'Giriş yap' }).click();
  await mp.waitForURL('**/uye');

  // ---- weather for MY session's hour, next to it ----
  const mine = mp.getByRole('region', { name: 'Sizin programınız' });
  await mine.waitFor();
  const forMySession = mine.getByRole('group', { name: 'Hava durumu, 09:00–10:00' });
  await forMySession.waitFor();
  const forecastText = (await forMySession.innerText()).replace(/\s+/g, ' ');
  check("home: my card shows the forecast for MY hour (09:00–10:00: rain, 24°, 27 km/s wind, 1,4 m waves), not another hour's", /Yağmurlu/.test(forecastText) && forecastText.includes('24°') && forecastText.includes('27 km/s') && forecastText.includes('1,4 m'), forecastText);
  check('home: only my own hour has a forecast in the card (Jamie rows at 08:00, not me)', (await mine.getByRole('group').count()) === 1);
  const inBoat = mp.locator('li[data-mine="true"]').first();
  check('home: the same forecast is inside my highlighted row in the program by boat', (await inBoat.innerText()).replace(/\s+/g, ' ').includes('24°'));
  await shot(mp, '47-member-my-session-weather-dark', true);

  // ---- the directory: names are links to a profile (mine is plain) ----
  await mp.goto(BASE + '/uye/uyeler');
  await mp.getByRole('heading', { name: 'Kulüp üyeleri' }).waitFor();
  await mp.getByRole('link', { name: 'Çağla Şahin profilini aç' }).waitFor();
  check("directory: every name (except my own) opens that member's profile", (await mp.getByRole('link', { name: 'Ali Kaya profilini aç' }).count()) === 0 && (await mp.getByRole('link', { name: 'Alex profilini aç' }).count()) === 1);
  await mp.getByRole('link', { name: 'Çağla Şahin profilini aç' }).click();
  await mp.getByRole('heading', { name: 'Çağla Şahin', level: 1 }).waitFor();
  await mp.getByText('1 seans · 1 antrenman günü').waitFor();
  const cagPage = (await mp.locator('main').innerText()).replace(/\s+/g, ' ');
  check('profile: name, phone with a call link, and only the session in the SAME boat (08:00–09:00, Mavi)', (await mp.getByRole('link', { name: /^Ara: Çağla Şahin/ }).getAttribute('href')) === 'tel:05321112233' && cagPage.includes('08:00–09:00') && cagPage.includes('Mavi: 1'), cagPage);
  check('profile: the sessions where we sat in DIFFERENT boats are not listed', !cagPage.includes('09:00–10:00') && !cagPage.includes('Turuncu') && (await mp.locator('main ul li ul li').count()) === 1);
  check('profile: the training title is shown, no username or other private data', cagPage.includes('Ortak antrenman') && !/@|cagla/.test(cagPage));
  await shot(mp, '48-member-profile-dark', true);

  // ---- Alex: shared the second hour in Turuncu ----
  await mp.getByRole('link', { name: 'Kulüp üyeleri' }).click();
  await mp.getByRole('link', { name: 'Alex profilini aç' }).click();
  await mp.getByText('1 seans · 1 antrenman günü').waitFor();
  const alexPage = (await mp.locator('main').innerText()).replace(/\s+/g, ' ');
  check('profile: another member — the other hour, another boat', alexPage.includes('09:00–10:00') && alexPage.includes('Turuncu'));

  // ---- Jamie: never in my boat -> friendly empty state ----
  await mp.getByRole('link', { name: 'Kulüp üyeleri' }).click();
  await mp.getByRole('link', { name: 'Jamie profilini aç' }).click();
  await mp.getByRole('heading', { name: 'Henüz birlikte kürek çekmediniz' }).waitFor();
  check('profile: nobody shared -> an explanation instead of an empty list (phone still shown)', (await mp.getByRole('link', { name: /^Ara: Jamie/ }).count()) === 1);
  await shot(mp, '49-member-profile-empty-dark');

  // ---- unknown id and my own id ----
  await mp.goto(BASE + '/uye/uyeler/00000000-0000-4000-8000-000000000000');
  await mp.getByText('Bu üye bulunamadı.').waitFor();
  check('an unknown member id says so (no broken page)', true);
  await mp.goto(BASE + `/uye/uyeler/${ali.id}`);
  await mp.waitForURL('**/uye/profil');
  check('my own profile link leads to my profile page', true);

  // ---- the leaderboard: every member, names lead to their profile ----
  await mp.goto(BASE + '/uye/istatistik');
  await mp.getByRole('heading', { name: 'Aylık sıralama' }).waitFor();
  const rows = mp.locator('main ol li');
  const members = roster.filter((r) => r.role === 'member' && r.is_active).length;
  await rows.first().waitFor();
  check(`leaderboard: all ${members} active members are listed`, (await rows.count()) === members);
  await shot(mp, '50-member-leaderboard-everyone-dark');
  await mp.getByRole('link', { name: 'Çağla Şahin profilini aç' }).first().click();
  await mp.getByRole('heading', { name: 'Çağla Şahin', level: 1 }).waitFor();
  check("leaderboard: a name opens that member's profile", true);

  check('profiles: no unexpected errors', problems.length === 0, problems.join(' | '));
  await ctx.close();
}

// ---------- 4. PWA basics (service worker allowed) ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await ctx.route(`${SUPA}/**`, (route) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '[]' }));
  await page.goto(BASE + '/giris');
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { scope: reg.scope, active: Boolean(reg.active) };
  });
  check('service worker registers and activates', swState.active, JSON.stringify(swState));
  const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
  check('manifest is Turkish, standalone, with icons', manifest.lang === 'tr' && manifest.display === 'standalone' && manifest.icons.length >= 3);
  await page.reload(); // second visit: the worker now controls the page
  await page.evaluate(() => navigator.serviceWorker.ready);
  await ctx.setOffline(true);
  await page.reload();
  check('app shell loads while offline', await page.getByRole('heading', { name: 'Giriş yap' }).waitFor({ timeout: 5000 }).then(() => true, () => false));
  await ctx.close();
}

await browser.close();
if (a11yNotes.length) console.log('\naxe: minor/moderate findings (not failing):\n  ' + [...new Set(a11yNotes)].join('\n  '));
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
