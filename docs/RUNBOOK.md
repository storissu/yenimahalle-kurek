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
**Edge Functions** lists `admin-create-member`, `admin-reset-password`, `admin-set-active`, `push-test`.

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
4. Tap **Test bildirimi gönder**, then lock the phone. ✅ A notification "Test bildirimi başarıyla ulaştı" appears.

**Android (Chrome):** same idea — menu ⋮ → *Uygulamayı yükle*, open the app, **Bildirimleri aç**, **Test bildirimi gönder**. ✅ Notification arrives.

Report back per phone: model, OS version, worked/not worked. Older iPhones (before iOS 16.4) cannot receive web push.

---

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
| Add a member / coach | App → Üyeler → Üye ekle → copy the invite message and send it (WhatsApp etc.). The password is shown once |
| Member forgot password | Üyeler → tap the member → **Şifreyi sıfırla** |
| Member left the club | Üyeler → tap → **Hesabı devre dışı bırak** (history stays; they can't log in) |
| **All coaches locked out** | Run `node bootstrap-coach.mjs --username <coach> --reset` (step 5 env vars) → prints a new temporary password |
| Ship an app update | Merge/push to `main` → Cloudflare rebuilds → members see a "Yeni sürüm hazır — Yenile" banner |
| Change database | Add a **new** file in `supabase/migrations/` (never edit an applied one), run tests, then `npx supabase db push` |
| Supabase project paused | Free projects pause after ~1 week of inactivity: dashboard → **Restore project**. A keep-alive workflow is planned (Phase 6) |
| Backups | Not automatic on the free tier. Planned (Phase 6): weekly encrypted export + CSV export in the coach panel. Until then, export tables from the dashboard periodically |

## Troubleshooting

- **App shows "Uygulama yapılandırılmamış"**: a `VITE_*` variable is missing/invalid. Fix in Cloudflare (or `.env.local`) and redeploy.
- **Login says "Kullanıcı adı veya şifre hatalı" for a correct password**: usernames are lower-case ASCII; check `LOGIN_EMAIL_DOMAIN` is identical in Cloudflare, Supabase secrets and the script.
- **Add member fails with a 401/403/500**: Supabase → Edge Functions → *Logs*; confirm the functions were deployed and the caller is an active coach.
- **Browser console shows CSP errors**: edit `web/public/_headers` (`connect-src` must allow your Supabase URL).
- **No notification on iPhone**: needs iOS ≥ 16.4, the app added to the Home Screen and opened from that icon, and permission granted (Ayarlar → Bildirimler → Kürek).
