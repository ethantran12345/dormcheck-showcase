# Email notifications (Resend)

DormCheck sends transactional email via **Resend** from **Vercel serverless API routes** (`api/`), not Supabase Edge Functions. Shared send helpers and HTML templates live in `api/_lib/notifications.ts`.

Canonical handler inventory: `docs/audits/api-surface.md`.

## Handler inventory

Thirteen handlers under `api/`. Eleven require a verified Supabase JWT (`Authorization: Bearer`). `events.ts` uses Svix webhook verification instead; `join-waitlist.ts` is unauthenticated (IP rate-limited, like `contact.ts`).

| Route | Handler | Auth | Sends email to |
|-------|---------|------|----------------|
| `POST /api/notify-message` | `api/notify-message.ts` | JWT | DM recipient (accepted conversation) |
| `POST /api/notify-message-request` | `api/notify-message-request.ts` | JWT | Non-initiator when conversation is pending |
| `POST /api/notify-message-request-accepted` | `api/notify-message-request-accepted.ts` | JWT | Original requester when conversation is accepted |
| `POST /api/notify-marketplace-inquiry` | `api/notify-marketplace-inquiry.ts` | JWT | Listing seller on buyer inquiry |
| `POST /api/notify-ranking-invite` | `api/notify-ranking-invite.ts` | JWT | External address for ranking group invite |
| `POST /api/send-roommate-invite` | `api/send-roommate-invite.ts` | JWT | Housing/collaboration group invite |
| `POST /api/feedback` | `api/feedback.ts` | JWT | Team inbox (not user preference gated) |
| `POST /api/events` | `api/events.ts` | Svix (`RESEND_WEBHOOK_SECRET`) | Forwards inbound Resend mail to team inbox; records hard bounces / complaints into `email_suppressions` |
| `POST /api/join-waitlist` | `api/join-waitlist.ts` | None (IP rate-limited) | Inserts into `university_waitlist` (service role), then confirmation to the joiner |
| `POST /api/notify-school-launch` | `api/notify-school-launch.ts` | JWT (superadmin only) | Batch "your school just launched" to un-notified `university_waitlist` rows matching the university's `email_domains` (200/call; dedupe via `launch_notified_at`) |
| `POST /api/notify-listing-status` | `api/notify-listing-status.ts` | JWT (admin roles only) | Listing seller on moderation status change (`approved` / `rejected` + reason / `under_review`) |
| `POST /api/notify-seller-rating` | `api/notify-seller-rating.ts` | JWT (rater) | Seller when a fresh rating lands (edits don't re-notify; recency checked server-side) |
| `POST /api/notify-checklist-assigned` | `api/notify-checklist-assigned.ts` | JWT (assigner) | Group member assigned a move-in checklist item (both parties must be group members) |

There is **no** `POST /api/notify-group-invite`. Housing group invites use `send-roommate-invite`.

The frontend calls JWT handlers with `apiPost()` from `src/lib/apiPost.ts`, which attaches the session access token.

### Client call sites (email triggers)

| Handler | Callers in `src/` |
|---------|-------------------|
| `notify-message` | `ChatPanel.tsx` |
| `notify-message-request` | `MessagesPage.tsx`, `getOrCreateConversation.ts`, `RoommatePage.tsx`, `RoommatesLikedPage.tsx`, `FindingRoommates.tsx`, `useMessageSeller.ts`, `StudentBusinessesSection.tsx`, `SavedHomeBand.tsx`, `FutureResidentsTab.tsx` (unwired) |
| `notify-message-request-accepted` | `conversationRequests.ts` |
| `notify-marketplace-inquiry` | `useMessageSeller.ts`, `SavedHomeBand.tsx` |
| `send-roommate-invite` | `CollaborateModal.tsx` |
| `feedback` | `ProfileView.tsx`, `FeedbackSupportModal.tsx` |
| `notify-ranking-invite` | **None** (handler exists; live collaborate flow uses `send-roommate-invite`) |
| `events` | Resend webhook (external) |
| `join-waitlist` | `src/lib/waitlist.ts` `submitWaitlist` (WaitlistCard.tsx, WaitlistPage.tsx) |
| `notify-school-launch` | **None** (run manually — e.g. authed curl by a superadmin — after flipping `universities.is_active`; re-invoke until `remaining: 0`) |
| `notify-listing-status` | `ReportsPage.tsx` (approve → restore → `approved`; hide listing → `rejected`) |
| `notify-seller-rating` | `useSellerRatings.ts` (`useUpsertSellerRating` onSuccess) |
| `notify-checklist-assigned` | `AssigneeControl.tsx` (`pick`, on assigning someone else) |

Several client paths skip `notify-message-request` when `isAdmin` (see messaging audit). The server still enforces JWT and rules if called.

## Sender routing (2026-07-09)

All mailboxes exist in Google Workspace; dormcheck.com is Resend-verified, so any `@dormcheck.com` from-address sends without extra setup.

| Sender | Used for | Reply-To |
|--------|----------|----------|
| `noreply@dormcheck.com` | Supabase auth mail (SMTP) + all student notifications | `support@dormcheck.com` |
| `team@dormcheck.com` | Admin invites / grants (`admin-invite` handler) | `team@dormcheck.com` |
| `support@dormcheck.com` | Feedback (`feedback.ts`, to support) + inbound webhook forwarding (`events.ts`) | — |
| `partnerships@dormcheck.com` | Partner inquiries (`contact.ts`, to partnerships@, Reply-To submitter) | submitter |

**Manual Supabase dashboard steps (Ethan owns, not code):** set Auth → SMTP sender to `noreply@dormcheck.com` (name "DormCheck"); confirm the v6 auth email templates still match; resolve whether password reset is code-based (`verifyOtp type=recovery`) or link-based — if link-based, the reset template needs the button variant, not the code box.

## Email templates (`api/_lib/notifications.ts`)

| Export | Used by handler | From address |
|--------|-----------------|--------------|
| `sendNewMessageEmail` | `notify-message` | `noreply@dormcheck.com` |
| `sendNewMessageRequestEmail` | `notify-message-request` | `noreply@dormcheck.com` |
| `sendMessageRequestAcceptedEmail` | `notify-message-request-accepted` | `noreply@dormcheck.com` |
| `sendMarketplaceInquiryEmail` | `notify-marketplace-inquiry` | `noreply@dormcheck.com` |
| `sendRankingInviteEmail` | `notify-ranking-invite` | `noreply@dormcheck.com` |
| `sendHousingGroupInviteEmail` | `send-roommate-invite` | `noreply@dormcheck.com` |
| `sendGroupInviteAcceptedEmail` | (group invite accepted) | `noreply@dormcheck.com` |
| `sendAdminInviteEmail` | `admin-invite` | `team@dormcheck.com` |
| `sendAdminGrantedEmail` | `admin-invite` | `team@dormcheck.com` |
| `sendWaitlistConfirmationEmail` | `join-waitlist` | `noreply@dormcheck.com` |
| `sendSchoolLaunchEmail` | `notify-school-launch` | `noreply@dormcheck.com` |
| `sendListingApprovedEmail` | `notify-listing-status` | `noreply@dormcheck.com` |
| `sendListingRejectedEmail` | `notify-listing-status` | `noreply@dormcheck.com` |
| `sendListingUnderReviewEmail` | `notify-listing-status` + `cron/listing-freshness` sweep | `noreply@dormcheck.com` |
| `sendSellerRatingEmail` | `notify-seller-rating` | `noreply@dormcheck.com` |
| `sendChecklistAssignedEmail` | `notify-checklist-assigned` | `noreply@dormcheck.com` |

`feedback.ts`, `contact.ts`, and `events.ts` send directly via Resend (not through the shared template helpers).

Button URLs in templates use hardcoded `https://dormcheck.com/...` (server-side; not `VITE_SITE_URL`).

### Template style (v6, unified 2026-07-09)

`getEmailHtml(headline, body, buttonText, buttonUrl)` renders the v6 auth-email chrome: logo + Nunito wordmark top-left, green pill CTA, pipe footer with socials and the "independent platform… any university" disclaimer. Email accent green is **`#0B702B`** — a deliberate contrast choice for white backgrounds (same rationale as the app's malachite-800 buttons); do not "fix" it to brand `#03C03C`, and never use retired `#5ba595`. Multi-university: there is no school badge; school names appear in body copy where relevant. All dynamic values pass through `escapeHtml`, and the CTA URL through `safeButtonUrl` (dormcheck.com-only allowlist).

## `email_notifications` gating

Before sending transactional email to a user, each handler reads `profiles.email_notifications` and skips the send when `false`. This is **per handler**, not centralized in `api/_lib/notifications.ts`. Template helpers send unconditionally once called.

| Handler | Checks preference | Notes |
|---------|-------------------|-------|
| `notify-message` | Yes (recipient) | Also gates push |
| `notify-message-request` | Yes (recipient) | Also gates push |
| `notify-message-request-accepted` | Yes (requester) | Also gates push |
| `notify-marketplace-inquiry` | Yes (seller) | Also gates push |
| `notify-ranking-invite` | Partial | Skips when profile exists for `recipientEmail` and preference is `false`; unknown emails still receive mail |
| `send-roommate-invite` | Yes (recipient) | |
| `feedback` | N/A | Outbound to team |
| `events` | N/A | Inbound webhook |
| `join-waitlist` | N/A | Transactional confirmation to a non-user who just acted; `profiles.email_notifications` doesn't apply. Repeat submits (23505) never resend |
| `notify-school-launch` | N/A | Waitlist rows are non-users; dedupe via `university_waitlist.launch_notified_at` (migration 20260731050000); suppressed addresses skipped (stamped notified so `remaining` converges) |
| `notify-listing-status` | Yes (seller, `marketplace`) | Also stamps/clears `marketplace_listings.under_review_notified_at` so the cron sweep never double-emails a review cycle |
| `notify-seller-rating` | Yes (seller, `marketplace`) | Fresh ratings only (created≈updated); blocked pairs skipped |
| `notify-checklist-assigned` | Yes (assignee, `movein`) | Group items only; self-assign/unassign never email |
| `cron/listing-freshness` (under-review sweep) | Yes (seller, `marketplace`) | Emails sellers whose listing was auto-hidden by the report threshold; dedupe via `under_review_notified_at` |
| `delete-user-account` (Supabase Edge Function) | N/A | Deletion confirmation, inlined v6 template (can't import `api/_lib`); best-effort, needs `RESEND_API_KEY` in **Supabase** function secrets |

Push on message and marketplace handlers uses the same preference gate as email (see `api/_lib/push.ts`).

## Required configuration

### Vercel environment variables

Set in **Vercel** (Project → Settings → Environment Variables) for Production and Preview:

| Variable | Used by |
|----------|---------|
| `RESEND_API_KEY` | `_lib/notifications.ts`, `feedback.ts`, `events.ts` |
| `SUPABASE_URL` | `_lib/supabase.ts`, `_lib/push.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | `_lib/supabase.ts` (required; no anon fallback) |
| `RESEND_WEBHOOK_SECRET` | `events.ts` (Svix signature verification) |
| `SEND_PUSH_AUTH_TOKEN` | `_lib/push.ts` (optional; push only) |

If `RESEND_API_KEY` is missing, notification send paths throw and handlers return **500** (logged as `RESEND_API_KEY is not configured`).

If Supabase server config is missing, DB-backed handlers return **503** (`supabase` client is null).

Supabase secrets (`npx supabase secrets list`) are for **Supabase Edge Functions** only. Resend and Supabase server keys belong in **Vercel**, not Supabase secrets.

### Resend domain verification

From addresses in use (see Sender routing above):

- `DormCheck <noreply@dormcheck.com>` (all student notifications, Reply-To support@)
- `DormCheck <team@dormcheck.com>` (admin invites/grants)
- `DormCheck Feedback <support@dormcheck.com>` (`feedback.ts`)
- `DormCheck Partnerships <partnerships@dormcheck.com>` (`contact.ts`)
- Inbound webhook forwarding via `events.ts` (Resend receiving API)

In [Resend](https://resend.com/domains), add and verify **dormcheck.com**. Until verified, Resend may reject or not deliver.

Configure the Resend inbound webhook to POST to `/api/events` with `RESEND_WEBHOOK_SECRET` set for Svix verification.

### Bounce / complaint suppression (migration 20260731060000)

`events.ts` handles `email.bounced` (hard: `bounce.type` Permanent/Undetermined; Transient ignored) and `email.complained` by upserting the recipient into `email_suppressions` (`email` PK lowercase, `reason`, `created_at`; RLS default-deny, service-role only). **Broadcast/marketing sends** (`notify-school-launch` and future) must filter recipients against this table before sending; **transactional auth mail is not filtered** (a bounce there is its own signal). Manual step: in the Resend dashboard, subscribe the `/api/events` webhook (id `f7134152-bc60-4369-817c-b0e9650cb3a7`) to `email.bounced` and `email.complained` — it originally listened only for `email.received`.

### Send tracking (why there is none in Resend)

Resend's send API has **no per-message open/click tracking flags** — tracking is a domain-level setting only, and enabling it domain-wide would rewrite links in *every* email, including Supabase auth OTP/confirm links. Leave domain tracking **off**. Campaign links carry UTM params instead (e.g. the school-launch CTA: `utm_campaign=school-launch`) and are measured in our own analytics.

## Local development

- `npm run dev` (Vite, port 8080) does **not** run API routes. `fetch('/api/...')` from the app will 404.
- Use **`vercel dev`** to run serverless functions locally. Set the same env vars in `.env.local` or via Vercel CLI.

## Troubleshooting

- **Emails not sending**
  1. Vercel → Settings → Environment Variables: confirm `RESEND_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` for the target environment.
  2. Vercel → Deployments → Functions: check logs for `notify-message`, `notify-message-request`, `notify-message-request-accepted`, `notify-marketplace-inquiry`, `send-roommate-invite`, etc. Look for `RESEND_API_KEY is not configured` or missing Supabase config (503).
  3. Resend → Domains: confirm dormcheck.com is verified.
  4. Recipient may have `profiles.email_notifications = false` (handler returns **200** without send).
- **503 from notification API** - Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
- **500 after Supabase is configured** - Resend error (invalid key, unverified domain). Check function logs for `Resend send error:` and the Resend dashboard.
- **Inbound mail not forwarding** - Verify `RESEND_WEBHOOK_SECRET` and Svix headers on `events.ts`; invalid signature returns **400**.

## Related docs

- `docs/audits/api-surface.md` - full handler audit, security notes, push dispatch
- `docs/audits/messaging.md` - DM flows and notify call sites

<!-- docs-drift-ignore: api/notify-group-invite -->
<!-- Named only to assert it does NOT exist. -->
