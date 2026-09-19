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

## Trainings and RSVP (Phase 2)

- A **training** is one event of 1–6 consecutive **1-hour sessions** (`slot_count`). Sessions are indexed, not stored,
  so editing the start time shifts them consistently. Times are stored as UTC instants; forms use Istanbul wall-clock
  and convert with `web/src/lib/time.ts` (Intl only, no date library).
- **RSVP is per training** (`training_responses`) with an optional note (≤ 200 chars). *Attending* means "I will be
  there that day, whichever hour you assign me". No row = no answer yet.
- **Nobody writes `training_responses` directly.** Members use `set_rsvp()` (allowed while `now() < rsvp_deadline` and
  the training is scheduled); coaches use `coach_set_rsvp()` (works after the deadline, flagged `set_by_coach`).
  `now()` is the **database** clock, so a wrong phone clock cannot re-open a deadline.
- The app measures the phone/server clock difference (`server_now()`, `web/src/lib/clock.ts`) so countdowns and the
  lock state match what the server will enforce; a new measurement updates every countdown immediately.
- Trainings are never deleted: **cancelling** goes through `cancel_training()` (coach-only, reason required, final).
  Only *scheduled* trainings can be edited. `status`, `cancel_reason` and `created_by` are not client-writable.
- Members never see other members' answers; coaches see all. Error messages from our RPCs (SQLSTATE `P0001`) are
  written in Turkish and shown as-is; any other database error is replaced by a generic message.

## Boat program (Phase 3)

- Tables: `training_programs` (status draft/published, `version` = number of publishes, weather + training notes),
  `program_assignments` (one row per boat per session), `program_crew` (members in that boat that session).
- Database rules: a boat is used **once per session**, a member is in **one boat per session**, a boat never carries
  more than its **capacity**, crew are **members**, and sessions must exist in the training. Unique constraints plus
  triggers enforce these even if `save_program()` is bypassed; the RPC adds friendly Turkish messages.
- **Drafts are coach-only** (RLS: members can read a program, its assignments and crew only when it is published).
  Crew names reach members through `member_directory` (names only).
- The program is changed **only** through `save_program(training, payload, publish)`: it replaces everything in one
  transaction (any error rolls back), so members never see a half-edited crew. `publish=false` on a published program
  takes it back to draft. Deactivated members / out-of-use boats that were already in a program may stay in it
  (history) but cannot be newly assigned.
- A training's session count cannot shrink below a session that still has a crew (trigger).
- Editor logic lives in `web/src/features/program/model.ts` (pure functions, mirrors the database rules; unit-tested):
  toggle a member into a boat (refuses "full" / "already in another boat that hour"), copy/clear an hour, compare
  drafts, and pre-publish checks (attendees in no hour; people placed against their RSVP). `view.ts` builds the
  hour-by-hour timeline and "my boat" lines for members.
- Leaving the editor with unsaved changes is guarded (in-app navigation and browser unload); the editor stays mounted
  while the coach looks at other tabs.
- Notifications on publish/update are Phase 5; `version` is what will tell "new program" from "program updated".

## Attendance and statistics (Phase 4)

- **Attendance is what actually happened**, separate from the RSVP and from the program: `attendance_records` has one
  row per (training, **session**, member) with `present | absent`. Written only through `save_attendance()`
  (coach-only, replaces the training's records atomically). Members read only their own rows (RLS).
- The coach can only record once the training has **started** (server clock) and never for cancelled trainings.
  `p_complete=false` saves progress; `p_complete=true` marks the training **completed**. A completed training can still
  be corrected. Completing needs at least one record.
- The editor starts from the **plan**: the program's crew per session, or — with no program — everyone who said
  "attending". The coach only fixes exceptions (mark "Gelmedi", add walk-ins). Logic: `features/attendance/model.ts`.
- **Statistics count PRESENT sessions (hours)**: rowing 2 hours counts 2; "training days" (distinct trainings) is a
  secondary figure. Only **completed** trainings count, only **active** members appear, and a training belongs to the
  calendar month of its start in **Europe/Istanbul** (a 23:00 session on the 31st is that month; 00:00 local on the 1st
  is the next). The leaderboard "resets" because it is month-bucketed — there is no reset job — and past months stay
  browsable.
- Ranking is standard competition ranking (1, 1, 3, …): equal sessions share a place; no sessions = no rank.
- Members see others' numbers only as aggregates through `monthly_leaderboard()` (names + counts, members with at least
  one session) and `my_month_stats()`. `coach_month_table()` (everyone incl. zeros), `attendance_export()` and
  `training_attendance_counts()` are coach-only. The internal helper is not callable by clients.
- CSV exports use `;` separators and a UTF-8 BOM (Turkish Excel), and defuse spreadsheet formulas (`lib/csv.ts`).
  On phones the file goes through the share sheet when the browser can share files, otherwise it downloads.
- Lists show the last 90 days; "Daha eski antrenmanları göster" loads up to two years back on request.

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
