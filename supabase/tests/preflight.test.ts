import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without type declarations
import { runPreflight, summarize } from '../../scripts/preflight.mjs';

type Result = { status: 'PASS' | 'WARN' | 'FAIL'; name: string; detail: string };

const SITE = 'https://club.pages.dev';
const SUPABASE = 'https://abcdefghijklmnopqrst.supabase.co';

const GOOD_CSP = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://abcdefghijklmnopqrst.supabase.co wss://abcdefghijklmnopqrst.supabase.co; frame-ancestors 'none'; object-src 'none'`;
const HTML = '<!doctype html><html lang="tr"><body><div id="root"></div></body></html>';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A correctly deployed club app; individual tests replace parts of it. */
type Handler = (url: URL, init: RequestInit | undefined) => Response | undefined;
function deployment(overrides: Handler[] = []) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    for (const override of overrides) {
      const answer = override(url, init);
      if (answer) return answer;
    }
    const path = url.pathname;
    const method = init?.method ?? 'GET';
    if (url.origin === SITE) {
      if (path === '/manifest.webmanifest') return json({ lang: 'tr', display: 'standalone', icons: [1, 2, 3, 4] }, 200, { 'cache-control': 'no-cache' });
      if (path === '/sw.js') return new Response('self.skipWaiting()', { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-cache' } });
      return new Response(HTML, { headers: { 'content-type': 'text/html', 'content-security-policy': GOOD_CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' } });
    }
    if (path === '/rest/v1/rpc/ping') return json(new Date().toISOString());
    if (path === '/auth/v1/settings') return json({ disable_signup: true });
    if (path.startsWith('/rest/v1/rpc/')) return json({ code: '42501' }, 401);
    if (path.startsWith('/rest/v1/')) return json({ code: '42501' }, 401);
    if (path.startsWith('/functions/v1/')) {
      if (method === 'OPTIONS') return new Response('ok', { headers: { 'access-control-allow-origin': SITE } });
      return json({ error: 'Oturum açmanız gerekiyor' }, 401);
    }
    return new Response('?', { status: 404 });
  };
}

const run = async (overrides: Handler[] = []): Promise<Result[]> =>
  runPreflight({ site: SITE, supabase: SUPABASE, anonKey: 'anon-anon-anon-anon-anon', fetchImpl: deployment(overrides) });
const byName = (results: Result[], text: string) => results.find((r) => r.name.includes(text));

describe('preflight against a correct deployment', () => {
  it('passes every check', async () => {
    const results = await run();
    expect(results.filter((r) => r.status !== 'PASS')).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(12);
    expect(summarize(results)).toEqual({ fails: 0, warns: 0, ok: true });
  });

  it('only sends requests to the site and the Supabase project, with the public key only', async () => {
    const seen: Array<{ url: string; auth: string | null }> = [];
    await run([
      (url, init) => {
        seen.push({ url: url.origin, auth: new Headers(init?.headers).get('authorization') });
        return undefined;
      },
    ]);
    expect(new Set(seen.map((s) => s.url))).toEqual(new Set([SITE, SUPABASE]));
    expect(seen.every((s) => s.auth === null || s.auth === 'Bearer anon-anon-anon-anon-anon')).toBe(true);
  });
});

describe('preflight finds the mistakes it exists for', () => {
  it('sign-up left open', async () => {
    const r = byName(await run([(url) => (url.pathname === '/auth/v1/settings' ? json({ disable_signup: false }) : undefined)]), 'sign-up');
    expect(r?.status).toBe('FAIL');
    expect(r?.detail).toContain('Allow new users to sign up');
  });

  it('a table readable without signing in', async () => {
    const r = byName(await run([(url) => (url.pathname === '/rest/v1/profiles' ? json([]) : undefined)]), 'read any club table');
    expect(r?.status).toBe('FAIL');
    expect(r?.detail).toContain('profiles');
  });

  it('an internal function callable without signing in', async () => {
    const r = byName(await run([(url) => (url.pathname === '/rest/v1/rpc/save_program' ? new Response(null, { status: 204 }) : undefined)]), 'internal functions');
    expect(r?.status).toBe('FAIL');
    expect(r?.detail).toContain('save_program');
  });

  it('missing security headers (the _headers file did not ship)', async () => {
    const r = byName(await run([(url) => (url.origin === SITE && url.pathname === '/giris' ? new Response(HTML, { headers: { 'content-type': 'text/html' } }) : undefined)]), 'security headers');
    expect(r?.status).toBe('FAIL');
    expect(r?.detail).toContain('_headers');
  });

  it("unsafe-eval in the CSP", async () => {
    const csp = GOOD_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'");
    const r = byName(await run([(url) => (url.origin === SITE && url.pathname === '/giris' ? new Response(HTML, { headers: { 'content-security-policy': csp, 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' } }) : undefined)]), 'security headers');
    expect(r?.status).toBe('FAIL');
  });

  it('a CSP that would block the database, and one that is only too wide (warning)', async () => {
    const blocked = GOOD_CSP.replace(/connect-src [^;]*/, "connect-src 'self'");
    const wide = GOOD_CSP.replace(/connect-src [^;]*/, "connect-src 'self' https://*.supabase.co wss://*.supabase.co");
    const asSite = (csp: string): Handler => (url) => (url.origin === SITE && url.pathname === '/giris' ? new Response(HTML, { headers: { 'content-security-policy': csp, 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' } }) : undefined);
    expect(byName(await run([asSite(blocked)]), 'reach Supabase')?.status).toBe('FAIL');
    const warning = byName(await run([asSite(wide)]), 'reach Supabase');
    expect(warning?.status).toBe('WARN');
    expect(summarize(await run([asSite(wide)])).ok).toBe(true); // advice, not a blocker
  });

  it('a service worker that gets cached', async () => {
    const r = byName(await run([(url) => (url.pathname === '/sw.js' ? new Response('x', { headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000' } }) : undefined)]), 'service worker');
    expect(r?.status).toBe('FAIL');
  });

  it('CORS wide open, missing, or pointing at another site', async () => {
    const cors = (value: string | null): Handler => (url, init) => (url.pathname.startsWith('/functions/v1/') && init?.method === 'OPTIONS' ? new Response('ok', { headers: value ? { 'access-control-allow-origin': value } : {} }) : undefined);
    expect(byName(await run([cors('*')]), 'CORS')?.detail).toContain('every website');
    expect(byName(await run([cors(null)]), 'CORS')?.detail).toContain('ALLOWED_ORIGIN');
    expect(byName(await run([cors('https://old-name.pages.dev')]), 'CORS')?.detail).toContain('old-name');
  });

  it('a function that is not deployed, or answers without a login', async () => {
    const missing = byName(await run([(url) => (url.pathname === '/functions/v1/send-notifications' ? new Response('nope', { status: 404 }) : undefined)]), 'refuse callers');
    expect(missing?.status).toBe('FAIL');
    expect(missing?.detail).toContain('send-notifications (not deployed)');
    const open = byName(await run([(url) => (url.pathname === '/functions/v1/refresh-weather' ? json({ updated: 0 }) : undefined)]), 'refuse callers');
    expect(open?.detail).toContain('refresh-weather (200)');
  });

  it('a paused or unmigrated project (ping fails) and a site that is not the app', async () => {
    expect(byName(await run([(url) => (url.pathname === '/rest/v1/rpc/ping' ? json({ message: 'not found' }, 404) : undefined)]), 'ping')?.detail).toContain('db push');
    expect(byName(await run([(url) => (url.origin === SITE && url.pathname === '/giris' ? new Response('<html>parked domain</html>') : undefined)]), 'login page')?.status).toBe('FAIL');
  });

  it('a network failure is reported as a failed check, not a crash', async () => {
    const results: Result[] = await runPreflight({ site: SITE, supabase: SUPABASE, anonKey: 'x'.repeat(24), fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
    expect(results.every((r) => r.status === 'FAIL' || r.status === 'PASS')).toBe(true);
    expect(results.some((r) => r.detail.includes('ENOTFOUND'))).toBe(true);
    expect(summarize(results).ok).toBe(false);
  });
});
