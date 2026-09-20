# Runbook — setup and operations

Everything here uses **free tiers only**. Commands are for **Windows PowerShell** unless noted.
Do the steps in order; each ends with a check so you know it worked.

Legend: 👤 = you do it in a browser/phone · ⌨️ = a command · ✅ = how to verify.

---

## 0. One-time accounts (free)

1. 👤 **GitHub** account → create a **private** repository `yenimahalle-kurek` (no README/gitignore, empty).
2. 👤 **Supabase** account (https://supabase.com — "Continue with GitHub" is fine).
3. 👤 **Cloudflare** account (https://dash.cloudflare.com/sign-up). No card needed for Pages.

Push the code (from the project root; review `git status` first — `.env*`, `node_modules`, `dist` are already ignored):

```powershell
git add -A
git commit -m "Phase 1 foundation"
git remote add origin https://github.com/<your-user>/yenimahalle-kurek.git
git push -u origin main
```

## 1. Supabase project

1. 👤 Supabase dashboard → **New project**: name `yenimahalle-kurek`, plan **Free**, region **Central EU (Frankfurt)**,
   generate a strong **database password** and save it in a password manager.
2. 👤 **Project Settings → API** (or "API Keys"): copy
   - **Project URL** (`https://<ref>.supabase.co`) → the `<ref>` part is your *project ref*
   - **anon / publishable key** → goes into the web app (public by design)
   - **service_role / secret key** → **SECRET**. Used only for the one-off bootstrap script below. Never paste it into the app, chat or GitHub.
3. 👤 **Authentication → Sign In / Providers** (labels may differ slightly):
   - Email provider: **enabled**
   - **Confirm email: OFF** (accounts are created by coaches; there are no email flows)
   - **Allow new users to sign up: OFF** ← this is what makes registration coach-only
   - Password rules: minimum length **8**, require **letters and digits**
4. ✅ Authentication → Users is empty (fine).

## 2. Push keys (Web Push / VAPID)

```powershell
cd scripts
npm install
npm run vapid
cd ..
```

Copy the **Public Key** and **Private Key** it prints. The private key is a secret (like a password); the public key is not.
Do not change these later without telling members to re-enable notifications (all subscriptions become invalid).

## 3. Deploy the website (Cloudflare Pages)

1. 👤 Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → choose your repo.
2. Build settings:
   - Framework preset: **None**
   - **Root directory**: `web`
   - Build command: `npm ci && npm run build`
   - Build output directory: `dist`
3. **Environment variables** (Production):

   | Name | Value |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | the anon / publishable key |
   | `VITE_VAPID_PUBLIC_KEY` | the VAPID **public** key |
   | `VITE_LOGIN_EMAIL_DOMAIN` | `kulup.invalid` |
   | `VITE_FEEDBACK_URL` | *(optional)* a WhatsApp link `https://wa.me/905XXXXXXXXX` or a form address; adds a "Görüş bildir" button to the Yardım page |

4. Save and deploy. ✅ You get an address like `https://yenimahalle-kurek.pages.dev` — this is the app's URL that members will use. Opening it shows the login page.

## 4. Deploy the backend (database + functions)

From the project root:

```powershell
npx supabase login                                  # opens a browser once
npx supabase link --project-ref <ref>               # asks for the database password
npx supabase db push                                # creates tables, security rules, boats, settings
npx supabase functions deploy                       # add --use-api if it complains about Docker
npx supabase secrets set LOGIN_EMAIL_DOMAIN=kulup.invalid `
    ALLOWED_ORIGIN=https://<your-site>.pages.dev `
    VAPID_PUBLIC_KEY=<public key> `
    VAPID_PRIVATE_KEY=<private key> `
    VAPID_SUBJECT=https://<your-site>.pages.dev
```

✅ Dashboard → **Table Editor** shows `profiles`, `boats` (Mavi, Turuncu, C4X), `club_settings`, `push_subscriptions`;
**Edge Functions** lists `admin-create-member`, `admin-reset-password`, `admin-set-active`, `admin-delete-member`, `push-test`,
`send-notifications`, `refresh-weather` (the last two need step 7 to run on schedule).

Then 👤 **Authentication → URL Configuration**: set **Site URL** to your Cloudflare address.

## 5. Create the first coach

There is deliberately no way to sign up in the app, so the first coach is created with a one-off script:

```powershell
cd scripts
$env:SUPABASE_URL = "https://<ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service_role / secret key>"
node bootstrap-coach.mjs --username <kullaniciadi> --name "Ad Soyad"
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY            # don't leave the secret in the session
```

It prints a **one-time temporary password**. ✅ Log in at your site with that username and password → you are asked to
choose a new password → you land on the coach panel. From here on, coaches add members in the app
(**Üyeler → Üye ekle**), and can add more coaches by choosing the role *Antrenör*.

> **If this step fails with an "invalid email" style error:** the placeholder login-email domain (`kulup.invalid`) was
> rejected by Supabase. Tell the developer — the fix is to pick another domain and change `LOGIN_EMAIL_DOMAIN`
> everywhere (Cloudflare variable, Supabase secret, script variable). Do this *before* creating members.

## 6. Notification spike (do this on real phones)

Web Push can only be proven on devices. Ask one iPhone user and one Android user:

**iPhone (iOS 16.4 or newer, Safari):**
1. Open the site in **Safari** → log in.
2. Share button → **Ana Ekrana Ekle** → Ekle.
3. Open the app **from the new home-screen icon** → Profil (member) / Diğer (coach) → **Bildirimleri aç** → *İzin ver*.
4. The badge next to **Bildirimler** must say **Açık**. To see a real push: ask a coach to publish or update a program with **Üyelere bildirim gönder** ticked, then lock the phone. ✅ The notification arrives. (There is no in-app test button; the `push-test` Edge Function still exists for a manual call.)

**Android (Chrome):** same idea — menu ⋮ → *Uygulamayı yükle*, open the app, **Bildirimleri aç**, then publish a program as above. ✅ Notification arrives.

Report back per phone: model, OS version, worked/not worked. Older iPhones (before iOS 16.4) cannot receive web push.

## 7. Weather and automatic notifications (Phase 5)

Three things run **on a schedule inside Supabase** (no server of yours): reminders/summaries every 5 minutes, delivery of
queued push messages every minute (only when something is waiting), and a forecast refresh every 3 hours. They call the
two new Edge Functions with a shared secret, so both sides must know the same value.

1. Make a random secret (any long random text; keep it in your password manager):

   ```powershell
   -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
   ```

2. Give it to the functions, and (optional) an identifying address for the weather providers:

   ```powershell
   npx supabase secrets set CRON_SECRET=<the secret> `
       WEATHER_USER_AGENT="yenimahalle-kurek-club-app/1.0 (https://github.com/<you>/yenimahalle-kurek)"
   npx supabase functions deploy          # deploys send-notifications and refresh-weather too
   ```

3. Give the **same secret** and the project address to the database (Supabase dashboard → **SQL Editor**, run once):

   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<the secret>', 'cron_secret');
   ```

   (Stored encrypted in Supabase Vault — not in the repo. To change one later: Dashboard → *Vault*.)

4. `npx supabase db push` (on a fresh setup step 4 already did it; on an existing one it adds the notification tables,
   the reminder logic and the three schedules — Vault secrets from step 3 must exist by then). If it complains
   that `pg_cron` / `pg_net` are not enabled: Dashboard → **Database → Extensions** → enable both, then push again.

**Check it worked**
- Dashboard → **Database → Cron Jobs** lists `club-scheduled-notifications`, `club-send-push`, `club-refresh-weather`
  and their recent runs (green).
- Create a training for the next few days (as coach) → within a minute every member has a notification in **Bildirimler**
  (and a push if they enabled it). The training page shows **Hava durumu** (or *Yenile* fetches it at once).
- Dashboard → **Edge Functions → send-notifications / refresh-weather → Logs** shows the runs; a `401` means the secret in
  step 2 and step 3 differ.

**How the automatic messages behave** (all Turkish, all also kept in each person's inbox)
| Event | Who gets it |
|---|---|
| New training | all active members |
| Time / deadline changed, cancelled | all active members |
| Reminder: *Yanıt süresi dolmak üzere* | members **without an answer**, `reminder_lead_hours` before the deadline (Kulüp ayarları, default 3 h). Not sent for trainings created less than an hour ago or once the deadline has passed |
| *Yanıt süresi doldu* | all coaches, once, after the deadline (X katılıyor, Y katılmıyor, Z yanıt yok) |
| Program published | each crew member gets a personal message (boat, hour, crew mates); other attendees get "program yayınlandı" |
| Program updated | everyone in a boat-hour that changed. The coach can untick **Üyelere bildirim gönder** for a silent fix |

Delivery failures are retried up to 5 times; a device that answers "gone" (404/410) is forgotten automatically.
Messages older than 60 days are removed from the inbox.

**Weather**: forecast from Open-Meteo (free, non-commercial; the app shows the required attribution) with MET Norway
as fallback (no gusts/waves then). Values are for the site coordinates in `club_settings`; waves come from an offshore model and are
indicative near the coast. **Kulüp ayarları** (coach → Diğer) sets the gust / wave thresholds; when a forecast crosses
one, only coaches see a warning. Nothing is ever cancelled automatically.

## 8. Keep-alive and encrypted backups (Phase 6)

Two GitHub workflows protect the free Supabase project. Both need **repository secrets**
(GitHub → your repo → **Settings → Secrets and variables → Actions → New repository secret**). Secrets are encrypted by
GitHub and never appear in the code.

**8.1 Keep-alive** (`.github/workflows/keepalive.yml`, every 3 days) — stops the free project from being paused for inactivity.

| Secret | Value |
|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | the anon / publishable key (the same public value as in Cloudflare) |

Run it once: **Actions → Keep-alive → Run workflow**. ✅ The log ends with "The project answered with its clock: …".
If a later run turns red, GitHub e-mails you: open the Supabase dashboard → **Restore project** (it was paused).
(Needs migration `20260921100000_audit_log` — it adds the tiny public `ping()` function the workflow calls.)

**8.2 Weekly encrypted backup** (`.github/workflows/backup.yml`, Sundays 03:23 UTC) — the free plan has **no** automatic backups.

| Secret | Value |
|---|---|
| `SUPABASE_DB_URL` | Supabase dashboard → **Connect** → **Session pooler** connection string, with `[YOUR-PASSWORD]` replaced by your database password. Use the *pooler* string: the "direct" address is IPv6-only and GitHub's runners are IPv4 |
| `BACKUP_PASSPHRASE` | a long random passphrase you keep in your **password manager**. **Without it a backup cannot be opened — nobody can recover it for you.** Generate one: `-join ((48..57)+(65..90)+(97..122) \| Get-Random -Count 32 \| ForEach-Object {[char]$_})` |

**How to build `SUPABASE_DB_URL` correctly** (a wrong string is the usual reason a first run fails with *"password authentication failed"*):
1. Supabase dashboard → **Connect** → tab **Session pooler** (not "Direct connection", not "Transaction pooler"). Copy the string. It looks like
   `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`.
2. The user must be **`postgres.<project-ref>`** (with the project reference after the dot) — keep it exactly as copied.
3. Replace `[YOUR-PASSWORD]` — **brackets included** — with the database password. If the password contains `@ # / ? : %` the URL breaks:
   the simplest fix is a new password of **letters and digits only** (Supabase → Project Settings → Database → **Reset database password**; then update the password in your `supabase link` notes too).
4. Paste the whole string into the secret. The workflow now checks the string's shape and tests the login first, and tells you in plain words what is wrong.

Run it once: **Actions → Weekly encrypted backup → Run workflow**. ✅ Green run, and an artifact `club-backup-<date>` (a `.gpg` file) at the bottom of the run page. Backups are kept 90 days (GitHub's maximum) — download the newest one now and then and keep a copy somewhere else (a USB stick, your own cloud).
What is inside: the whole `public` schema (all club data + security rules) and the login accounts (`auth.users`, `auth.identities`, so members keep their passwords). The unencrypted dump exists only inside the runner for a few seconds and is wiped.

**8.3 Restore drill — do this once before you rely on the backups**

You need: the passphrase, [Gpg4win](https://www.gpg4win.org) (or `gpg`), and the PostgreSQL command-line tools (`psql`).

1. 👤 Download the artifact from the Actions run page (a zip containing the `.gpg`), unzip it.
2. ⌨️ Decrypt and unpack:
   ```powershell
   gpg --decrypt club-YYYYMMDD-HHMM.tar.gpg > club.tar     # asks for the passphrase
   tar -xf club.tar                                          # gives public.sql and auth.sql
   ```
3. 👤 Create a **new, empty** Supabase project (a scratch one for the drill; the real one for a real disaster) and copy its **Session pooler** connection string.
4. ⌨️ Load the data — **auth first** (profiles refer to the accounts):
   ```powershell
   psql "<new session pooler string>" -f auth.sql
   psql "<new session pooler string>" -f public.sql
   ```
   (Errors about objects that "already exist" in `auth` can be ignored; anything about `public` tables should not appear.)
5. Re-attach the rest, exactly as in steps 3–4 and 7 above: Cloudflare variables for the new URL/anon key, `supabase link` + `supabase secrets set …` + `supabase functions deploy`, then in the SQL Editor the Vault secrets and the two schedule files
   (`supabase/migrations/20260919160100_schedule.sql`, `20260921100100_audit_schedule.sql`). Tell the CLI the schema is in place:
   `npx supabase migration repair --status applied 20260919120000 20260919120100 20260919130000 20260919140000 20260919150000 20260919160000 20260919160100 20260920100000 20260921100000 20260921100100`.
6. ✅ Log in with a coach's old username and password; check *Antrenmanlar*, *Üyeler* and last month's *İstatistik*. Members' phones must log in again (new project = new sessions) with the **same passwords**.
7. Delete the scratch project and the decrypted files (`del club.tar public.sql auth.sql`).

Second safety net: the coach can export monthly attendance as **CSV** (*İstatistik → Özet / Ayrıntılı*) — do it at the end of each month; it opens in Excel.

**8.4 Change history** — *Diğer → Değişiklik geçmişi* (coaches only) lists who created/edited/cancelled trainings, published programs, saved attendance, answered for a member, created/deactivated accounts, reset passwords or changed boats/settings — with the day, time and coach, never passwords or phone numbers. Entries are kept one year.

---

## 9. Go-live and pilot (Phase 7)

**9.1 Check the deployed app from the outside — `preflight`**

After every change to Cloudflare or Supabase settings, and before the pilot, run this from the project root
(it uses only public values and changes nothing; the anon key is the same one that is in Cloudflare):

```powershell
node scripts/preflight.mjs --site https://<your-site>.pages.dev --supabase https://<ref>.supabase.co --anon-key <anon key>
```

✅ Every line says `PASS` (a `WARN` is advice). It checks: https; the login page and deep links open the app; the security
headers really arrived (CSP, nosniff, no `unsafe-eval`); the CSP lets the app reach Supabase; the manifest and `sw.js` are not
cached; the database answers `ping()` (migrations applied); **sign-up is closed**; anonymous visitors **cannot read** any club
table or call internal functions; the Edge Functions answer **only your site** (CORS) and refuse callers who are not signed in.
A `FAIL` line says what to fix (for example `ALLOWED_ORIGIN`, a missing `db push`, or sign-up left on).

**9.2 The pilot** — follow `docs/PILOT.md`: the ready-checklist, who takes part, the two-week plan, how feedback is collected, the
scorecard for the go / no-go decision, the rollout after a "go", and the monthly routine afterwards.

**9.3 Material to hand out** (Turkish): `docs/tr/UYE-REHBERI.md`, `docs/tr/ANTRENOR-REHBERI.md`, `docs/tr/DAVET-MESAJI.md` (WhatsApp texts).
The same answers are inside the app under *Profil → Yardım* (members) and *Diğer → Yardım* (coaches); set `VITE_FEEDBACK_URL`
in Cloudflare (a WhatsApp link like `https://wa.me/905XXXXXXXXX`, or a form) to add a **Görüş bildir** button there.

**9.4 After updating to the profile / leaderboard release** — run `npx supabase db push` once (migration
`20260922100000_shared_history_leaderboard`: `shared_boat_history()` and a leaderboard that lists every active member),
then deploy the website as usual. Until the push, the profile page shows "Birlikte kürek çekme geçmişi yüklenemedi" and the
leaderboard still hides members without sessions; nothing else is affected.

**9.7 After updating to the "members edit their own phone" release** — `npx supabase db push` (migration `20260925100000_update_my_phone`),
then deploy the website. Until the push, saving a number on the profile shows an error and changes nothing.

**9.6 After updating to the "independent boat schedules" release** — in this order: (1) `npx supabase db push` (migration
`20260924100000_boat_schedules`: session times, `trainings.ends_at`, time-aware history/export; existing programs are converted
to their old hourly times automatically), (2) `npx supabase functions deploy` (`refresh-weather` now forecasts each session at
its own start), (3) deploy the website. The migration is safe to apply before the new website: an older website keeps working
(it sends no times, the old hourly grid applies) but cannot use the new editor.

**9.5 After updating to the "Üyeler tab / member deletion" release** — three steps, in this order:
1. `npx supabase db push` (migration `20260923100000_member_history_and_delete`: a `deleted_at` column, `member_training_history()` for
   the profile's "Tüm antrenmanlar" tab, and `delete_member()`).
2. `npx supabase functions deploy` (the new `admin-delete-member`; `admin-reset-password` / `admin-set-active` now also refuse deleted members).
3. Deploy the website.
Until step 1, the "Tüm antrenmanlar" tab shows "Geçmiş yüklenemedi" (the coach's member list is not affected); until step 2, **Üyeyi sil**
answers with an error and changes nothing. The privacy text changed too (other members now see a member's attended
trainings) — show it to the club board before rolling out (see docs/SECURITY.md 7b).

## Local development

```powershell
cd web
npm install
copy .env.example .env.local        # fill in URL + anon key (same values as Cloudflare)
npm run dev                          # http://localhost:5173
```

The dev server has **no service worker**. To test install/offline/push locally: `npm run build; npm run preview`.

Quality gates (also run in CI): `npm run lint`, `npm run typecheck`, `npm test` (in `web/`), `npm test` (in `supabase/tests/`).

Browser smoke test (mocked backend, no Supabase needed):

```powershell
cd web
$env:VITE_SUPABASE_URL="https://test.supabase.co"; $env:VITE_SUPABASE_ANON_KEY="a"*40
npx vite build --outDir dist-smoke ; Remove-Item Env:VITE_SUPABASE_URL, Env:VITE_SUPABASE_ANON_KEY
Start-Process npx -ArgumentList "vite preview --outDir dist-smoke --port 4173" ; Start-Sleep 4
$env:BROWSER_CHANNEL="msedge" ; npm run e2e       # uses the Edge already installed on Windows
```

## Operations

| Situation | What to do |
|---|---|
| Add a member / coach | App → Üyeler → Üye ekle → copy the invite message and send it (WhatsApp etc.). The password is shown once. The phone number is optional; **other members can see it** (crew cards, the *Üyeler* tab), and the form says so; a coach can change it later (tap the member → *Telefon*) |
| Member forgot password | Üyeler → tap the member → **Şifreyi sıfırla** |
| Member left the club | Üyeler → tap → **Hesabı devre dışı bırak** (history stays; they can't log in; reversible). To remove the person for good: **Üyeyi sil** — login, name, phone gone; attendance stays as "Eski üye" |
| **All coaches locked out** | Run `node bootstrap-coach.mjs --username <coach> --reset` (step 5 env vars) → prints a new temporary password |
| Ship an app update | Merge/push to `main` → Cloudflare rebuilds → members see a "Yeni sürüm hazır — Yenile" banner |
| **Update after new features** | When a new version adds migrations (Phases 2–5 and the feedback round `20260920100000_coach_feedback` do), run `npx supabase db push` once, then let Cloudflare redeploy the site. Existing data is kept |
| Members say they get no reminders / forecasts | Dashboard → Database → **Cron Jobs**: are the three `club-*` jobs listed and green? Then Edge Functions → Logs (`401` = `CRON_SECRET` differs from the Vault `cron_secret`). See step 7 |
| Change the reminder time or weather warning limits | App → Diğer → **Kulüp ayarları** |
| Change database | Add a **new** file in `supabase/migrations/` (never edit an applied one), run tests, then `npx supabase db push` |
| Supabase project paused | Free projects pause after ~1 week of inactivity: dashboard → **Restore project**. The *Keep-alive* workflow (step 8.1) prevents it and e-mails you if it happens anyway |
| Backups | Weekly encrypted backup workflow (step 8.2) + restore drill (8.3) + the coach's monthly CSV export. **Check once a month that the last backup run is green** |
| Who changed something? | App → Diğer → **Değişiklik geçmişi** (step 8.4) |

## Troubleshooting

- **App shows "Uygulama yapılandırılmamış"**: a `VITE_*` variable is missing/invalid. Fix in Cloudflare (or `.env.local`) and redeploy.
- **Login says "Kullanıcı adı veya şifre hatalı" for a correct password**: usernames are lower-case ASCII; check `LOGIN_EMAIL_DOMAIN` is identical in Cloudflare, Supabase secrets and the script.
- **Add member fails with a 401/403/500**: Supabase → Edge Functions → *Logs*; confirm the functions were deployed and the caller is an active coach.
- **The app says "Bağlantı kurulamadı" only for actions that call Edge Functions (add member, reset password, refresh weather)**: `ALLOWED_ORIGIN` is missing or wrong. It must be exactly your site address (`https://<your-site>.pages.dev`, no path, no `*`); the functions refuse to answer browsers otherwise. `npx supabase secrets set ALLOWED_ORIGIN=https://<your-site>.pages.dev`.
- **The installed app (Home Screen icon) is blank or says "Uygulama açılamadı" on some phones, but works with a VPN such as 1.1.1.1 WARP**: that phone's network drops the app's files (Safari reports "The network connection was lost"); the site and Supabase themselves are fine. The app reloads itself once, then shows the failed file name under "Hata ayrıntısı". Try in this order on the affected iPhone: (1) the other connection (Wi-Fi ↔ mobile data); (2) Settings → Safari → Advanced → Feature Flags → **HTTP/3** off (iOS 18: Settings → Apps → Safari), then delete the icon and add it again from Safari; (3) turn off iCloud **Private Relay** and "Limit IP Address Tracking" for the network. If (2) is what fixes it, the carrier drops QUIC/HTTP/3: `*.pages.dev` cannot turn HTTP/3 off, only a custom domain on Cloudflare can, which costs a domain name. Decide that with the club before spending anything.
- **Browser console shows CSP errors**: edit `web/public/_headers` (`connect-src` must allow your Supabase URL).
- **No notification on iPhone**: needs iOS ≥ 16.4, the app added to the Home Screen and opened from that icon, and permission granted (Ayarlar → Bildirimler → YSK).
