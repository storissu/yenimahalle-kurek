# Pilot and rollout plan (Phase 7)

The app is built and tested. What is left is the part no test can do: **real people, real phones, real trainings.**
The pilot is a two-week trial with a small group, run **alongside** the current WhatsApp routine, that ends in an
explicit **go / no-go** decision. Nothing about the club's routine is put at risk: if the app fails, everybody carries on as before.

Documents to hand out: `docs/tr/UYE-REHBERI.md` (members), `docs/tr/ANTRENOR-REHBERI.md` (coaches),
`docs/tr/DAVET-MESAJI.md` (WhatsApp texts). The same help is inside the app (*Profil / Diğer → Yardım*).

---

## 1. Before the pilot starts (the "ready" checklist)

Everything here must be ticked. Most items are already verified in earlier phases; this is the last look.

**Software and hosting**
- [ ] `git` is pushed; **CI is green** on `main` (lint, types, unit, database, browser + accessibility scans, dependency audit).
- [ ] `npx supabase db push` has applied **every** migration (last one: `20260924100000_boat_schedules`); `npx supabase functions deploy` is done; secrets are set (`ALLOWED_ORIGIN`, `LOGIN_EMAIL_DOMAIN`, VAPID, `CRON_SECRET`).
- [ ] **`node scripts/preflight.mjs --site https://<site>.pages.dev --supabase https://<ref>.supabase.co --anon-key <anon key>` shows no FAIL** (RUNBOOK 9.1). A WARN about the wide `connect-src` is advice: tighten it before the wider rollout.
- [ ] Supabase Auth: sign-up **off**, confirm e-mail **off**, password rules min. 8 + letters and digits (preflight checks the first).
- [ ] Optional: `VITE_FEEDBACK_URL` set in Cloudflare (a WhatsApp link or a form) so the *Görüş bildir* button works.

**Safety nets**
- [ ] *Keep-alive* and *Weekly encrypted backup* workflows are green; **a backup was restored once** into a scratch project (RUNBOOK 8.3). ✅ done
- [ ] Two people know where the backup passphrase and the Supabase/Cloudflare/GitHub logins are kept (password manager).
- [ ] At least two **coaches** exist (a lost coach password must not lock the club out; RUNBOOK "All coaches locked out").

**People and paperwork**
- [ ] The club board has **read and approved the privacy notice** (*Profil → Gizlilik bildirimi*; it is marked as a draft in the app until you remove `tr.privacy.draftNotice`). It states that **phone numbers are visible to other members**.
- [ ] The pilot group is chosen (section 2) and has agreed to take part.
- [ ] Members' phones checked: iPhones on **iOS 16.4 or newer** (Settings → General → About → iOS Version); anyone older uses the in-app inbox and WhatsApp for reminders.
- [ ] Pilot accounts created (*Üyeler → Üye ekle*) and invites ready to send.

**Clean start** — the pilot uses the same database as the real launch. If you created test trainings/members during development,
either keep them out of the pilot group's view or clear them first (section 7).

## 2. Who takes part

| Who | How many | Why |
|---|---|---|
| Coaches | **2** (everyone who will use the app) | they do the real work: trainings, programs, attendance |
| Members | **6–10** | a mix, chosen on purpose (below) |

Choose members so that you learn something:
- **≥ 2 iPhones** (one with the oldest iOS in the club) and **≥ 2 Android** phones (one with aggressive battery saving, e.g. Xiaomi/Huawei/Samsung).
- **≥ 1 member who is not comfortable with technology** — if they can use it, everyone can.
- **≥ 1 member who rows often, ≥ 1 who rows rarely** (different parts of the app: leaderboard, history).
- Someone who can give **blunt feedback**.

## 3. What the two weeks must contain

Run **at least four trainings**, so each of these happens for real at least once:

- [ ] A training with **several sessions** (2+ hours) and a **C4X** crew of exactly four.
- [ ] The **RSVP lock** meeting real life: a member asks to change their answer after the program is published (the coach uses *Yanıtlar → satıra dokun*).
- [ ] A **program update** after publishing (someone drops out) — check who gets a notification.
- [ ] A **cancellation** because of weather, with the reason.
- [ ] **Attendance recorded and completed** in the app for every training, and the monthly leaderboard looked at.
- [ ] A **forgotten password** (reset by the coach).
- [ ] The **reminder** to members who have not answered, and the coach's "yanıt süresi doldu" summary, arrive on real phones.
- [ ] Weather thresholds set by the coaches (*Kulüp ayarları*) and a warning seen at least once (or a look at the forecast against reality).

## 4. The plan, day by day

| When | What | Who |
|---|---|---|
| **Day 0** (30–45 min, in person or video) | Everyone installs the app *together*: Add to Home Screen, first login, new password, notifications on, one test notification. Show *Yardım*. Explain the rules: answer in the app; WhatsApp stays as the fallback. | coaches + pilot members |
| **Days 1–6** | Normal training life. Coach creates each training in the app. Keep a **paper/WhatsApp note of anything odd** (see section 5). | all |
| **Day 7** (15-min call or chat) | Week-1 review: what confused people, what did not arrive, what took long. Fix quick wins; note bigger ones. | coaches (+ 2–3 members) |
| **Days 8–13** | Second week; nobody is reminded to use the app except through the app itself. | all |
| **Day 14** (30 min) | End-of-pilot meeting: the scorecard (section 6), then **go / no-go**. | coaches + board |

## 5. How feedback is collected

- One WhatsApp group, **"Kürek uygulama deneme"**, for everything (or the *Görüş bildir* button if `VITE_FEEDBACK_URL` is set).
- Ask for the same five facts each time: **what phone (model, iOS/Android version) · what screen · what they did · what they expected · what happened** (a screenshot helps).
- The coach keeps a simple list; each item gets a priority:

| Priority | Meaning | Example | Rule |
|---|---|---|---|
| **P1** | The club cannot work or data is wrong/lost | nobody can log in; wrong program shown; attendance lost | stop, fix, tell everyone; **blocks go-live** |
| **P2** | A feature is broken but there is a workaround | notification did not arrive on one phone type | fix before the wider rollout |
| **P3** | Annoying or confusing, not harmful | unclear wording, extra tap | collect; do in a batch |

- What the coach can see without asking: *Diğer → Değişiklik geçmişi* (who did what), each member's **bildirim kutusu** is on their own phone, attendance and history in the app.
- **No usage tracking is built in** (privacy). Measure by asking and counting (section 6).

## 6. Scorecard and go / no-go (Day 14)

| Measure | How | Go if |
|---|---|---|
| Members answering RSVPs **in the app** | count answered vs. WhatsApp answers over the 4+ trainings | ≥ 80 % of pilot members answered ≥ 3 of 4 trainings in the app |
| Notifications reach phones | each member: "did you get the new-training / reminder / program message?" — per platform | ≥ 90 % on iPhone **and** on Android (missed ones are still in the inbox) |
| Programs correct | coach compares published program with what happened | no wrong program shown to members |
| Attendance in the app | trainings with completed attendance ÷ trainings held | 100 % |
| Data safety | any lost or wrong data? | **0 incidents** (P1) |
| Coach effort | coach's own estimate: minutes to run one training vs. before | not worse than before; ideally better |
| Understanding | can the "non-technical" member do RSVP + find their boat unaided? | yes |
| Operations | backups and keep-alive green both weeks; `preflight` still green | yes |
| Open problems | list | **no open P1**; every P2 has an owner and a date |

**Go** = all rows met → roll out (section 8). **Go with conditions** = only P2/P3 gaps → fix, extend the pilot a week for those points.
**No-go** = any P1, or adoption/notification rows clearly missed → keep WhatsApp as the only channel, fix, repeat a shorter pilot.

## 6b. What to tell participants (and be honest about)

- It is a **trial**; WhatsApp remains the safety net for two weeks.
- iPhones need **iOS 16.4+** and the app opened **from the Home Screen icon** for notifications; Android battery saving can delay them.
- Wave data is indicative near the coast; **the coach decides** about training in bad weather.
- **Phone numbers are visible to other members.**
- Weather, notifications and backups run on **free services**; short outages are possible (the app shows what is already loaded).
- Real screen-reader users: tell the coaches, so accessibility issues get reported (`docs/ACCESSIBILITY.md`).

## 7. Starting clean after the pilot (optional, documentation only)

The pilot's trainings, answers and attendance are real club data, so you may want to **keep** them. If you prefer a fresh start
(or created test data earlier), do it in the Supabase **SQL Editor**, **after exporting the CSVs** you want to keep.
Order matters — trainings first (this cascades to answers, programs, crews, attendance, forecasts), then people:

```sql
-- A. keep the coaches and the members, delete all trainings and what hangs on them
begin;
delete from public.trainings;
delete from public.notification_outbox;
commit;
```
```sql
-- B. ALSO remove all members (keeps coaches only; run A first, in the same or a separate transaction)
begin;
create temp table doomed on commit drop as select id from public.profiles where role = 'member';
delete from public.profiles where id in (select id from doomed);   -- profiles before their login accounts
delete from auth.users      where id in (select id from doomed);
commit;
```
Nothing else is affected (boats, settings, coaches' logins, push subscriptions of coaches, cron jobs, secrets). The change history
(`audit_log`) keeps its lines; that is intended. Take a manual backup first (Actions → Weekly encrypted backup → Run workflow).

## 8. Rollout after a "go"

1. **Create the remaining members** (*Üyeler → Üye ekle*) in one sitting; send each their personal invite (*Davet mesajını kopyala*). Send the group announcement (`docs/tr/DAVET-MESAJI.md`, text 1).
2. **Run a 30-minute install session** at the club (bring the pilot members as helpers); anyone stuck gets help on the spot.
3. **Keep WhatsApp for two more weeks** as a mirror (short "yeni antrenman eklendi" reminders), then stop.
4. Tighten `connect-src` in `web/public/_headers` to the exact project URL (preflight tells you how) and redeploy.
5. Replace the privacy notice's draft label once the board has approved the text.
6. Add the club logo/colours later by editing the design tokens (`web/src/index.css`) and `web/public/icon.svg` (`npm run icons`).

## 9. Rollback

Nothing is destructive: stop using the app and return to WhatsApp. Data stays in the database; CSV export (*İstatistik*) and the weekly encrypted backup keep it safe. If something must be undone, restore the newest backup into a new project (RUNBOOK 8.3).

## 10. After launch — monthly routine (15 minutes, one named person)

- [ ] Actions tab: last **Weekly encrypted backup** and **Keep-alive** runs are green. (Red run = fix the same day; GitHub e-mails you.)
- [ ] Merge or reject the **Dependabot** pull requests once CI is green.
- [ ] Coaches export the month's **CSV** (*İstatistik*) and keep it.
- [ ] *Üyeler*: deactivate members who left; check that at least **two active coaches** exist.
- [ ] Supabase dashboard → Database → usage: far below the free limit (the club's data is a few MB per year).
- [ ] Glance at *Değişiklik geçmişi* for anything surprising.
- [ ] Once a quarter: run `node scripts/preflight.mjs …` again and do a **restore drill**.
