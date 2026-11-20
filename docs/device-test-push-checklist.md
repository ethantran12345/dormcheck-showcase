# DormCheck push — on-device test checklist

Goal: prove each push type actually lands on a real iPhone, and catch the three silent-failure gotchas. Work top to bottom.

## 0. Config confirms (do these first — each is a silent failure if wrong)
- [ ] **Vercel token matches.** In Vercel → Settings → Environment Variables (Production), `SEND_PUSH_AUTH_TOKEN` = the rotated value `31446442…`. If it holds an older value, message/broadcast/cron pushes 401 (the DB-trigger ones still work — that's the tell).
- [ ] **`SUPABASE_URL`** present in Vercel Production = `https://abcdefghijklmnopqrst.supabase.co`.
- [ ] **`CRON_SECRET`** present in Vercel Production. If you added any of these *after* the `8b821f0` deploy, **redeploy** so they take effect.
- [ ] **`APNS_ENV` matches the build.** On the Supabase `send-push` function secrets: `production` for a TestFlight build, `sandbox` for a dev/Xcode build. Mismatch = every device 400s (BadDeviceToken). Set it deliberately: `npx supabase secrets set APNS_ENV=production`.

## 1. Install & register
- [ ] Install the build (TestFlight = production, Xcode = sandbox — must match APNS_ENV above).
- [ ] Log in, and **tap Allow** on the notification permission prompt. (If you dismissed it: iOS Settings → DormCheck → Notifications → enable, or delete + reinstall.)
- [ ] A `device_tokens` row should appear for your user. (Ask me and I'll confirm it landed — there are already 10 registered in prod.)

## 2. Trigger each push type
Use a second account for the "from" side. Lock the phone to see background banners; also try with the app open (foreground shows an in-app toast).

- [ ] **Direct message** — second account sends you a DM → expect a "new message" push → tap → lands on the conversation thread.
- [ ] **Roommate confirmed** — second account accepts your roommate invite → you (group owner) get "You've got a roommate" → tap → `/checklist?confirmRoommates=1`.
- [ ] **Building digest** — set the second account on-campus, same dorm, show-in-building ON → you get "N new people joined <dorm>" → tap → dorm People tab.
- [ ] **Admin broadcast** — from `/admin/broadcast` (superadmin) send a test to just yourself → expect the push.
- [ ] **Move-in countdown** — the cron runs daily at 15:00 UTC. To test on demand, set your `move_in_date` to exactly 35, 14, 7, or 1 days out, then fire the endpoint manually:
  ```
  curl -X POST -H "Authorization: Bearer <CRON_SECRET>" https://dormcheck.com/api/cron/movein-countdown
  ```
  Expect a countdown push if you're on a milestone. (Re-runs the same day won't double-send — the log dedupes.)

## 3. Where to look if something doesn't arrive
- **Supabase → Edge Functions → `send-push` → Logs**: per-token APNs status. `400 BadDeviceToken` = APNS_ENV/build mismatch; `410` = stale token (auto-pruned); `200` = delivered.
- **DB-trigger pushes** (roommate/building): query `select status_code, content from net._http_response order by created desc limit 5;` — 200 good, 401 = token mismatch between `private.push_config` and the function secret.
- **Vercel → Deployments → Functions logs** for `notify-*`, `admin/broadcast`, `cron/movein-countdown`: a 401 here = Vercel's `SEND_PUSH_AUTH_TOKEN` doesn't match.
- **Push arrives but tap does nothing** = deep-link route mismatch; note which type and I'll check the route map.

## Quick failure → cause map
| Symptom | Cause |
|---|---|
| Nothing arrives, `400 BadDeviceToken` in send-push logs | APNS_ENV ≠ build type |
| Trigger pushes work, message/broadcast/cron don't | Vercel `SEND_PUSH_AUTH_TOKEN` ≠ rotated token |
| Countdown never fires | `CRON_SECRET` missing, or added without a redeploy |
| No push + no permission prompt | permission denied — reinstall / iOS Settings |
| Push lands, tap goes nowhere | deep-link route mismatch |

Ping me while you test — I can watch the `send-push` logs and `net._http_response` live and tell you exactly what each attempt returned.
