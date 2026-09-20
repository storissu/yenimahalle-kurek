# Yeni Mahalle Kürek — kulüp uygulaması

Kdz. Ereğli Yeni Mahalle Kürek Kulübü için özel (davetli) antrenman yönetim uygulaması. Antrenörler antrenman ve tekne
programı hazırlar, üyeler katılım bildirir ve kendi teknesini/ekibini görür. Android ve iPhone'da çalışan, mağazasız,
**ücretsiz** bir PWA'dır (ana ekrana eklenen web uygulaması).

> Arayüz yalnızca Türkçedir. Bu doküman geliştirici içindir (İngilizce).

## Status

- **Phase 1 (foundation)** — username login, coach/member role routing, forced first-login password change, coach member
  management, installable PWA shell with service worker and Web Push plumbing, database core + security-rule tests.
- **Phase 2 (trainings & RSVP)** — coaches create/edit/cancel trainings (RSVP deadline; the length follows from the program, see the feedback round below); members
  answer *Katılıyorum / Katılmıyorum* with an optional note until the deadline (enforced by the database on the
  **server** clock); coaches see who answered, can answer on a member's behalf, and manage the boats (Mavi, Turuncu, C4X).
- **Phase 3 (boat program)** — coaches build the program hour by hour (Mavi / Turuncu / C4X; boats on the water together,
  different crews per hour), with weather and training notes; save as a draft or publish. Members see only published
  programs, with **their own boat, hour and crew mates first** on Home and on the training page.
- **Phase 4 (attendance, history, statistics)** — after (or during) a training the coach records who actually rowed
  **each hour**, starting from the boat crews and adding walk-ins; finishing marks the training completed. Members see
  their own history (hours rowed per training, older trainings on request), a monthly **sessions** count and the
  monthly leaderboard (everyone sees it; it starts fresh each calendar month; ties share a place). Coaches get the
  month table for every member, a per-member history and Excel-friendly CSV exports.
- **Phase 5 (weather + notifications)** — each training shows an hour-by-hour **forecast** (wind, gusts, waves, rain;
  Open-Meteo with MET Norway fallback); coaches set gust/wave limits and get a warning when one is reached (nothing is
  cancelled automatically). Members get an in-app **inbox** with a bell badge plus Web Push for: new training, changes and
  cancellations, a **reminder to those who haven't answered**, a coach summary after the deadline, and the program
  (a personal "your boat, your hour, your crew" message). Delivery is queued, retried and scheduled inside Supabase.
- **Feedback round after the first tests** — the answer is locked once the coach publishes the program; members see
  the **whole program grouped by boat** (own sessions highlighted); a **C4X must have exactly 4 people** to be
  published; the coach no longer enters a number of sessions — **sessions are added while preparing the program** and
  the training's length follows from it; new RSVP deadline option **"Bir önceki akşam 20:00"**; members can see each
  other's **phone numbers** (crew names open a contact card, the *Üyeler* tab).
- **Phase 6 (hardening)** — coaches get a **Değişiklik geçmişi** (who changed what, kept a year); free-tier safety nets:
  a **keep-alive** workflow and a **weekly encrypted backup** with a documented restore drill; an **accessibility pass**
  (skip link, page titles and focus on navigation, arrow-key radio groups, axe-core scans of ~45 screens in light and
  dark, offline saves that fail fast instead of hanging); a **security review** kept true by tests (a reviewed
  snapshot of every grant, RLS and definer function; secret scanner; dependency audit; fail-closed CORS). See `docs/SECURITY.md`.
- **Phase 7 (pilot and rollout)** — in-app **Yardım** (FAQ for members and for coaches, optional *Görüş bildir* feedback link);
  Turkish guides and WhatsApp texts (`docs/tr/`); `docs/PILOT.md` (ready-checklist, two-week plan, scorecard and go / no-go,
  rollout, monthly routine); `scripts/preflight.mjs`, a check of the **deployed** site and Supabase project from the outside.
- Next: run the pilot (`docs/PILOT.md`), then go live. See `docs/ARCHITECTURE.md`.

## Layout

```
web/        React + Vite + TypeScript PWA (the app)
supabase/   Postgres migrations, Edge Functions, DB rule tests
scripts/    one-off operator scripts (create the first coach, generate VAPID keys)
docs/       ARCHITECTURE.md, RUNBOOK.md (setup + operations), PILOT.md (pilot + rollout plan), tr/ (Turkish guides), SECURITY.md (threat model + review checklist), ACCESSIBILITY.md (what is
            checked automatically + the manual screen-reader checklist)
```

## Quick start (development)

Requirements: Node 22+, npm. (Docker is **not** required.)

```bash
# 1. database rules — runs the real migrations on an in-process Postgres (PGlite)
cd supabase/tests && npm install && npm test

# 2. the app
cd web && npm install
cp .env.example .env.local        # then fill in your Supabase URL + anon key (see docs/RUNBOOK.md)
npm run dev
```

| Command (in `web/`) | What it does |
|---|---|
| `npm run dev` | dev server (no service worker in dev) |
| `npm run build` / `npm run preview` | production build (typecheck + Vite + service worker) / serve it locally |
| `npm run typecheck`, `npm run lint`, `npm test` | quality gates (all run in CI) |
| `npm run e2e` | browser smoke test (incl. axe accessibility scans) against a preview build with a mocked backend |
| `npm run icons` | regenerate PWA icons from `public/icon.svg` (replace it with the club logo) |

To go live, follow **`docs/RUNBOOK.md`** (Supabase project → deploy functions → first coach → Cloudflare Pages).

## Principles

- The **database is the authority**: roles and rules are enforced by Postgres RLS/constraints, never only by the UI.
- **Zero budget**: everything runs on free tiers (Supabase Free, Cloudflare Pages, GitHub Actions, Open-Meteo).
- Secrets never reach the browser: only the public Supabase URL/anon key ship in the bundle.
