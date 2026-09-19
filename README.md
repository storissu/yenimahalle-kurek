# Yeni Mahalle Kürek — kulüp uygulaması

Kdz. Ereğli Yeni Mahalle Kürek Kulübü için özel (davetli) antrenman yönetim uygulaması. Antrenörler antrenman ve tekne
programı hazırlar, üyeler katılım bildirir ve kendi teknesini/ekibini görür. Android ve iPhone'da çalışan, mağazasız,
**ücretsiz** bir PWA'dır (ana ekrana eklenen web uygulaması).

> Arayüz yalnızca Türkçedir. Bu doküman geliştirici içindir (İngilizce).

## Status

- **Phase 1 (foundation)** — username login, coach/member role routing, forced first-login password change, coach member
  management, installable PWA shell with service worker and Web Push plumbing, database core + security-rule tests.
- **Phase 2 (trainings & RSVP)** — coaches create/edit/cancel trainings (1–6 one-hour sessions, RSVP deadline); members
  answer *Katılıyorum / Katılmıyorum* with an optional note until the deadline (enforced by the database on the
  **server** clock); coaches see who answered, can answer on a member's behalf, and manage the boats (Mavi, Turuncu, C4X).
- Next: Phase 3 (boat program per hour-session), Phase 4 (attendance, history, monthly leaderboard), Phase 5 (weather +
  notifications). See `docs/ARCHITECTURE.md`.

## Layout

```
web/        React + Vite + TypeScript PWA (the app)
supabase/   Postgres migrations, Edge Functions, DB rule tests
scripts/    one-off operator scripts (create the first coach, generate VAPID keys)
docs/       ARCHITECTURE.md, RUNBOOK.md (setup + operations)
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
| `npm run e2e` | browser smoke test against a preview build with a mocked backend |
| `npm run icons` | regenerate PWA icons from `public/icon.svg` (replace it with the club logo) |

To go live, follow **`docs/RUNBOOK.md`** (Supabase project → deploy functions → first coach → Cloudflare Pages).

## Principles

- The **database is the authority**: roles and rules are enforced by Postgres RLS/constraints, never only by the UI.
- **Zero budget**: everything runs on free tiers (Supabase Free, Cloudflare Pages, GitHub Actions, Open-Meteo).
- Secrets never reach the browser: only the public Supabase URL/anon key ship in the bundle.
