<!-- docs-drift-ignore: privaterelay — part of the Apple-owned domain privaterelay.appleid.com, not a repo identifier -->
<!-- docs-drift-ignore: appleid — part of the Apple-owned domain privaterelay.appleid.com, not a repo identifier -->
<!-- docs-drift-ignore: email_domains — a column of public.universities, named here in prose -->
<!-- docs-drift-ignore: is_pitt_user — a function that was DROPPED (20260710183214); named here only to record that it is gone -->
<!-- docs-drift-ignore: validate_pitt_email — the pre-rename name of validate_university_email; named here as history -->
<!-- docs-drift-ignore: uid — auth.uid(), the Supabase JWT helper, as rendered in pg_policies output -->

---
snapshot: 2026-08-06
---

# What an account can reach before it is .edu-verified

**Status: enumeration only. No behaviour changed.** This is the artifact the auth-edu wave
brief demanded *before* any code: "ENUMERATE every surface that currently assumes 'has an
account => is .edu-verified' and gate each one explicitly. Widening what an unverified account
can reach is the real risk here, not the auth flow."

Everything below was read from the **live schema** of a clean `npx supabase db reset` on
2026-08-06, not from the migration files. Three claims that migration files would have given
you are wrong, and are corrected here.

---

## 1. Where the weld actually is

The brief points at `src/pages/auth/Auth.tsx` (the `.edu` comments at :79, :149, :199, :259).
Those are real, but they are not the enforcement. **The enforcement is a database trigger on
`auth.users`**, and it fires before any client code is involved:

| object | what it does |
|---|---|
| `check_university_email_on_signup` → `validate_university_email()` | BEFORE INSERT on `auth.users`. RAISEs unless the address's domain appears in some **active** university's `email_domains`. |
| `on_auth_user_created` → `handle_new_user()` | Derives `profiles.university_id` by matching the address's domain against active universities. No match → **NULL**. |

So a Sign-in-with-Apple account using Hide My Email (`@privaterelay.appleid.com`) does not
"get bounced by the signup form" — `auth.users` refuses to accept the row at all. Any plan that
begins in the React layer is fixing the wrong file.

**Corrections to what the migration files suggest:**
- The function is `validate_university_email()`, not `validate_pitt_email()`. It was renamed;
  the old name no longer exists.
- `is_pitt_user()` — a `SECURITY DEFINER` helper that returned
  `lower(auth.jwt() ->> 'email') LIKE '%@pitt.edu'` — **was dropped** by
  `20260710183214_tenant_minor_hardening`. It was never wired into a policy. It reads like a
  live domain-derived authority check in the migration history and it is not one.
- The rejection message is now built from the live `email_domains` list rather than hardcoding
  Pitt.

## 2. An untenanted account is not a new state — one already exists

`validate_university_email()` carries an **advertiser exception**: an unexpired, unaccepted row
in `advertiser_invitations` admits that exact address regardless of domain. Such an account then
lands in `handle_new_user()`, matches no active university, and gets `university_id = NULL`.

This matters more than anything else in this document. **The "third state" the brief warns
about — an account with no school — is already reachable in production code today.** The
question is not whether to invent it. The question is what already fences it, and the answer is
measurable.

(Count of profiles with `university_id IS NULL` on a clean local stack: 0 — no advertiser has
been invited locally. The path exists; it is simply unexercised, which is the same shape as the
`university_admin` role that turned out to be 500ing for a year.)

## 3. What already fences an untenanted account, verified

`current_university_id()` is `select university_id from public.profiles where id = auth.uid()`.
For an untenanted account it returns NULL.

Of **268** RLS policies in `public`:

- **23** (across 18 tables) reference `current_university_id()`. Every one of them uses plain
  equality. `x = NULL` is NULL, not true, so **all 23 deny an untenanted account by
  construction.** Checked explicitly for the two shapes that would fail OPEN —
  `IS NOT DISTINCT FROM` and `... OR current_university_id() IS NULL` — and **found none.**
- **39** are admin-only (`is_superadmin()` / `current_app_role()` / `is_admin`). Unreachable.

That is the good news, and it is a real result rather than an assumption: the tenant fence fails
closed today. It is also the whole of the fence.

## 4. What is NOT fenced: 145 write policies over 62 tables

**145** INSERT/UPDATE/DELETE/ALL policies across **62** tables gate on `uid()` ownership with no
tenant clause at all. They ask "is this your row?", never "are you verified?". Today that is
sound, because every account is verified by construction. The moment an unverified account can
exist, each of these is a surface it reaches.

This is the work list. The verdicts below are a **proposal**, not a finding — the inventory is
machine-derived, the grouping is a judgement call and needs sign-off:

**Must require verification (writes real content other students see):**
`marketplace_listings`, `marketplace_listing_items`, `marketplace_alerts`, `student_setups`,
`setup_comments`, `setup_photos`, `setup_products`, `setup_likes`, `setup_comment_likes`,
`student_reviews`, `seller_ratings`, `dorm_questions`, `dorm_answers`, `dorm_question_upvotes`,
`dorm_edits`, `roommate_search_posts`, `roommate_search_interests`, `favorite_roommates`,
`building_chat_links`, `building_chat_link_reports`, `messages`, `conversations`,
`group_messages`, `group_conversations`, `group_members`, `group_message_reactions`,
`message_reactions`, `ranking_collaborations`, `ranking_group_members`, `user_dorm_rankings`,
`dorm_future_residents`, `explore_picks`, `business_listings`, `listing_verifications`,
`content_reports`, `checklist_share_links`, `checklist_items`, `checklist_item_claims`,
`checklist_payments`, `checklist_payment_acks`, `payment_history`, `master_housing`

**Safe for an unverified account (private to the user, or required to become verified):**
`profiles`, `device_tokens`, `mfa_backup_codes`, `blocked_users`, `saved_items`, `saved_dorms`,
`saved_subleases`, `saved_businesses`, `user_classes`, `user_home_location`,
`user_logistics_progress`, `community_room_optouts`, `analytics_events`

**Advertiser-side, already living in the untenanted state:**
`advertisers`, `ad_campaigns`, `ad_creatives`

**Admin/system, unreachable anyway:** `admin_audit_log`, `moderation_actions`,
`amazon_products`, `amazon_product_variations`

## 5. The decision this forces

The brief says "an account may exist unverified; .edu verification becomes a later state that
gates FEATURES, not signup." Concretely that means:

1. A verification state on `profiles` that is **not** derived from the email domain, because a
   private-relay address has no domain to derive from. `university_id IS NOT NULL` is the
   obvious candidate and it already fails closed in all 23 tenant policies — but it currently
   means "we matched your email domain", and it would come to mean "a human proved their
   school". Those are different claims and conflating them is how a fence rots.
2. `validate_university_email()` must stop being the gate, or must grow a second exception the
   way it already has one for advertisers. **The advertiser exception is the precedent to copy,
   not to invent around.**
3. Each of the 42 "must require verification" tables needs its policy widened with an explicit
   verification predicate. That is the bulk of the work and it is mechanical once the predicate
   is decided.
4. `Auth.tsx:259` already routes a valid non-active `.edu` to the waitlist. That is a THIRD
   state next to verified and unverified, and the brief is right that it must be understood
   before a fourth is added: waitlist = "a real student at a school we have not launched",
   unverified = "an account we cannot yet attribute to any school".

## 6. What is NOT in this document

- Sign in with Apple itself. Confirmed absent: nothing in `src/pages/auth/`,
  `src/lib/authMethods.ts` or `src/config/universities.ts` mentions Apple or SIWA, and
  `AuthMethod` is `'microsoft' | 'google' | 'email' | 'saml'`. Any note claiming SIWA was
  "restored" is wrong. Build 31 cleared guideline 4.8 by taking the **exclusivity exemption** —
  email + password is the only iOS sign-in method — not by adding SIWA. That also means SIWA is
  a product choice today, not a compliance obligation, and adding it re-opens 4.8 as a question
  rather than settling it.
- Any change to Google's visibility on iOS. Hiding it is what cleared 4.8; that stays.
- Migrations. Nothing here has been applied anywhere. `npm run db:preflight` gates any that follow.

## Related
`docs/DECISIONS.md` (2026-08-06 entry) · `src/lib/authMethods.ts` (`visibleSsoMethodsFor`, the
4.8 gate) · `supabase/migrations/20260707034339_multi_university_groundwork.sql` (original weld)
· `supabase/migrations/20260710183214_tenant_minor_hardening.sql` (dropped `is_pitt_user`)
