# Architecture

Living summary of the decisions behind the app. The full planning document (alternatives considered, schema for
later phases, risks) was agreed with the club before implementation started.

## Constraints that shaped everything

- Turkish-only UI; members log in with a coach-assigned **username** (no emails).
- **Budget 0, no App Store / Google Play** → an installable **PWA** (Android + iPhone), Web Push for notifications.
- Open-sea training site 41.285318, 31.407823; boats Mavi (2), Turuncu (2), C4X (4); sessions are 1-hour slots.
- Leaderboard visible to all members, resets monthly; attendance and stats count **per 1-hour session**.

## Stack

| Concern | Choice |
|---|---|
| App | React + Vite + TypeScript, React Router 7, TanStack Query, react-hook-form + zod, Tailwind CSS 4 |
| PWA | `vite-plugin-pwa` (injectManifest) + our own service worker (`web/src/sw.ts`): app-shell precache, Web Push, notification click routing |
| Backend | Supabase Free: Postgres + Auth + RLS + Edge Functions (later also `pg_cron`) |
| Hosting | Cloudflare Pages (static) |
| Push | Web Push (VAPID) sent from an Edge Function; subscriptions stored per device |
| Weather (Phase 5) | Open-Meteo forecast + marine, fetched server-side and cached |

## Security model

- **Row Level Security on every table**, default-deny, explicit grants (never Supabase's default privileges).
  Functions revoke `EXECUTE` from `anon`/`authenticated` explicitly and grant only what is needed.
- No public sign-up. Only Edge Functions holding the service-role key create/deactivate users; each verifies the
  caller is an **active coach** (`_shared/auth.ts`).
- `profiles.role`, `username`, `is_active`, `must_change_password` cannot be changed by any client (column-level
  privileges). Coaches may edit only `full_name`/`phone`.
- A trigger protects the **last active coach** from being demoted/deactivated (applies to the service role too).
- Members are **deactivated, never deleted**: Auth-level ban + `is_active=false`; history is preserved.
- Members see other members only through `member_directory` (id + name), never phone/username.
- Usernames are ASCII-only (`[a-z0-9._-]{3,30}`) to avoid Turkish dotted/dotless-i case-folding bugs. Login uses a
  synthetic email `<username>@<LOGIN_EMAIL_DOMAIN>`; the domain is a config value, fixed once members exist.
- Browser: strict CSP + security headers (`web/public/_headers`), no third-party scripts, the service worker never
  caches API responses, logout clears the query cache and removes this device's push subscription.

## Testing strategy

| Layer | Tool | Where |
|---|---|---|
| Database rules (RLS, grants, constraints, triggers) | Vitest on **PGlite** (in-process Postgres, no Docker) running the real migration files | `supabase/tests` |
| Pure logic + components | Vitest + Testing Library (happy-dom) | `web/src/**/*.test.ts(x)` |
| Accessibility of the palette | Vitest contrast test over the CSS tokens (WCAG AA, light + dark) | `web/src/theme.contrast.test.ts` |
| UI flows | Playwright (`playwright-core`) against a production build with a mocked Supabase | `web/e2e/smoke.mjs` |

Not covered locally (needs a real project/devices): Edge Functions against real Supabase Auth, real Web Push
delivery on iPhone/Android. Those are verified in the Phase 1 "push spike" (see RUNBOOK).

> Deviation from the original plan: pgTAP was replaced by PGlite-based tests because Docker isn't installed on the
> development machine. Once Docker is available, `supabase test db` (pgTAP) can be added on top.

## Conventions

- All copy lives in `web/src/strings/tr.ts` (typed catalog). Dates/times render in `Europe/Istanbul`, never the device zone.
- Design tokens (colours) live only in `web/src/index.css`; re-branding = edit tokens + `public/icon.svg`.
- Types in `web/src/types/database.ts` are hand-written for now; regenerate from the project once it exists:
  `npx supabase gen types typescript --project-id <ref> > web/src/types/database.ts`.
- Migrations are additive SQL files in `supabase/migrations/`; never edit one that has been applied to production.
