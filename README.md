# Yeni Mahalle Kürek — kulüp uygulaması

Kdz. Ereğli Yeni Mahalle Kürek Kulübü için özel (davetli) antrenman yönetim uygulaması. Antrenörler antrenman ve tekne
programı hazırlar, üyeler katılım bildirir ve kendi teknesini/ekibini görür. Android ve iPhone'da çalışan, mağazasız,
**ücretsiz** bir PWA'dır (ana ekrana eklenen web uygulaması).

> Arayüz yalnızca Türkçedir. Bu doküman geliştirici içindir (İngilizce).

## Status

Phase 1 (foundation) is implemented: username login, coach/member role routing, forced first-login password change,
coach member management (create / reset password / deactivate), installable PWA shell with service worker and Web Push
plumbing, database core + row-level-security tests. Trainings, RSVP, boat programs, attendance, stats and weather are
later phases — see the plan in `docs/ARCHITECTURE.md`.

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
