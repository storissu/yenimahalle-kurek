# Security review

One page: what we protect, who could attack it, what stops them, where the proof is, and what is *not* covered.
Reviewed for Phase 6 (before the pilot). Re-read it when a migration adds a table, a function or a grant.

## What is worth protecting

- **Members' personal data**: name, username, phone number (optional), RSVPs, attendance history.
- **Accounts**: coaches can create members, reset passwords and deactivate accounts.
- **Integrity of the club's records**: who is in which boat, who rowed how many sessions (the monthly leaderboard).
- **Availability** for a club with no IT staff and a zero budget.

Not a target: payments (none), public content (none), other clubs (single club).

## Who we defend against

| Attacker | Example | Main defences |
|---|---|---|
| A curious/mischievous **member** | reads others' answers, edits an RSVP after the deadline or after the program is published, promotes themself, opens a draft program | RLS + column grants + definer RPCs; server clock decides deadlines; drafts are coach-only |
| A **stranger** with the site address | guesses a username, calls the API without logging in | no public sign-up; `anon` has no table/column/function privileges except the data-free `ping()`; Supabase Auth rate limits; generic login errors |
| A **stolen phone / shared phone** | another person opens the app | sessions cleared on logout (query cache, push subscription); a coach can deactivate the account immediately (ban + RLS) |
| A **leaked key** | anon key in the web app (public by design), service-role key (never in the app or repo) | anon key alone can do nothing (RLS); service key exists only in Edge Function secrets and the one-off bootstrap script; secret scanner in CI |
| A **malicious dependency / injected script** | compromised npm package, XSS | strict CSP (no third-party scripts, `script-src 'self'`), no `dangerouslySetInnerHTML`, `npm audit` in CI, Dependabot, lockfiles |
| **Mistakes and disasters** | wrong edit, deleted data, paused/lost project | audit log (who changed what), weekly encrypted backups + restore drill, keep-alive |

## The checklist (evidence = the test or file that keeps it true)

| # | Control | Status | Evidence |
|---|---|---|---|
| 1 | Row level security on **every** table, each with ≥ 1 policy | ✅ | `supabase/tests/security.test.ts` → "row level security" |
| 2 | `anon` (not signed in) has **no** privileges on any table, view, column; may call only `ping()` | ✅ | `security.test.ts` → "anonymous visitors" |
| 3 | Signed-in users can **read** but not **write** tables directly; only reviewed column-level exceptions (`profiles.full_name/phone`, `trainings` plain fields, `boats`, `club_settings`, `notification_outbox.read_at`) | ✅ | `security.test.ts` → column-privilege snapshot; a failing snapshot forces a conscious review |
| 4 | Server-owned columns are not client-writable: `trainings.slot_count/status/created_by`, `profiles.role/is_active/username`, audit rows | ✅ | `security.test.ts` → "refused at the door"; `trainings.test.ts`, `core.test.ts` |
| 5 | Every `security definer` function pins `search_path` | ✅ | `security.test.ts` → "pins its search_path" |
| 6 | App users can call exactly the reviewed list of functions; helpers, triggers, cron jobs and the audit writer are closed | ✅ | `security.test.ts` → "exactly the reviewed list" |
| 7 | Coach-only actions refuse members; deactivated accounts see and do nothing | ✅ | `security.test.ts`; `trainings.test.ts`, `program.test.ts`, `attendance.test.ts`, `last-coach.test.ts` |
| 7a | `shared_boat_history()` tells a member only about sessions **they took part in** (same crew, both present, training completed) — never another member's other trainings | ✅ | `shared-history.test.ts` |
| 7b | `member_training_history()` shows any signed-in member another ACTIVE member's completed-training attendance (date, time, boat) — nothing else about them (no answers, notes, username); coaches, deactivated and deleted people are "not found" | ✅ | `member-history.test.ts` |
| 7e | `set_member_role()` (member ⇄ coach) is callable only by an **active coach**, never on oneself, only on an active existing account; it changes `profiles.role` and nothing else, and is written to the audit log (from → to). The last-active-coach trigger still backs it up | ✅ | `member-role.test.ts`, `security.test.ts`, `last-coach.test.ts` |
| 7d | `update_my_phone()` lets a signed-in person change ONLY their own phone number (format-checked: digits, spaces, + ( ) . / -; the only member write to `profiles`); the audit log records the edit, never the number | ✅ | `my-phone.test.ts`, `security.test.ts` |
| 7c | `delete_member()` is callable by the service role only (the `admin-delete-member` function); it removes the person and keeps history as an anonymous "Eski üye" row — nobody else's statistics or shared history change | ✅ | `member-delete.test.ts`, `security.test.ts` |
| 8 | Business rules live in the database (RSVP deadline on the **server** clock, RSVP locked once the program is published, one boat/one person per session, capacity, C4X full crew, drafts private) | ✅ | `trainings.test.ts`, `program.test.ts` |
| 9 | Nobody can remove the last active coach | ✅ | `last-coach.test.ts` |
| 10 | Audit log: written only by the database, readable by coaches only, no passwords/phone numbers stored, kept one year | ✅ | `audit.test.ts` |
| 11 | Edge Functions verify the caller themselves (`verify_jwt = false` by design); admin functions need an **active coach**; cron functions need the shared secret (constant-time compare) | ✅ | `_shared/auth.ts`, `_shared/cron.ts`; `edge-shared.test.ts` |
| 12 | CORS **fails closed**: no `ALLOWED_ORIGIN`, `*` or a malformed value → no `Access-Control-Allow-Origin` at all | ✅ | `_shared/origin.ts`; `edge-shared.test.ts` |
| 13 | Passwords: generated one-time, forced change at first login, never stored/logged/audited; minimum 8 chars with letters + digits (Supabase setting, RUNBOOK step 1) | ✅ / 🔧 | `admin-*` functions; the Supabase Auth setting is done by the operator |
| 14 | Browser hardening: strict CSP, `frame-ancestors 'none'`, `nosniff`, no third-party scripts, service worker never caches API responses, external links `noopener` | ✅ | `web/public/_headers`; `web/src/sw.ts` |
| 15 | No secrets in the repository | ✅ | `scripts/secret-scan.mjs` (CI + `supabase/tests/secret-scan.test.ts`, also scans new uncommitted files) |
| 16 | Dependencies: audited on every CI run (fails on high/critical for shipped code), weekly Dependabot PRs | ✅ | `.github/workflows/ci.yml`, `.github/dependabot.yml` |
| 17 | Backups: weekly, **encrypted** (AES-256) before upload, restore drill documented | ✅ / 🔧 | `.github/workflows/backup.yml`; the operator runs the workflow and the drill once (RUNBOOK 8.2–8.3) |
| 18 | Keep-alive so the project is not paused | ✅ / 🔧 | `.github/workflows/keepalive.yml`; the operator adds two secrets |
| 19 | Personal data minimised; privacy notice matches what is stored and who sees it (phone numbers **are visible to other members** by club decision) | ✅ | `PrivacyPage`, `tr.privacy`; the club should approve the wording |

✅ = enforced by code/tests in this repository · 🔧 = also needs a one-time step by the person running the club's accounts.

## Findings from this review and what was done

- **CORS default was `*`** (any website could call the functions from a browser; the bearer token is still required, so
  low risk). → Now fails closed; RUNBOOK troubleshooting explains the one variable to set.
- **No record of who changed what** (a coach could edit or publish without trace). → Audit log (migration `…audit_log`).
- **No protection against a schema change silently opening something up.** → `security.test.ts` snapshot.
- **Saves while offline were queued silently** and could fire minutes later, after a deadline or another edit. →
  saves now fail immediately with a clear message (`web/src/lib/queryClient.ts`).
- **Free project could be paused; no backups.** → keep-alive + encrypted weekly backup workflows.
- Checked and found fine: no `dangerouslySetInnerHTML`/`eval`; external links use `noopener noreferrer`; push payloads carry only short
  text and an in-app path (`safeInternalPath`); logout clears caches and the device's push subscription; the anon key in the bundle is public by design.

## Known limitations (accepted, or the operator's job)

- **Usernames are guessable** (no e-mail flow). Defence is strong generated passwords, forced change, Supabase's login
  rate limiting and the coach's instant deactivate. Keep Supabase Auth's rate limits at their defaults or stricter.
- **Phone numbers are visible to every member** (club decision, stated in the privacy notice). Anyone who can log in can see them.
- **Free-tier limits** (database size, Edge Function invocations, 90-day artifact retention) can change; re-check them before the pilot.
- **CSP `connect-src` allows `https://*.supabase.co`.** Tighten it to your exact project URL in `web/public/_headers` once known (RUNBOOK troubleshooting mentions the file).
- **Real Web Push, the Edge Functions on a live project, `pg_cron`/Vault, the weather APIs and the two workflows cannot be exercised
  from a developer machine**; they are verified by the operator's checks in the RUNBOOK (steps 6, 7, 8).
- **Lost coach passwords**: recovery is the service-role script (`scripts/bootstrap-coach.mjs --reset`), which needs the secret key; keep it in the password manager.
- Web Push endpoints and keys of a user's own devices are stored in `push_subscriptions` (own rows only).

## If something goes wrong

- *A key leaked* → Supabase dashboard → Project Settings → API → roll the keys; update Cloudflare + Edge Function secrets; re-run `secrets set`.
- *An account is compromised* → coach: Üyeler → the person → **Hesabı devre dışı bırak**, then **Şifreyi sıfırla** and re-enable; check *Değişiklik geçmişi*.
- *Data was deleted or damaged* → restore the newest backup (RUNBOOK 8.3) into a **new** project; the audit log inside it shows what happened.
