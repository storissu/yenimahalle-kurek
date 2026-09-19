// Browser smoke test: a production build served by `vite preview` + a MOCKED Supabase backend, driven at phone size.
// It checks the whole Phase-1 UI flow (login, role routing, forced password change, member management,
// PWA install basics, offline shell) without needing a real backend.
//
//   npm run e2e            (expects the app built with dummy env and served on BASE_URL; see docs/RUNBOOK.md)
//   BASE_URL=http://localhost:4173  BROWSER_CHANNEL=msedge|chrome|  (empty = Playwright's bundled Chromium)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
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
const state = { current: null, log: [] };

// --- mocked Phase-2 backend: trainings, answers, boats, server clock -------------------------------
const HOUR = 3_600_000;
const db = {
  trainings: [],
  responses: [], // { training_id, member_id, response, note, responded_at, set_by_coach }
  boats: [
    { id: 'boat-1', name: 'Mavi', capacity: 2, is_active: true, sort_order: 1 },
    { id: 'boat-2', name: 'Turuncu', capacity: 2, is_active: true, sort_order: 2 },
    { id: 'boat-3', name: 'C4X', capacity: 4, is_active: true, sort_order: 3 },
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
db.saves = []; // payloads received by save_program
const dbError = (route, code, message, status = 400) => json(route, { code, details: null, hint: null, message }, status);
const istanbulDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(ms));
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
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
    if (path === '/rest/v1/club_settings') return json(route, { id: true, club_name: 'Kulüp', timezone: 'Europe/Istanbul', site_name: 'Ereğli', site_lat: 41.285318, site_lng: 31.407823, default_rsvp_lead_hours: 12, wind_gust_warn_kmh: null, wave_warn_m: null, updated_at: '' });

    if (path === '/rest/v1/trainings') {
      if (req.method() === 'GET') {
        const id = eqParam('id');
        return json(route, db.trainings.filter((t) => !id || t.id === id));
      }
      if (req.method() === 'POST') {
        const t = makeTraining(body());
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
      return json(route, roster.filter((p) => p.role === 'member' && p.is_active).map((p) => ({ id: p.id, full_name: p.full_name })));
    }
    if (path === '/rest/v1/training_programs') return json(route, [visibleProgram(eqParam('training_id'))?.program].filter(Boolean));
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
      db.saves.push(b.p_payload);
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

const shot = (page, name) => page.screenshot({ path: `${OUT}${name}.png` });

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
  await page.getByLabel('Seans sayısı').selectOption('2');
  await page.getByRole('radio', { name: '24 saat önce' }).click();
  check('form previews the time range and session count', await page.getByText('08:00–10:00 (2 seans)').isVisible());
  await page.getByLabel('Başlık (isteğe bağlı)').fill('Sabah antrenmanı');
  await shot(page, '13-training-form');
  await page.getByRole('button', { name: 'Antrenmanı oluştur' }).click();
  await page.getByText('08:00–10:00 · 2 seans').waitFor();
  check('created training opens its detail page with the schedule', true);
  check('server stored start/deadline as UTC instants (08:00 Istanbul = 05:00Z; deadline 24 h earlier)', (() => {
    const t = db.trainings[0];
    return t && new Date(t.starts_at).getUTCHours() === 5 && Date.parse(t.starts_at) - Date.parse(t.rsvp_deadline) === 24 * HOUR && t.slot_count === 2;
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
  check('edit form is pre-filled (2 sessions, 24 h preset recognised)', (await page.getByLabel('Seans sayısı').inputValue()) === '2' && (await page.getByRole('radio', { name: '24 saat önce' }).getAttribute('aria-checked')) === 'true');
  await page.getByLabel('Seans sayısı').selectOption('3');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.getByText('08:00–11:00 · 3 seans').waitFor();
  check('editing changes the schedule', true);

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
    check('home: my boat comes BEFORE the RSVP card (the first thing a member sees)', await above(mine, mp.getByRole('heading', { name: 'Bu antrenmana katılacak mısınız?' })));
    await shot(mp, '26-member-my-boat-dark');
    await mp.getByRole('link', { name: 'Programı gör' }).click();
    await mp.getByRole('heading', { name: 'Tüm program' }).waitFor();
    check('detail: whole program by hour with everyone\'s crew, notes and weather', (await mp.getByText('1. seans · 08:00–09:00').isVisible()) && (await mp.getByText('Alex').first().isVisible()) && (await mp.getByText('teknik çalışma').isVisible()) && (await mp.getByText('Rüzgâr batıdan 15 km/s').isVisible()) && (await mp.getByText('Isınma 10 dk, sonra uzun set').isVisible()));
    check('detail: the reader\'s own boat is marked', (await mp.getByText('Siz', { exact: true }).count()) >= 1);
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
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
