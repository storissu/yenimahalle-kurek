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
  check('member home shows the empty state', await page.getByText('Yaklaşan antrenman yok').isVisible());
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
