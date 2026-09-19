import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without type declarations
import { diagnoseDbUrl } from '../../scripts/check-db-url.mjs';

const problems = (url: string | undefined): string[] => diagnoseDbUrl(url);
// Fake values, assembled from pieces so no complete-looking connection string sits in the repository.
const REF = 'abcdefghijklmnopqrst';
const pooler = (user: string, password: string, port = '5432', path = '/postgres') => `postgresql://${user}:${password}@aws-0-eu-central-1.pooler.supabase.com:${port}${path}`;

describe('diagnoseDbUrl', () => {
  it('accepts the Session pooler string with the project-ref user', () => {
    expect(problems(pooler(`postgres.${REF}`, 'Abc123Def456'))).toEqual([]);
    expect(problems(pooler(`postgres.${REF}`, 'p%40ss%23word'))).toEqual([]); // percent-encoded specials are fine
  });

  it('explains the most common mistake: user "postgres" instead of postgres.<project-ref> on the pooler', () => {
    const found = problems(pooler('postgres', 'Abc123Def456'));
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('postgres.<your-project-ref>');
  });

  it('spots a placeholder that was never replaced', () => {
    expect(problems(pooler(`postgres.${REF}`, '[YOUR-PASSWORD]')).join(' ')).toContain('placeholder');
  });

  it('spots special characters in the password that break the URL', () => {
    expect(problems(pooler(`postgres.${REF}`, 'pa@ss').concat()).join(' ')).toContain('percent-encoded');
    expect(problems(pooler(`postgres.${REF}`, 'pa#ss')).join(' ')).toMatch(/database name|valid URL|password/);
    expect(problems(pooler(`postgres.${REF}`, 'pa/ss')).join(' ')).toMatch(/database name|valid URL|password/);
  });

  it('rejects the direct (IPv6-only) address and the transaction-pooler port', () => {
    expect(problems(`postgresql://postgres:Abc123Def456@db.${REF}.supabase.co:5432/postgres`).join(' ')).toContain('IPv6'); // secret-scan:allow (fake value)
    expect(problems(pooler(`postgres.${REF}`, 'Abc123Def456', '6543')).join(' ')).toContain('SESSION pooler');
  });

  it('handles empty, non-URL and password-less input without throwing', () => {
    expect(problems(undefined)).toEqual(['The secret SUPABASE_DB_URL is empty.']);
    expect(problems('   ')).toEqual(['The secret SUPABASE_DB_URL is empty.']);
    expect(problems('https://example.com')[0]).toContain('postgresql://');
    expect(problems(`postgresql://postgres.${REF}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`).join(' ')).toContain('no password');
  });

  it('never repeats the password in what it says', () => {
    const secret = 'S3cretValue99';
    const all = [pooler('postgres', secret), pooler(`postgres.${REF}`, `${secret}@x`), pooler(`postgres.${REF}`, secret, '6543')].flatMap(problems).join(' ');
    expect(all).not.toContain(secret);
  });
});
