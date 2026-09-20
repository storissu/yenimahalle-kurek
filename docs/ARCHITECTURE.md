# Architecture

Living summary of the decisions behind the app. The full planning document (alternatives considered, schema for
later phases, risks) was agreed with the club before implementation started.

## Constraints that shaped everything

- Turkish-only UI; members log in with a coach-assigned **username** (no emails).
- **Budget 0, no App Store / Google Play** → an installable **PWA** (Android + iPhone), Web Push for notifications.
- Open-sea training site 41.285318, 31.407823; boats Mavi (2), Turuncu (2), C4X (4); every boat has its OWN sequence of sessions
  (own start/end, one hour by default, any length possible).
- Leaderboard visible to all members, resets monthly; attendance and stats count **per 1-hour session**.

## Stack

| Concern | Choice |
|---|---|
| App | React + Vite + TypeScript, React Router 7, TanStack Query, react-hook-form + zod, Tailwind CSS 4 |
| PWA | `vite-plugin-pwa` (injectManifest) + our own service worker (`web/src/sw.ts`): app-shell precache, Web Push, notification click routing |
| Backend | Supabase Free: Postgres + Auth + RLS + Edge Functions + `pg_cron` / `pg_net` / Vault |
| Hosting | Cloudflare Pages (static) |
| Push | Web Push (VAPID) sent from an Edge Function; subscriptions stored per device |
| Weather | Open-Meteo forecast + marine (MET Norway fallback), fetched server-side and cached per session |

## Trainings and RSVP (Phase 2)

- A **training** is one event whose length comes from its program. **Every boat has its own schedule**: each boat session
  (`program_assignments`) has its own `starts_at` / `ends_at` (minute precision, one hour by default) and its own number,
  `slot_index`, which stays the session's IDENTITY — attendance, history, weather and statistics keep joining on it. A new
  training has `slot_count = 0` ("not planned yet", shown as just its start time); `save_program()` derives `slot_count`
  (highest session number + 1, at most 30) and `trainings.ends_at` (the end of the last session), `save_attendance()`
  extends the count to what was recorded. Clients cannot write either column. Moving the training's start shifts its whole
  schedule (trigger). Older data and payloads without times keep the old grid (start + `slot_index` hours; defaults in
  triggers). Rules: a boat's sessions never overlap, nobody rows two boats at overlapping times, a session lasts at most
  8 hours and does not start before the training. `attendance_records` carry their session's time (what actually happened).
  Times are stored as UTC instants; forms use Istanbul wall-clock and convert with `web/src/lib/time.ts` (Intl only).
- **RSVP is per training** (`training_responses`) with an optional note (≤ 200 chars). *Attending* means "I will be
  there that day, whichever hour you assign me". No row = no answer yet.
- **Nobody writes `training_responses` directly.** Members use `set_rsvp()` (allowed while `now() < rsvp_deadline` and
  the training is scheduled); coaches use `coach_set_rsvp()` (works after the deadline, flagged `set_by_coach`).
  `now()` is the **database** clock, so a wrong phone clock cannot re-open a deadline.
- **Publishing the program locks the answers** (before the deadline too): `set_rsvp()` refuses once a published
  program exists; `coach_set_rsvp()` still works, and taking the program back to a draft re-opens the answers. The
  reminder job skips trainings whose program is published. The UI reads the set of published trainings from one
  cheap query (`usePublishedTrainingIds`) and the server has the last word.
- The RSVP deadline remembers **how it was chosen** (`rsvp_deadline_rule`: 12 / 24 / 48 hours, `evening` = 20:00 on
  the previous calendar day, or `custom`). For an 08:00 training "12 saat önce" and "Bir önceki akşam 20:00" are the
  same instant; the remembered rule keeps the coach's meaning when the start time is edited.
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
  Crew names (and phone numbers, see below) reach members through `member_directory`.
- The program is changed **only** through `save_program(training, payload, publish)`: it replaces everything in one
  transaction (any error rolls back), so members never see a half-edited crew. `publish=false` on a published program
  takes it back to draft. Deactivated members / out-of-use boats that were already in a program may stay in it
  (history) but cannot be newly assigned.
- **Boats that must be full**: `boats.requires_full_crew` (C4X = exactly 4, editable per boat in *Tekneler*).
  `save_program()` refuses to **publish** (or update a published program) when such a boat has fewer or more people
  than its capacity in any session; drafts may be incomplete. The editor mirrors this: an incomplete C4X is flagged
  on its card, the publish button is disabled and the warning names boat, session and head count.
- **Sessions are added while preparing the program** ("Seans ekle" / "Son seansı kaldır", up to 12). Empty sessions at
  the end are not part of the program (the training simply ends earlier); a training's count cannot shrink below a
  session that still has a crew or an attendance record (trigger).
- **Members see the whole published program grouped by boat** (`ProgramByBoat`, on Home and the training page):
  one coloured block per boat — the boat name is always written out, colours come from `--boat-N` tokens that are
  contrast-checked — with a row per session: the time (big start, small end) on the left, then the crew as compact
  name chips — one size and shape for everybody (`text-sm`, `min-h-9`), flowing side by side for one or two names and
  in an even two-column grid for three or four (the C4X), so rows stay tidy whatever the crew size. A name opens the
  contact card. Rows the reader rows in are a solid blue block: the others' chips are outlined, the reader's own chip is
  inverse with a pin and carries the screen-reader text "Sizin seansınız" (there is no separate "Siz" badge). The
  "Sizin programınız" card stays on top.
- Editor logic lives in `web/src/features/program/model.ts` (pure functions, mirrors the database rules; unit-tested):
  a draft is a flat list of sessions (boat, "HH:MM" start/end, crew); adding a session starts it where the boat's last one
  ended, changing a boat's FIRST start moves the whole boat, changing an END moves that boat's later sessions, swapping
  teams keeps the times; toggling a member refuses "full" / "already in another boat at that time"; time problems
  (order, length, overlaps) and the pre-publish checks (attendees in no session; people placed against their RSVP; boats
  that must be full) are computed here. `view.ts` groups the program by boat and picks out "my boat" lines for members.
- **Light / dark mode**: the CSS tokens react only to `data-theme="light|dark"` on `<html>`. `public/theme-init.js` (a plain
  blocking script, allowed by the CSP, precached by the service worker) sets it before the first paint from the saved choice
  (`localStorage` `yk-theme`: system | light | dark; "system" = the phone's setting); `src/lib/theme.ts` keeps it in sync
  (new choice, phone setting changing) and a test keeps the two in step. The choice lives on the profile page ("Görünüm").
- Leaving the editor with unsaved changes is guarded (in-app navigation and browser unload); the editor stays mounted
  while the coach looks at other tabs.
- `save_program(training, payload, publish, notify)`: `notify=false` gives the coach a silent correction (Phase 5).

## Attendance and statistics (Phase 4)

- **Attendance is what actually happened**, separate from the RSVP and from the program: `attendance_records` has one
  row per (training, **session**, member) with `present | absent`. Written only through `save_attendance()`
  (coach-only, replaces the training's records atomically). Members read only their own rows (RLS).
- The coach can only record once the training has **started** (server clock) and never for cancelled trainings.
  `p_complete=false` saves progress; `p_complete=true` marks the training **completed**. A completed training can still
  be corrected. Completing needs at least one record.
- The editor starts from the **plan**: the program's crew per session, or — with no program — everyone who said
  "attending". The coach only fixes exceptions (mark "Gelmedi", add walk-ins). Logic: `features/attendance/model.ts`.
- **Statistics count PRESENT sessions** (a boat session of any length is one): rowing 2 sessions counts 2; "training days" (distinct trainings) is a
  secondary figure. Only **completed** trainings count, only **active** members appear, and a training belongs to the
  calendar month of its start in **Europe/Istanbul** (a 23:00 session on the 31st is that month; 00:00 local on the 1st
  is the next). The leaderboard "resets" because it is month-bucketed — there is no reset job — and past months stay
  browsable.
- Ranking is standard competition ranking (1, 1, 3, …): equal sessions share a place; no sessions = no rank.
- Members see others' numbers only as aggregates through `monthly_leaderboard()` (names + counts of **every active
  member**: members without a session come last with `rank = null`, shown as "–" and 0) and `my_month_stats()`. `coach_month_table()` (everyone incl. zeros), `attendance_export()` and
  `training_attendance_counts()` are coach-only. The internal helper is not callable by clients.
- CSV exports use `;` separators and a UTF-8 BOM (Turkish Excel), and defuse spreadsheet formulas (`lib/csv.ts`).
  On phones the file goes through the share sheet when the browser can share files, otherwise it downloads.
- Lists show the last 90 days; "Daha eski antrenmanları göster" loads up to two years back on request.

## Notifications (Phase 5)

- **`notification_outbox` is both the in-app inbox and the push queue.** One row per person per event, with a unique
  `dedupe_key` so a retried trigger or cron run never sends twice. A user reads only their own rows and can only set
  `read_at` (column grant); everything else is written by the database itself. Rows older than 60 days are pruned.
- **Who writes them** (all inside the transaction that caused the event, so an event and its notification cannot
  disagree): triggers on `trainings` (new / time or deadline changed / cancelled → all active members),
  `save_program()` (first publish → each crew member gets a personal message with boat, hour and crew mates and other
  attendees a general one; later updates → everyone in a boat-hour that changed, including the crew mates of someone who
  moved), and `run_scheduled_notifications()` (pg_cron every 5 min: reminder to members **without an answer**
  `reminder_lead_hours` before the deadline, once; coach summary after the deadline, once).
- **Delivery**: the Edge Function `send-notifications` takes pending rows, sends Web Push to each of the person's
  devices, marks the row done, retries failures (max 5 attempts) and deletes subscriptions that answer 404/410.
  Push is *best effort*; the inbox is the guarantee (bell badge, app-icon badge, refresh when a push arrives).
- **Scheduling without a server**: three `pg_cron` jobs call the functions through `pg_net`, authenticating with a shared
  secret (`x-cron-secret` = function secret `CRON_SECRET`, read from Supabase **Vault**, never from the repo). The
  functions have `verify_jwt = false` and check the caller themselves (`_shared/cron.ts`); `refresh-weather` also
  accepts a signed-in **coach** so the *Yenile* button works. The schedule migration is skipped by the PGlite tests
  (no cron there); the SQL they call is tested directly.
- The notification `url` must be an in-app path (`/…`, not `//…`) — checked in the database and again in the client
  (`safeInternalPath`) before navigating.

## Weather (Phase 5)

- Server-side only (`refresh-weather`): **Open-Meteo** forecast + marine for the site coordinates, **MET Norway** as a
  fallback (no gusts / waves). Parsers and merging are pure functions with fixtures of real responses
  (`supabase/tests/fixtures`). The result is cached in `weather_snapshots`, one row per training session; members
  and coaches read the cache, so a provider outage never breaks a page.
- A session's value is the hour its **own start** falls in (boats start at different times, so there is one row per session
  number); gust, wave and rain take the **maximum of that hour and the next**. Refreshed when a coach saves a training, every 3 hours by cron for upcoming trainings,
  and on demand (*Yenile*). Forecasts beyond ~16 days do not exist yet ("henüz alınmadı").
- **Advisories are coach-only and never automatic.** Thresholds (`wind_gust_warn_kmh`, `wave_warn_m`) are chosen by the
  coaches in *Kulüp ayarları* and empty by default; crossing one shows a warning to coaches on the training page and
  (the strip lists each forecast hour once, the editor repeats none of it). Nothing is cancelled or announced to members by the app.
- Open-Meteo asks for attribution; it is shown under every forecast, with a note that waves are an offshore model.

## Phone numbers

Members can see each other's phone numbers (crew members, training partners). The `member_directory` view — active
members only — exposes `id`, `full_name` and `phone` and nothing else (no username, role, status or answers). Tapping
a name in the program opens a contact card with a call link; the bottom-bar tab *Üyeler* lists everyone (a row opens that member's profile). The phone is
optional when a coach creates an account (the form says other members will see it) and the privacy notice states it.
Coaches see phones in *Üyeler*.

## Member profiles and shared history

- `/uye/uyeler/:memberId` (`features/members/ClubMemberPage.tsx`) shows another member: name and phone from
  `member_directory` (nothing else exists there) and the sessions the two of you rowed **in the same boat**.
  Entry points: the directory rows, the contact card of the program ("Profili aç") and the leaderboard names. Your own id redirects to *Profil*.
- The history comes from `shared_boat_history(p_member)` — a definer function (callable by signed-in users only,
  `search_path` pinned, listed in the `security.test.ts` snapshot). A row is returned only when **the caller and the
  other member were in the same crew of a published program, both were `present` in `attendance_records` for that
  session, and the training is `completed`**. It therefore cannot reveal a training the caller did not take part in,
  and returns nothing for the caller's own id; unknown, inactive or coach ids raise "Üye bulunamadı". Newest first, at most 200 rows.
  Pure presentation rules (grouping, summary) live in `features/members/history.ts`; tests: `supabase/tests/shared-history.test.ts`.
- Profile photos were considered and **deliberately not built** (storage, moderation and privacy cost for a small club).

## Program display (whose session is it?)

`ProgramByBoat` renders the published program by boat: the reader's own sessions are a **solid `primary` block** (independent
of the boat's accent colour, so it works for every boat), larger type, a "Siz" pill and the forecast of that hour; the boats the
reader rows in come **first** ("Sizin tekneniz"), the rest keep the club order. `BoatIcon` (`components/ui/BoatIcon.tsx`) draws a
small hull with one dot per seat (single / double / quad / crew) from the boat's capacity. `MyBoatCard` shows the forecast of each of
the reader's sessions from the session's own `weather_snapshots` row (its start hour), not the weather now.
`features/weather/SessionWeather.tsx` holds these compact forecast pieces and imports no Supabase code (unit-testable).

Coaches get the same compact view: `CoachProgramView` renders `ProgramByBoat` (neutral — nobody highlighted, no "Profili aç", which is a member page) above the tabs of the coach's training page once a program is **published**; nothing for a draft or a cancelled training.

## Change history (Phase 6)

- `audit_log` is written **only by the database**: triggers on `trainings`, `training_programs`, `training_responses`
  (coach entries only), `attendance_records`, `boats`, `club_settings`, `profiles` (coach edits) and the Edge Functions
  for account creation / password reset / (de)activation (through `log_audit(..., p_actor)`, never with the password).
  Coaches read it (RLS `is_coach()`); nobody can insert, update or delete from the client. Repeated identical events in
  one transaction (the rows of one attendance save) are merged into one entry with a count. Only *which fields*
  changed is stored, not values. Entries older than a year are removed by a daily `pg_cron` job.
- The UI is *Diğer → Değişiklik geçmişi* (`features/audit/`): grouped by club-time day, filter chips, "Daha eski kayıtlar".

## Accessibility and offline behaviour (Phase 6)

- Every screenshot in the browser test also runs **axe-core** (WCAG 2.0/2.1 A + AA + best practices) on exactly what
  is on screen, in both colour schemes; serious/critical findings fail CI. Real screen-reader checks (VoiceOver,
  TalkBack) remain a manual step (RUNBOOK checklist).
- Skip link + `<main id="main">`; on every page change `RouteAccessibility` sets `document.title` from the page's
  `<h1>` and moves focus to it (so screen readers announce the new page); radio-style groups follow the ARIA arrow-key
  pattern (`lib/radioGroup.ts`) — for choices that save to the server (the RSVP) arrows only move focus, Space/Enter chooses.
- **Offline**: reads show what is already loaded (TanStack's default keeps refetching paused while offline); **saves
  are attempted immediately** (`networkMode: 'always'` for mutations) and fail with the Turkish connection message while
  the form keeps what was typed — instead of the default of silently queuing the save until reconnect. A banner says
  "Çevrimdışısınız". Nothing is written offline, so there is nothing to reconcile.

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
- The full review (threat model, checklist, evidence, limits) is in `docs/SECURITY.md`; `supabase/tests/security.test.ts`
  compares every table/column/function grant to a reviewed snapshot so a change cannot slip in unnoticed.
- Browser: strict CSP + security headers (`web/public/_headers`), no third-party scripts, the service worker never
  caches API responses, logout clears the query cache and removes this device's push subscription.

## Testing strategy

| Layer | Tool | Where |
|---|---|---|
| Database rules (RLS, grants, constraints, triggers) | Vitest on **PGlite** (in-process Postgres, no Docker) running the real migration files | `supabase/tests` |
| Pure logic + components | Vitest + Testing Library (happy-dom) | `web/src/**/*.test.ts(x)` |
| Accessibility of the palette | Vitest contrast test over the CSS tokens (WCAG AA, light + dark) | `web/src/theme.contrast.test.ts` |
| UI flows | Playwright (`playwright-core`) against a production build with a mocked Supabase | `web/e2e/smoke.mjs` |

Not covered locally (needs a real project/devices): Edge Functions against real Supabase Auth and the real weather
APIs, `pg_cron`/`pg_net`/Vault scheduling, real Web Push delivery on iPhone/Android. Their pure logic (payloads,
retry/prune decisions, provider parsing, snapshot selection) is unit-tested with real captured responses; the rest is
verified with the RUNBOOK checks (step 6 push spike, step 7 cron/functions).

> Deviation from the original plan: pgTAP was replaced by PGlite-based tests because Docker isn't installed on the
> development machine. Once Docker is available, `supabase test db` (pgTAP) can be added on top.

## Conventions

- All copy lives in `web/src/strings/tr.ts` (typed catalog). Dates/times render in `Europe/Istanbul`, never the device zone.
- Design tokens (colours) live only in `web/src/index.css`; re-branding = edit tokens + `public/icon.svg`.
- Types in `web/src/types/database.ts` are hand-written for now; regenerate from the project once it exists:
  `npx supabase gen types typescript --project-id <ref> > web/src/types/database.ts`.
- Migrations are additive SQL files in `supabase/migrations/`; never edit one that has been applied to production.
