// Fails when a file in the repository (tracked, or new and not git-ignored) looks like it contains a SECRET (a service-role key, a VAPID private key, a
// database password, a private key block ...). The public values that ship in the web app (project URL, anon key,
// VAPID public key) are fine and are not matched. Only file names and line numbers are printed, never the value.
//
//   node scripts/secret-scan.mjs            scan the repository (run in CI and by supabase/tests)
//
// A line can opt out with the marker  secret-scan:allow  (use it only for clearly fake example values).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULES = [
  { id: 'jwt', description: 'a JWT-shaped token (Supabase anon/service-role keys are JWTs)', pattern: /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/ },
  { id: 'supabase-secret-key', description: 'a Supabase secret key (sb_secret_…)', pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
  { id: 'private-key-block', description: 'a PEM private key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/ },
  { id: 'vapid-private-key', description: 'a VAPID private key value', pattern: /VAPID_PRIVATE_KEY\s*[=:]\s*['"]?[A-Za-z0-9_-]{30,}/ },
  { id: 'service-role-value', description: 'a service-role key value', pattern: /SERVICE_ROLE_KEY\s*[=:]\s*['"]?[A-Za-z0-9_.-]{30,}/ },
  { id: 'shared-secret-value', description: 'a CRON_SECRET / BACKUP_PASSPHRASE value', pattern: /\b(?:CRON_SECRET|BACKUP_PASSPHRASE)\s*[=:]\s*['"]?[A-Za-z0-9_+/=-]{16,}/ },
  { id: 'database-url-with-password', description: 'a database URL that contains a password', pattern: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/<>{}$[\]]{4,}@[^\s]+/ },
];

const ALLOW_MARKER = 'secret-scan:allow';
const SKIPPED_PATHS = [/(^|\/)node_modules\//, /(^|\/)package-lock\.json$/, /(^|\/)supabase\/tests\/fixtures\//, /\.(png|ico|jpg|jpeg|gif|webp|woff2?|pdf|gpg)$/i];

/** Findings for one file's text: [{ file, line, rule }] (line is 1-based). */
export function scanText(text, file = '(text)') {
  const findings = [];
  text.split(/\r?\n/).forEach((lineText, index) => {
    if (lineText.includes(ALLOW_MARKER)) return;
    for (const rule of RULES) {
      if (rule.pattern.test(lineText)) findings.push({ file, line: index + 1, rule: rule.id });
    }
  });
  return findings;
}

export const isSkipped = (file) => SKIPPED_PATHS.some((pattern) => pattern.test(file.replaceAll('\\', '/')));

/** Every file git tracks plus new files that are not ignored — so a secret is caught BEFORE it is committed. Null outside a git checkout. */
export function trackedFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

export function scanRepository(root, files = trackedFiles(root)) {
  if (files === null) return null;
  const findings = [];
  for (const file of files) {
    if (isSkipped(file)) continue;
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue; // deleted in the working tree, or unreadable: nothing to scan
    }
    if (text.includes('\u0000')) continue; // binary
    findings.push(...scanText(text, file.replaceAll('\\', '/')));
  }
  return findings;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const findings = scanRepository(root);
  if (findings === null) {
    console.log('secret-scan: not a git checkout, nothing scanned.');
  } else if (findings.length > 0) {
    const describe = (id) => RULES.find((r) => r.id === id)?.description ?? id;
    console.error('secret-scan: possible secrets found (values are not printed):');
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${describe(f.rule)}`);
    console.error('Remove the value from the repository and ROTATE it (see docs/RUNBOOK.md). A fake example may carry "secret-scan:allow".');
    process.exit(1);
  } else {
    console.log('secret-scan: no secrets found in the repository files.');
  }
}
