// Go-live check for a DEPLOYED club app. Run it against the real addresses before the pilot and after every change to
// hosting or Supabase settings. It only uses PUBLIC values (the site address, the project URL and the anon key — the
// same ones that ship in the web app) and changes nothing: it reads, and sends a few requests that must be refused.
//
//   node scripts/preflight.mjs --site https://<your-site>.pages.dev --supabase https://<ref>.supabase.co --anon-key <anon key>
//   (or set SITE_URL, SUPABASE_URL, SUPABASE_ANON_KEY)
//
// Exit code 0 = no FAIL (warnings are advice), 1 = something must be fixed first.
import { fileURLToPath } from 'node:url';

const TABLES_ANON_MUST_NOT_READ = ['profiles', 'trainings', 'training_responses', 'training_programs', 'attendance_records', 'boats', 'club_settings', 'notification_outbox', 'push_subscriptions', 'audit_log', 'member_directory', 'weather_snapshots'];
const INTERNAL_FUNCTIONS_ANON_MUST_NOT_CALL = ['log_audit', 'save_program', 'save_attendance', 'set_rsvp', 'run_scheduled_notifications', 'prune_audit_log'];

const pass = (name, detail = '') => ({ status: 'PASS', name, detail });
const warn = (name, detail) => ({ status: 'WARN', name, detail });
const fail = (name, detail) => ({ status: 'FAIL', name, detail });

const trimSlash = (url) => url.replace(/\/+$/, '');

async function attempt(name, fn) {
  try {
    return await fn();
  } catch (error) {
    return fail(name, `could not run the check: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Runs every check and returns [{ status: 'PASS' | 'WARN' | 'FAIL', name, detail }]. `fetchImpl` is injectable for tests. */
export async function runPreflight({ site, supabase, anonKey, fetchImpl = globalThis.fetch }) {
  const siteUrl = trimSlash(site);
  const supabaseUrl = trimSlash(supabase);
  const siteOrigin = new URL(siteUrl).origin;
  const supabaseHost = new URL(supabaseUrl).hostname;
  const results = [];
  const check = async (name, fn) => results.push(await attempt(name, fn));
  const anonHeaders = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' };

  // ---- the website ------------------------------------------------------------------------------------------
  await check('site is served over https', async () => (siteUrl.startsWith('https://') ? pass('site is served over https') : fail('site is served over https', 'Members need https for installing the app and for notifications.')));

  let home = null;
  await check('login page loads', async () => {
    home = await fetchImpl(`${siteUrl}/giris`, { redirect: 'follow' });
    const html = await home.text();
    if (home.status !== 200) return fail('login page loads', `/giris answered ${home.status}. Is the Cloudflare build finished?`);
    if (!/<html[^>]*lang="tr"/i.test(html)) return fail('login page loads', 'The page does not look like the club app (no <html lang="tr">).');
    return pass('login page loads');
  });

  await check('security headers are applied', async () => {
    const res = home ?? (await fetchImpl(`${siteUrl}/`));
    const csp = res.headers.get('content-security-policy') ?? '';
    const missing = [];
    if (!/default-src 'self'/.test(csp)) missing.push("CSP with default-src 'self'");
    if (!/frame-ancestors 'none'/.test(csp)) missing.push("CSP frame-ancestors 'none'");
    if (/unsafe-eval/.test(csp)) missing.push("no 'unsafe-eval' in the CSP");
    if (!/script-src 'self'\s*(?:;|$)/.test(csp)) missing.push("script-src 'self' only");
    if ((res.headers.get('x-content-type-options') ?? '').toLowerCase() !== 'nosniff') missing.push('X-Content-Type-Options: nosniff');
    if (!res.headers.get('referrer-policy')) missing.push('Referrer-Policy');
    if (missing.length > 0) return fail('security headers are applied', `Missing or wrong: ${missing.join('; ')}. The file web/public/_headers must be part of the build output (Cloudflare Pages).`);
    return pass('security headers are applied');
  });

  await check('CSP lets the app reach Supabase', async () => {
    const res = home ?? (await fetchImpl(`${siteUrl}/`));
    const csp = res.headers.get('content-security-policy') ?? '';
    const connect = /connect-src ([^;]*)/.exec(csp)?.[1] ?? '';
    if (!connect.includes(supabaseHost) && !/\*\.supabase\.co/.test(connect)) return fail('CSP lets the app reach Supabase', `connect-src does not allow ${supabaseHost}, so the app could not load data. Edit web/public/_headers.`);
    if (!connect.includes(supabaseHost)) return warn('CSP lets the app reach Supabase', `connect-src allows every *.supabase.co project. Tighten it to exactly https://${supabaseHost} (and wss://${supabaseHost}) in web/public/_headers.`);
    return pass('CSP lets the app reach Supabase', 'restricted to this project');
  });

  await check('app manifest is valid', async () => {
    const res = await fetchImpl(`${siteUrl}/manifest.webmanifest`);
    if (res.status !== 200) return fail('app manifest is valid', `/manifest.webmanifest answered ${res.status}`);
    const manifest = await res.json();
    if (manifest.lang !== 'tr' || manifest.display !== 'standalone' || !Array.isArray(manifest.icons) || manifest.icons.length < 3) return fail('app manifest is valid', 'Expected lang "tr", display "standalone" and at least 3 icons.');
    if (!/no-cache|no-store|max-age=0/.test(res.headers.get('cache-control') ?? '')) return warn('app manifest is valid', 'The manifest should not be cached (Cache-Control: no-cache in _headers), or icon/colour changes reach phones late.');
    return pass('app manifest is valid');
  });

  await check('service worker updates immediately', async () => {
    const res = await fetchImpl(`${siteUrl}/sw.js`);
    if (res.status !== 200 || !/javascript/.test(res.headers.get('content-type') ?? '')) return fail('service worker updates immediately', `/sw.js answered ${res.status} (${res.headers.get('content-type')}).`);
    if (!/no-cache|no-store|max-age=0/.test(res.headers.get('cache-control') ?? '')) return fail('service worker updates immediately', 'sw.js must be served with Cache-Control: no-cache, otherwise members keep an old version of the app.');
    return pass('service worker updates immediately');
  });

  await check('deep links open the app (single-page fallback)', async () => {
    const res = await fetchImpl(`${siteUrl}/uye/antrenmanlar`);
    const html = await res.text();
    return res.status === 200 && /<div id="root">/.test(html) ? pass('deep links open the app (single-page fallback)') : fail('deep links open the app (single-page fallback)', `/uye/antrenmanlar answered ${res.status}. Notification links would break.`);
  });

  // ---- Supabase ---------------------------------------------------------------------------------------------
  await check('database answers (ping) — migrations are applied', async () => {
    const res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/ping`, { method: 'POST', headers: anonHeaders, body: '{}' });
    if (res.status !== 200) return fail('database answers (ping) — migrations are applied', `ping() answered ${res.status}. Run "npx supabase db push"; if the project is paused, restore it in the dashboard.`);
    const time = Date.parse(await res.json());
    if (Number.isNaN(time) || Math.abs(time - Date.now()) > 5 * 60_000) return fail('database answers (ping) — migrations are applied', 'The answer is not a current time.');
    return pass('database answers (ping) — migrations are applied');
  });

  await check('sign-up is closed', async () => {
    const res = await fetchImpl(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: anonKey } });
    if (res.status !== 200) return fail('sign-up is closed', `Auth settings answered ${res.status}.`);
    const settings = await res.json();
    return settings.disable_signup === true ? pass('sign-up is closed') : fail('sign-up is closed', 'Anyone can create an account! Supabase → Authentication → Sign In / Providers → turn OFF "Allow new users to sign up".');
  });

  await check('anonymous visitors cannot read any club table', async () => {
    const leaks = [];
    for (const table of TABLES_ANON_MUST_NOT_READ) {
      const res = await fetchImpl(`${supabaseUrl}/rest/v1/${table}?select=*&limit=1`, { headers: anonHeaders });
      if (res.status === 200) leaks.push(table);
    }
    return leaks.length === 0 ? pass('anonymous visitors cannot read any club table', `${TABLES_ANON_MUST_NOT_READ.length} tables refused`) : fail('anonymous visitors cannot read any club table', `Readable without signing in: ${leaks.join(', ')}. Run the database tests; a migration probably lost a REVOKE.`);
  });

  await check('anonymous visitors cannot call internal functions', async () => {
    const open = [];
    for (const name of INTERNAL_FUNCTIONS_ANON_MUST_NOT_CALL) {
      const res = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', headers: anonHeaders, body: '{}' });
      if (res.status === 200 || res.status === 204) open.push(name);
    }
    return open.length === 0 ? pass('anonymous visitors cannot call internal functions') : fail('anonymous visitors cannot call internal functions', `Callable without signing in: ${open.join(', ')}.`);
  });

  await check('Edge Functions only answer the club site (CORS)', async () => {
    const preflight = (origin) => fetchImpl(`${supabaseUrl}/functions/v1/admin-create-member`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
    const own = await preflight(siteOrigin);
    const allowed = own.headers.get('access-control-allow-origin');
    if (own.status >= 500 || allowed === null) return fail('Edge Functions only answer the club site (CORS)', 'No Access-Control-Allow-Origin. Are the functions deployed and ALLOWED_ORIGIN set? npx supabase secrets set ALLOWED_ORIGIN=' + siteOrigin);
    if (allowed === '*') return fail('Edge Functions only answer the club site (CORS)', 'The functions allow every website (ALLOWED_ORIGIN missing or "*"). Set it to ' + siteOrigin);
    if (allowed !== siteOrigin) return fail('Edge Functions only answer the club site (CORS)', `ALLOWED_ORIGIN is "${allowed}" but the site is ${siteOrigin}. Adding members would fail in the browser.`);
    const evil = await preflight('https://evil.example');
    if (evil.headers.get('access-control-allow-origin') === 'https://evil.example' || evil.headers.get('access-control-allow-origin') === '*') return fail('Edge Functions only answer the club site (CORS)', 'Another website is allowed as well.');
    return pass('Edge Functions only answer the club site (CORS)');
  });

  await check('Edge Functions refuse callers who are not signed in', async () => {
    const wrong = [];
    for (const name of ['admin-create-member', 'admin-reset-password', 'admin-set-active', 'send-notifications', 'refresh-weather', 'push-test']) {
      const res = await fetchImpl(`${supabaseUrl}/functions/v1/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: siteOrigin }, body: '{}' });
      if (res.status !== 401 && res.status !== 403 && res.status !== 404) wrong.push(`${name} (${res.status})`);
      else if (res.status === 404) wrong.push(`${name} (not deployed)`);
    }
    return wrong.length === 0 ? pass('Edge Functions refuse callers who are not signed in') : fail('Edge Functions refuse callers who are not signed in', `Unexpected answers: ${wrong.join(', ')}. Deploy all functions: npx supabase functions deploy`);
  });

  return results;
}

export function summarize(results) {
  const fails = results.filter((r) => r.status === 'FAIL').length;
  const warns = results.filter((r) => r.status === 'WARN').length;
  return { fails, warns, ok: fails === 0 };
}

function parseArgs(argv, env) {
  const args = { site: env.SITE_URL, supabase: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--site') args.site = argv[++i];
    else if (argv[i] === '--supabase') args.supabase = argv[++i];
    else if (argv[i] === '--anon-key') args.anonKey = argv[++i];
  }
  return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2), process.env);
  if (!args.site || !args.supabase || !args.anonKey) {
    console.error('Usage: node scripts/preflight.mjs --site https://<site>.pages.dev --supabase https://<ref>.supabase.co --anon-key <anon key>');
    process.exit(2);
  }
  const results = await runPreflight(args);
  for (const r of results) console.log(`${r.status.padEnd(4)}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`);
  const { fails, warns, ok } = summarize(results);
  console.log(`\n${results.length - fails - warns} passed, ${warns} warning(s), ${fails} failed.`);
  process.exit(ok ? 0 : 1);
}
