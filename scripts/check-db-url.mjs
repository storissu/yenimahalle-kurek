// Explains, in plain words, what is wrong with a Supabase connection string — WITHOUT ever printing it (the
// password is a secret). Used by the backup workflow before it tries to connect, so a mistake in the
// SUPABASE_DB_URL secret shows up as a clear message instead of "password authentication failed".
//
//   SUPABASE_DB_URL=... node scripts/check-db-url.mjs      exits 1 and prints ::error:: lines when something is off
import { fileURLToPath } from 'node:url';

/** Problems found in a connection string, as short sentences (an empty list means it looks right). */
export function diagnoseDbUrl(raw) {
  const text = (raw ?? '').trim();
  const problems = [];
  if (!text) return ['The secret SUPABASE_DB_URL is empty.'];
  if (!/^postgres(?:ql)?:\/\//i.test(text)) return ['It must start with postgresql:// — copy the "Session pooler" string from Supabase → Connect.'];
  if (/[<>[\]]/.test(text)) problems.push('It still contains a placeholder such as [YOUR-PASSWORD] or <ref>. Replace the WHOLE placeholder, brackets included, with the real value.');
  if ((text.match(/@/g) ?? []).length > 1) problems.push('The password contains an "@". Characters like @ # / ? : % must be written percent-encoded in a URL (@ = %40, # = %23, / = %2F, ? = %3F, : = %3A, % = %25) — or set a new database password made of letters and digits only.');

  let url;
  try {
    url = new URL(text);
  } catch {
    problems.push('It is not a valid URL — usually a special character in the password (@ # / ? : %). Use a password of letters and digits only, or percent-encode the character.');
    return problems;
  }

  const host = url.hostname;
  const user = decodeURIComponent(url.username);
  const password = url.password;
  const isPooler = host.endsWith('.pooler.supabase.com');
  const isDirect = /^db\.[a-z0-9]+\.supabase\.co$/.test(host);

  if (!isPooler && !isDirect) problems.push(`The host "${host}" does not look like a Supabase database address. Copy the string from Supabase → Connect (Session pooler).`);
  if (isDirect) problems.push('This is the "direct connection" address, which only speaks IPv6; GitHub\'s runners use IPv4. Use the "Session pooler" string instead.');
  if (isPooler && !/^postgres\.[a-z0-9]{10,}$/.test(user)) problems.push(`On the pooler the user must be postgres.<your-project-ref> (for example postgres.abcdefghijklmnopqrst), not "${user || '(empty)'}". Copy the Session pooler string unchanged and only replace the password.`);
  if (!password) problems.push('There is no password in the string (the part between the first ":" after the user and the "@").');
  if (url.port === '6543') problems.push('Port 6543 is the transaction pooler, which pg_dump cannot use. Use the SESSION pooler on port 5432.');
  if (url.port && !['5432', '6543'].includes(url.port)) problems.push(`Unusual port ${url.port}; the session pooler uses 5432.`);
  if (url.pathname && !/^\/[A-Za-z0-9_]+$/.test(url.pathname)) problems.push('The database name after the address looks wrong (it is normally /postgres). A "/" or "#" in the password can cause this.');
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = diagnoseDbUrl(process.env.SUPABASE_DB_URL);
  if (problems.length === 0) {
    console.log('The connection string has the right shape (its password is not checked here).');
  } else {
    for (const problem of problems) console.error(`::error::SUPABASE_DB_URL: ${problem}`);
    console.error('Fix the repository secret (GitHub → Settings → Secrets and variables → Actions → SUPABASE_DB_URL), then run the workflow again. See docs/RUNBOOK.md, step 8.2.');
    process.exit(1);
  }
}
