/**
 * The single web origin allowed to call the functions from a browser (CORS), from the ALLOWED_ORIGIN secret.
 * Fails CLOSED: an unset value, "*", or anything that is not a plain http(s) origin yields null, and the functions
 * then send no Access-Control-Allow-Origin header at all (browsers refuse the call; server-to-server calls such as
 * pg_cron are unaffected because CORS is a browser rule). The bearer-token auth is the real protection; this is
 * defence in depth.
 */
export function resolveAllowedOrigin(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text || text === '*') return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}
