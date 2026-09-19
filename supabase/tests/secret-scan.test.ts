import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without type declarations
import { isSkipped, scanRepository, scanText } from '../../scripts/secret-scan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rules = (text: string) => (scanText(text, 'x') as Array<{ rule: string }>).map((f) => f.rule);

// Fake values are assembled from pieces so this file never contains a complete-looking secret itself.
const fakeJwt = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzAwMDAwMDAwfQ', 'c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU'].join('.');
const fakeKey = 'A'.repeat(20) + 'b'.repeat(20);

describe('secret scanner', () => {
  it('catches the kinds of secrets this project has', () => {
    expect(rules(`const key = "${fakeJwt}"`)).toEqual(['jwt']);
    expect(rules(`SUPABASE_SERVICE_ROLE_KEY=${fakeKey}`)).toContain('service-role-value');
    expect(rules(`VAPID_PRIVATE_KEY = '${fakeKey}'`)).toContain('vapid-private-key');
    expect(rules(`CRON_SECRET: ${'x'.repeat(24)}`)).toEqual(['shared-secret-value']);
    expect(rules(`BACKUP_PASSPHRASE=${'y'.repeat(20)}`)).toEqual(['shared-secret-value']);
    expect(rules('-----BEGIN ' + 'PRIVATE KEY-----')).toEqual(['private-key-block']);
    expect(rules('sb_' + 'secret_' + 'a'.repeat(24))).toEqual(['supabase-secret-key']);
    expect(rules('postgresql://postgres.abcdefgh:' + 'hunter22' + '@aws-0-eu.pooler.supabase.com:5432/postgres')).toEqual(['database-url-with-password']);
  });

  it('leaves public values, placeholders and secret NAMES alone', () => {
    for (const line of [
      'VITE_SUPABASE_URL=https://abcdefgh.supabase.co',
      'npx supabase secrets set CRON_SECRET=<the secret> `',
      '$env:SUPABASE_SERVICE_ROLE_KEY = "<service_role / secret key>"',
      'SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}',
      'BACKUP_PASSPHRASE: ${{ secrets.BACKUP_PASSPHRASE }}',
      'postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres',
      'postgres://postgres:[YOUR-PASSWORD]@db.example.supabase.co:5432/postgres',
      'VAPID_PUBLIC_KEY=<public key>',
      'const anon = requireEnv().VITE_SUPABASE_ANON_KEY;',
    ]) {
      expect(rules(line), line).toEqual([]);
    }
  });

  it('honours the opt-out marker and reports positions without values', () => {
    expect(rules(`x = "${fakeJwt}" // secret-scan:allow`)).toEqual([]);
    const findings = scanText(`ok\nok\nkey = "${fakeJwt}"\n`, 'src/a.ts');
    expect(findings).toEqual([{ file: 'src/a.ts', line: 3, rule: 'jwt' }]);
    expect(JSON.stringify(findings)).not.toContain('eyJ');
  });

  it('skips dependencies, lock files, captured fixtures and binaries', () => {
    for (const file of ['web/node_modules/x/index.js', 'web/package-lock.json', 'supabase/tests/fixtures/open-meteo-forecast.json', 'web/public/icon.png']) {
      expect(isSkipped(file), file).toBe(true);
    }
    expect(isSkipped('web/src/lib/env.ts')).toBe(false);
  });

  it('finds NO secrets in the files git tracks in this repository', () => {
    const findings = scanRepository(root);
    if (findings === null) return; // not a git checkout (e.g. an exported zip): nothing to check
    expect(findings, 'possible secrets (file:line) — remove them and rotate the value').toEqual([]);
  });
});
