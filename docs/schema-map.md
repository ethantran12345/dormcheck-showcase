# Schema map — every table, what it holds, how it's scoped per university

<!-- verified-against: 4000f4a9 -->

> **Doc control:** created 2026-07-10, reconciled 2026-07-27 against `supabase/registry/table-classification.json` at commit `92ca927d` (the registry is the gated source of truth; the 2026-07-10 body below came from a live prod pull (`list_tables` on project `abcdefghijklmnopqrst`)). **This file is the canonical human-readable table inventory + tenancy map.** The machine-readable source of truth is the registry JSON — `npm run test:db` fails the build if they drift apart structurally (every table must be registered). Companion docs: [`multi-university.md`](multi-university.md) (tenant activation steps + invariants), [`architecture-zones-and-admin-tiers.md`](architecture-zones-and-admin-tiers.md) (RBAC / RLS design), [`ARCHITECTURE.md`](ARCHITECTURE.md) §7 (data layer by feature domain).

## How the database is organized (plain English)

There is **one shared table per kind of thing** — one `master_housing` for all dorms, one `marketplace_listings` for all listings — and every row that belongs to a campus is tagged with a `university_id` pointing at the `universities` registry. Row-Level Security (RLS) keeps schools invisible to each other: a Pitt student's queries can only ever return Pitt rows, a CMU student's only CMU rows. **Adding a school is one new row in `universities` (plus config and content), never a new set of tables.** There are no `pitt_*` or `cmu_*` tables and there never will be.

**One deliberate exception, and it is READ-ONLY: the shared marketplace.** `20260918000000_shared_marketplace_group.sql` adds `universities.marketplace_group` (a text label; Pitt, CMU and Carlow all carry `'pittsburgh'`, NULL means "shares with nobody" and is the safe default a new tenant gets for free) and two SECURITY INVOKER helpers, `public.current_marketplace_group()` and `public.shares_marketplace(uuid)`. Four surfaces widen their READ side to the group — `marketplace_listings`, `seller_ratings`, `profiles_public`, and cross-school DM creation on `conversations` — because three co-located campuses a mile apart are one market, and a shared feed of faceless sellers is worse for safety than showing a buyer who they are meeting. **The write side did not move**: every `WITH CHECK` stays pinned to `current_university_id()`, so you may SEE any listing from a school in your group and may only POST into your own. Membership is DATA, not code — a fourth school joins by setting one column. Everything else on this page (checklist, housing, dorm content, roommates, rankings, community chats) is tenant-isolated exactly as described. **This is live in prod** (verified 2026-10-05 against project `abcdefghijklmnopqrst`: the column, both helpers as SECURITY INVOKER, and the four widened policies are present). `20261002000000_buildings_marketplace_group_scope.sql` (applied to prod 2026-08-18) extends the same read-widening to `buildings.tenant_isolation` while keeping writes confined to the author's own school. Decision: `docs/DECISIONS.md` 2026-08-16; bound proven by the ungrouped third fixture tenant in `supabase/tests/tenant_isolation.test.sql`.

Not every table needs its own `university_id` tag. Six scoping models cover everything:

| Class | Scoping model | How a row knows its school |
|---|---|---|
| **A** | University-scoped root | Its own `university_id` column + a RESTRICTIVE `tenant_isolation` RLS policy on `current_university_id()` |
| **B** | Child of a scoped table | Follows its parent's row via FK — the parent's RLS does the filtering; no redundant column |
| **C** | User-owned | Belongs to one user (`user_id = auth.uid()`); school = that user's `profiles.university_id` |
| **D** | Social graph | Confined at creation time (both parties must be same-school) or inherits from a confined membership |
| **E** | City infrastructure | Not university data at all — Pittsburgh-city data shared by co-located campuses |
| **F** | Platform-global | Deliberately never tenant-scoped (registry, ops, moderation, pre-tenant capture) |

<!-- GENERATED:tables -->
**99 base tables** in schema `public` (22 A + 17 B + 21 C + 10 D + 2 E + 27 F), plus 6 views. Counted from `supabase/registry/table-classification.json`, which `npm run test:db` keeps honest.
<!-- /GENERATED:tables -->

(It was 65 tables at the 2026-07-10 prod pull; the ones added since are the tenancy, RBAC, notifications, MFA, share-link, broadcast and advertiser work.)

The per-class rosters below are generated from the registry, so the counts in the section
headings can no longer drift — they used to, and did: this file claimed 11 class-A roots
while the registry held 12.

<!-- GENERATED:table-classes -->
| Class | Count | Tables |
|---|---|---|
| **A** | 22 | `academic_terms`, `building_chat_links`, `buildings`, `business_listings`, `campus_academic_events`, `campus_course_catalog`, `campus_data_sources`, `campus_dining_hours`, `campus_dining_locations`, `campus_dining_menus`, `campus_ingest_cursor`, `campus_ingest_runs`, `campus_laundry_machines`, `campus_laundry_rooms`, `course_sections`, `dorm_questions`, `explore_picks`, `marketplace_listings`, `master_housing`, `ranking_collaborations`, `roommate_search_posts`, `student_setups` |
| **B** | 17 | `building_chat_link_reports`, `checklist_share_links`, `dorm_answers`, `dorm_edits`, `dorm_future_residents`, `dorm_question_upvotes`, `group_dorm_rankings`, `listing_verifications`, `marketplace_listing_items`, `roommate_search_interests`, `seller_ratings`, `setup_comment_likes`, `setup_comments`, `setup_likes`, `setup_photos`, `setup_products`, `student_reviews` |
| **C** | 21 | `checklist_item_claims`, `checklist_items`, `checklist_payment_acks`, `checklist_payments`, `community_room_optouts`, `device_tokens`, `favorite_roommates`, `marketplace_alerts`, `mfa_backup_codes`, `notifications`, `profiles`, `profiles_public`, `profiles_roommate`, `saved_businesses`, `saved_dorms`, `saved_items`, `saved_subleases`, `user_classes`, `user_dorm_rankings`, `user_home_location`, `user_logistics_progress` |
| **D** | 10 | `blocked_users`, `conversations`, `dm_poll_votes`, `group_conversations`, `group_members`, `group_message_reactions`, `group_messages`, `message_reactions`, `messages`, `ranking_group_members` |
| **E** | 2 | `bus_stops`, `pogoh_station` |
| **F** | 27 | `ad_campaigns`, `ad_creatives`, `ad_impressions`, `admin_audit_log`, `admin_email_log`, `admin_invitations`, `advertiser_invitations`, `advertisers`, `amazon_product_variations`, `amazon_products`, `analytics_events`, `api_rate_limits`, `broadcast_templates`, `child_safety_reports`, `content_reports`, `deleted_accounts`, `email_suppressions`, `moderation_actions`, `movein_push_log`, `payment_history`, `push_broadcasts`, `school_directory`, `school_domains`, `schools`, `universities`, `university_admin_leads`, `university_waitlist` |
<!-- /GENERATED:table-classes -->

## A. University-scoped roots — carry `university_id`

| Table | What it holds | How it's scoped | Notes |
|---|---|---|---|
| `master_housing` | Canonical dorm/residence records (the housing catalog) | own `university_id` + tenant RLS | Anon (logged-out) read stays open so the public catalog renders |
| `marketplace_listings` | Student marketplace listings | own `university_id` + **asymmetric** tenant RLS: USING widens to `shares_marketplace()`, WITH CHECK stays `current_university_id()` (`20260918000000`) | Column-level SELECT grant (SEC-6, `20260622000733`) — never `select('*')`; `university_id` is explicitly granted |
| `business_listings` | Student-business directory entries | own `university_id` + tenant RLS | |
| `roommate_search_posts` | Roommate-search posts | own `university_id` + tenant RLS | |
| `dorm_questions` | Q&A questions on dorm pages | own `university_id` + tenant RLS | |
| `student_setups` | Room-setup showcase posts | own `university_id` + tenant RLS | |
| `building_chat_links` | Student-submitted GroupMe/chat links per building | own `university_id` + tenant RLS | |
| `explore_picks` | Curated checklist "explore" product picks | own `university_id` + tenant RLS | |
| `buildings` | Campus academic buildings (class navigator) | own `university_id` + **asymmetric** tenant RLS: USING widens to `shares_marketplace()`, WITH CHECK stays `current_university_id()` (`20261002000000`) | Sublease registry: `kind` (academic, residence_hall, off_campus) and `is_subleasable` control posting eligibility |
| `course_sections` | Course-section schedule data (class navigator) | own `university_id` + tenant RLS | |
| `ranking_collaborations` | Shared dorm-ranking groups (root of the ranking group) | own `university_id` + tenant RLS | Promoted to class A during tenant hardening (was user-pair) |
| `academic_terms` | Named terms per school (`Fall 2026`, code `fall-2026`, start/end dates) | own `university_id` + tenant RLS | P2 groundwork — schema only, nothing reads it yet; future enrollment/move-in features FK into it instead of free-text terms |

## B. Children scoped via parent FK — no `university_id` needed

Scope derives from the parent row; the RESTRICTIVE policy is an `EXISTS(<parent>)` check that is itself subject to the parent's RLS.

| Table | What it holds | Scoping parent |
|---|---|---|
| `marketplace_listing_items` | Per-item rows inside a multi-item listing | `marketplace_listings` |
| `seller_ratings` | Buyer→seller ratings | `profiles` (rated user) — widened to `shares_marketplace(profile_university(seller_id))` by `20260918000000`, so a cross-school buyer can judge a seller they can actually buy from |
| `dorm_answers` | Answers to dorm Q&A | `dorm_questions` |
| `dorm_question_upvotes` | Upvotes on dorm questions | `dorm_questions` |
| `dorm_edits` | Immutable admin edit audit trail on dorm records | `master_housing` |
| `dorm_future_residents` | "I'm living here next year" markers | `master_housing` |
| `setup_photos` | Photos on a room setup | `student_setups` |
| `setup_products` | Tagged products on a setup | `student_setups` |
| `setup_comments` | Comments on a setup | `student_setups` |
| `setup_likes` | Likes on a setup | `student_setups` |
| `setup_comment_likes` | Likes on setup comments | `setup_comments` |
| `building_chat_link_reports` | Reports against chat links | `building_chat_links` |
| `roommate_search_interests` | "I'm interested" responses to roommate posts | `roommate_search_posts` |
| `group_dorm_rankings` | A ranking group's shared dorm rankings | `ranking_collaborations` |
| `checklist_share_links` | Unguessable parent/guest tokens onto a group move-in checklist. A family token must never grant group membership, create an auth user, or expose PII/money data | `ranking_collaborations` |
| `listing_verifications` | Owner-submitted lease/utility evidence, admin-reviewed. Buyers never read the row — they see `marketplace_listings.verified_at`, set only by a SECURITY DEFINER trigger | `marketplace_listings` |

## C. User-owned — scope = owner's `profiles.university_id`

All are `user_id = auth.uid()` rows; the owner's profile carries the school.

| Table | What it holds |
|---|---|
| `profiles` | One row per user: name, avatar, `university_id`, role, notification prefs |
| `checklist_items` | A user's packing-checklist items |
| `checklist_item_claims` | Group-checklist "I'll bring this" claims |
| `checklist_payments` | Group checklist cost splits |
| `checklist_payment_acks` | Acknowledgements of those splits |
| `saved_dorms` | Saved/bookmarked dorms |
| `saved_items` | Saved marketplace items |
| `saved_businesses` | Saved student businesses |
| `saved_subleases` | Legacy sublease saves (feature removed, table retained) |
| `favorite_roommates` | Favorited roommate posts |
| `user_dorm_rankings` | A user's personal dorm ranking |
| `user_logistics_progress` | Move-in logistics wizard progress |
| `user_classes` | A user's enrolled class sections |
| `user_home_location` | Home location for distance features |
| `device_tokens` | Push-notification device tokens |
| `notifications` | In-app notifications (recipient-scoped). Its `university_id` column is a *dimension*, not a tenant boundary — do not add a tenant policy |
| `profiles_public` | Read-only identity projection of `profiles` (name/avatar), written only by the definer sync trigger; the `public_profiles` view reads it. SELECT is own-row OR same-tenant OR **same `marketplace_group` via `shares_marketplace()`** (`20260918000000`) OR superadmin — **deliberately no `is_public` opt-out**, because identity must resolve for DM senders and for cross-school marketplace sellers |
| `profiles_roommate` | Read-only projection of the roommate-discovery columns, same sync-trigger pattern; the `roommate_profiles` view reads it. SELECT mirrors the historical view WHERE exactly: (`is_public` OR own row) AND (own row OR tenant match) |
| `marketplace_alerts` | Saved marketplace searches (categories, price band, keywords). An AFTER INSERT trigger on `marketplace_listings` fans a `marketplace_alert` notification to matching owners. Its `university_id` is server-derived from the owner's profile — a dimension, not a boundary |
| `mfa_backup_codes` | One-time TOTP recovery codes, SHA-256 hashed **client-side** — plaintext never reaches the DB. `use_backup_code()` burns the code and drops the user's TOTP factors so they can re-enroll |
| `community_room_optouts` | "I left this room" markers for auto-provisioned building/floor chats (`user_id` + `group_id`) |

## D. Social graph — confined at creation, or membership-inherited

Cross-tenant interaction is prevented where the edge is *created*; reads then inherit that confinement. Decision of 2026-07-10: DMs and groups are tenant-confined, not cross-campus.

| Table | What it holds | Mechanism |
|---|---|---|
| `conversations` | 1:1 DM threads | `tenant_confined` INSERT policy — both parties same school, OR both in schools sharing a `marketplace_group` (`20260918000000`). Consent is unchanged either way: `status` + `initiated_by` + `rls_conversations_insert_privacy_gate` still make it a request the recipient accepts |
| `group_members` | Group-chat membership roster | `tenant_confined` INSERT policy |
| `ranking_group_members` | Ranking-group membership | `tenant_confined` INSERT policy |
| `messages` | DM messages | membership — reads gated by conversation participants |
| `group_conversations` | Named group-chat rooms | membership — reads gated by `group_members` |
| `group_messages` | Group-chat messages | membership — reads gated by `group_members` |
| `blocked_users` | User-pair blocks | membership — only the involved users can read; no cross-tenant pairs can form |
| `message_reactions` | Emoji reactions on DM messages (unique per message+user+emoji) | membership — inherits the conversation's participant gate |
| `group_message_reactions` | Emoji reactions on group messages | membership — inherits `group_members` |

## E. City infrastructure — not university data

| Table | What it holds | Notes |
|---|---|---|
| `bus_stops` | Pittsburgh transit stops | Shared by co-located campuses (Pitt, CMU, Carlow are all Pittsburgh). Needs a city/campus notion only when a non-Pittsburgh tenant lands |
| `pogoh_station` | POGOH bike-share stations | Same |

## F. Platform-global — deliberately never tenant-scoped

| Table | What it holds | Why it's global |
|---|---|---|
| `universities` | **The tenant registry itself** — one row per school, `is_active` gates signups, `marketplace_group` opts a school into shared marketplace reads (`20260918000000`, dev-only; NULL = isolated) | Defines tenants; writes are service-role only (onboarding is operator action, never self-serve) |
| `school_directory` | Authoritative email-domain → school-name lookup (1,581 domains) | Pre-tenant reference data; service-role read only |
| `schools` | US institution reference directory (College Scorecard/IPEDS spine: unitid, name, city, state, ownership, enrollment) | Names schools for the waitlist branch; `matched_university_id` is the only bridge to the tenant registry. **Never authorizes sign-in** |
| `school_domains` | Email domains per directory school (many→one) | Read only via anon-callable `resolve_school_by_domain()` RPC (progressive subdomain strip — naming only, gate stays exact-match); no client SELECT |
| `university_waitlist` | Email capture from students at not-yet-active schools | Captures demand *ahead of* a tenant existing; INSERT-only for app roles |
| `university_admin_leads` | Housing-office/student-gov contacts submitted by waitlisted students | B2B partnership pipeline, exists ahead of a tenant |
| `amazon_products` | Affiliate product catalog | Shared catalog |
| `analytics_events` | Append-only pilot metrics | `university_id` may later become a dashboard *dimension*, never a boundary |
| `api_rate_limits` | API rate-limit counters | Infra; RLS default-deny (no policies) is intentional |
| `moderation_actions` | Moderation action log | Platform moderation surface |
| `content_reports` | User content reports | Platform moderation surface |
| `deleted_accounts` | App Store 5.1.1 account-deletion compliance log | Account lifecycle; RLS default-deny is intentional |
| `payment_history` | Checklist group-payment log | Platform payment log |
| `admin_audit_log` | Admin action audit trail (RBAC Tier 1) | Superadmin/service surface, default-deny to app roles |
| `admin_invitations` | Admin RBAC invitations | Platform admin plumbing, not campus content |
| `admin_email_log` | Log of emails sent to admins (report escalation) | Ops surface; RLS default-deny, service role only |
| `email_suppressions` | Suppressed recipient addresses (bounces, unsubscribes) | Deliverability infra spanning all tenants; revoked from `anon`/`authenticated` |
| `push_broadcasts` | Audit trail of manual admin push broadcasts, written by `api/admin/broadcast.ts` | Operator action log; superadmins read, no client writes |
| `broadcast_templates` | Reusable announcement templates for scheduled broadcasts | Superadmin-only; all CRUD via `api/admin/broadcast-templates.ts`, so RLS is default-deny like `admin_email_log` |
| `movein_push_log` | One row per (user, milestone) so a same-day cron re-run can never double-send | Idempotency infra; RLS on with no client policies |
| `amazon_product_variations` | Per-variant rows (Size/Color/Count) under an `amazon_products` row, real or synthesized | Shared affiliate catalog, same as its parent |
| `advertisers` | Advertiser accounts | Businesses, not campus members — **invite-gated** so the `.edu` signup gate stays airtight |
| `advertiser_invitations` | Superadmin-issued invitations, the only path to an advertiser account | Platform admin plumbing |
| `ad_campaigns` | Campaigns. Target exactly ONE university (required) | Targeting is aggregate-only with a k-anonymity floor (reach < 50 is never disclosed); no student PII is readable by advertisers |
| `ad_creatives` | Creative assets per campaign | Advertiser-owned, not campus content |
| `ad_impressions` | Impression counters | Aggregate reporting only |

## Views

<!-- GENERATED:views -->
**6 views:** `marketplace_listings_contact`, `marketplace_public`, `public_profiles`, `roommate_profiles`, `roommate_search_posts_contact`, `seller_rating_stats`.
<!-- /GENERATED:views -->

Explicit-column allowlists over base tables. SECURITY DEFINER views bypass table RLS, so each carries its **own** tenant filter (added 2026-07-10 during tenant hardening).

| View | What it exposes |
|---|---|
| `public_profiles` | Identity only (`id`, `full_name`, `avatar_url`; 3 cols — socials removed `20260814000000`). `security_invoker` view over the `profiles_public` projection table (Option B, 2026-07-20); **scoped** (own row OR same-university OR same `marketplace_group` since `20260918000000` OR superadmin — supersedes the 2026-07-17 unscoped acceptance) |
| `marketplace_listings_contact` | Seller contact fields, gated to legitimate buyers |
| `roommate_profiles` | Roommate-search profile card fields (36 cols); `is_public OR own` filtered AND university-scoped |
| `roommate_search_posts_contact` | Poster contact fields on a roommate post, gated to legitimate viewers (same pattern as `marketplace_listings_contact`) |
| `seller_rating_stats` | Aggregated seller rating stats |

## Source of truth

- **This file** — the human-readable table inventory + scoping map (regenerate the counts from `supabase/registry/table-classification.json`, which the `test:db` gate keeps honest).
- **`multi-university.md`** — tenancy invariants and the university-#N activation checklist.
- **`architecture-zones-and-admin-tiers.md`** — the RBAC / `current_university_id()` RLS design.
- **`ARCHITECTURE.md` §7** — the same tables grouped by feature domain, plus RPCs, edge functions, storage.

---

## Naming & scoping convention for new tables

The rules that keep the schema coherent as more universities onboard. Logged as a decision in `docs/DECISIONS.md` (2026-07-10).

1. **Shared table, generic name — never a per-school table.** A new per-campus entity gets one shared table with a domain name (`master_housing`, not `pitt_housing`; `course_sections`, not `cmu_courses`) and a `university_id uuid REFERENCES public.universities(id)` column. `pitt_*`/`cmu_*` table names are forbidden.
2. **Pick a tenant class (A–F) before writing the migration**, and register it in `supabase/registry/table-classification.json` **in the same PR** — `npm run test:db` fails on unregistered tables. The class-by-class patterns (including the one-call `SELECT public.apply_tenant_isolation('public.<table>')` for class A) live in [`multi-university.md`](multi-university.md) §3.1.
3. **Class A roots populate `university_id` via the profile-derived trigger pattern** (`20260723010000_drop_university_default_add_trigger`) — the single-tenant `DEFAULT '<pitt-uuid>'` era ended 2026-07-10 when CMU activated; never reintroduce a tenant DEFAULT.
4. **A child of an already-scoped table needs no `university_id`** — scope derives through the parent FK (class B). Don't add a redundant column.
5. **User-owned tables get no `university_id`** — scope is the owner's `profiles.university_id` (class C). Exception: a `university_id` *dimension* column (like `notifications`) is fine, but it is not a tenant boundary and gets no tenant policy.
6. **Platform-global tables (class F) are never tenant-scoped** — registry, moderation, rate limits, analytics, pre-tenant capture.
7. **Every new table ships with RLS enabled + policies, and advisors run on the migration** — per the standing rule in [`security-todo.md`](security-todo.md) ("New tables"). Default-deny (RLS on, zero policies) is a valid, deliberate posture for service-role-only tables.
8. **Tenant RLS follows the existing pattern, never a new invention** — RESTRICTIVE policies on `current_university_id()` per [`architecture-zones-and-admin-tiers.md`](architecture-zones-and-admin-tiers.md) and `20260723020000_tenant_isolation_rls`.
9. **New DB functions get generalized names and bodies — no `pitt_` in anything new.** The last Pitt-named function is gone: `validate_pitt_email()` was renamed to `validate_university_email()` in `20260710055958_generalize_email_gate`. There is no Pitt-named SQL object left; don't reintroduce one.

<!-- docs-drift-ignore: pitt_housing, cmu_courses, pitt_, validate_pitt_email -->
<!-- Forbidden-name EXAMPLES and one historical rename. They must not exist —
     naming them is the point of the rule. -->

