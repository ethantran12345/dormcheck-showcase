# Multi-university groundwork

Branch: `multi-university-prep` → `dev` · **Written:** 2026-07-05 · Companion to migration `20260707000000_multi_university_groundwork.sql`, `src/config/universities.ts`, and the Phase 3 RBAC plan in `docs/architecture-zones-and-admin-tiers.md`.

## 1. Status and scope

**Status update 2026-07-10 (CMU LIVE — soft launch, The Flip DONE):** CMU is now a live tenant
(`00000000-0000-4000-8000-000000000002`, **`is_active = true`** in prod). All three flip actions
shipped together: prod `UPDATE universities SET is_active = true WHERE slug='cmu'`, `isActive: true`
in `src/config/universities.ts`, and `andrew.cmu.edu` + `cmu.edu` added to `ALLOWED_EMAIL_DOMAINS`
in `api/_lib/auth.ts` (deployed to prod on `main`). Tenant isolation re-verified against prod at
go-live: a CMU subject sees 65 CMU / 0 Pitt rows, a Pitt subject sees 142 Pitt / 0 CMU (listings/DMs
intact) — zero cross-visibility both directions. A real `@andrew.cmu.edu` signup lands CMU-scoped via
`handle_new_user()`. Soft launch: not publicized. Rollback lever remains one line
(`UPDATE universities SET is_active = false WHERE slug='cmu'` — closes signups instantly; schema +
seed stay). Prior groundwork (steps 1-7) and pre-flip content gating (step 9) unchanged.
FOLLOW-UP at/after flip (§5 sweep): author real CMU move-in/move-out/resources content, CMU
campus-map building pins, decide bus/POGOH relevance for CMU.

**Live verification against prod 2026-08-06 (read-only; the repo cannot answer any of this, since
activation and housing seeding are operator DML, not migrations):** `universities.is_active = true`
for **both** `pitt` and `cmu`. `master_housing`: **Pitt 142 rows** (68 `On-Campus Housing` + 74
`Leased Apartments, Apartment Style Housing`) — that is the reconciliation of the 142-vs-68 numbers
quoted in different places, they are the total and the on-campus subset, not a contradiction — and
**CMU 65 rows** (43 on-campus + 22 apartments). **Every row of both tenants is geocoded** (0 null
lat/lng; bboxes sit over Oakland/Squirrel Hill as expected). `explore_picks`: **Pitt 17, CMU 0** —
CMU students see an empty Explore tab, which is a content gap, not a bug.

**Pitt and CMU are both live tenants** (Pitt since launch, CMU soft-launched 2026-07-10). This groundwork makes university #3 (Carlow, …) an operator action instead of a schema project:

- `public.universities` registry table, seeded with Pitt (`is_active = true`).
- Email-domain → university mapping: `handle_new_user()` derives `profiles.university_id` from the signup domain; the signup gate (`validate_university_email()`) now reads `universities.email_domains` for `is_active` rows instead of a hardcoded regex.
- Nullable `university_id` FKs, backfilled to Pitt, on `profiles` + the 10 campus-scoped root content tables (§3.A).
- Frontend config layer: `src/config/universities.ts` (source of truth, mirrors the DB seed UUID), `UniversityProvider`/`useUniversity()` (statically Pitt today), `src/lib/universityAuth.ts` (config-driven gate + copy).
- Content data (`src/data/moveInSteps.ts`, `moveInJourney.ts`, `moveOut.ts`) re-keyed by university slug with accessors; legacy exports unchanged.

**Explicit non-goals as first written on 2026-07-05 — the first one no longer holds:**

- ~~Tenant RLS: no `USING (university_id = …)` filters anywhere.~~ **Shipped 2026-07-10**, the same day CMU went live: `20260710055901_tenant_isolation_rls.sql`, then the SECURITY DEFINER helper (`20260710183110_tenant_isolation_helper.sql`) and the class-A rollout (`20260721000000_apply_class_a_tenant_isolation.sql`). §3 below describes the live system correctly; this bullet was the stale one, and it contradicted §3 for a month. Verified against prod 2026-08-06: **26 tenant-scoped policies across 21 `public` tables**. The design write-up (`current_university_id()`, university_admin confinement) still lives in `docs/architecture-zones-and-admin-tiers.md`.
- `NOT NULL` on any `university_id`.
- Role checks / write policies on `universities` - writes are service-role only (operator action; B2B onboarding is never self-serve).
- Per-school content, branding, and feature-flag wiring (`University.features` exists but is dormant).
- Marketing/legal zone: stays Pitt-specific per the 2026-07-03 branding note.

## 2. Tenancy model and invariants

- **Fixed Pitt UUID:** `00000000-0000-4000-8000-000000000001`. Duplicated in `src/config/universities.ts` (`PITT_UNIVERSITY_ID`) and the migration seed. **Never change it** - every backfilled row points at it.
- **Domain matching is exact, lowercase, no subdomains.** `student.pitt.edu` is rejected - identical to the old regex `^[A-Za-z0-9._%+-]+@pitt\.edu$`. Store `email_domains` entries lowercase without `@`.
- **No single-tenant DEFAULT on content tables (since 2026-07-10):** the root tables originally carried `DEFAULT '<pitt-uuid>'` so client inserts never drifted to NULL; that DEFAULT was dropped and replaced by a profile-derived `university_id` trigger before CMU activated (`20260723010000_drop_university_default_add_trigger`). **Never reintroduce a tenant DEFAULT** — under two live tenants it would silently mis-file new rows.
- **Never deactivate the last active university** - `validate_university_email()` would reject every signup.
- **`profiles.university_id` has no DEFAULT** - `handle_new_user()` computes it from the email domain (`SELECT INTO`, NULL on no match; profile creation never raises, signup never breaks).
- **Gate rejection message** is still the static Pitt string (byte-identical UX). Make it dynamic from the active-domain list when #2 lands. The *client-side* rejection copy is already config-driven (`universityOnlyMessage()`).
- `api/_lib/auth.ts` (Vercel bundle, can't import from `src/`) keeps its own `ALLOWED_EMAIL_DOMAINS` - today `['pitt.edu', 'andrew.cmu.edu', 'cmu.edu']`, i.e. the domains of every **active** university. **Keep in sync with `src/config/universities.ts`** when domains change; since 2026-08-06 `src/test/allowedEmailDomainParity.test.ts` asserts set equality between the two, so a one-sided edit now fails the suite instead of reaching prod.

## 3. Table classification — inventory moved to `docs/schema-map.md`

> **Machine-readable source of truth (2026-07-10):** `supabase/registry/table-classification.json`.
> Every `public` BASE TABLE must have an entry there; `npm run test:db` (registry audit +
> live cross-tenant probe, `supabase/tests/tenant_registry.test.sql` /
> `tenant_isolation.test.sql`) fails on any unregistered or mis-scoped table, and runs as a
> gate in `pre-push` and the `migration-guard` workflow. The prose below is the rationale;
> when they disagree, the registry + audit win. See §3.1 for how to classify a new table.

### 3.1 Adding a table? Pick a tenant class (mandatory)

1. **Pick a class** — A: campus content with its own `university_id` · B: child rows scoped
   through a parent FK · C: user-owned rows (`user_id = auth.uid()`) · D: social graph
   (creation-time confined, or membership-inherited) · E/F: explicitly exempt (city infra /
   platform-global) with a written reason.
2. **Add the entry** to `supabase/registry/table-classification.json` in the same PR as the
   migration (B needs `parent`; D needs `mechanism`; membership-D/E/F need `reason`).
3. **Apply the pattern** in the migration:
   - **A** — one call: `SELECT public.apply_tenant_isolation('public.<table>');`
     (requires a `university_id` column; creates the standard RESTRICTIVE policy).
   - **B** — copy-paste, swap table/parent/FK:
     ```sql
     CREATE POLICY tenant_isolation ON public.<table>
       AS RESTRICTIVE FOR ALL TO authenticated
       USING (EXISTS (SELECT 1 FROM public.<parent> p WHERE p.id = <table>.<parent_fk>));
     ```
     Safe **only because** the EXISTS subquery is itself subject to the parent's RLS — never
     route the parent lookup through a SECURITY DEFINER helper. The registry audit asserts
     every declared B-parent keeps RLS enabled.
   - **C** — normal ownership policies (`user_id = auth.uid()` in USING/WITH CHECK); the
     owner's `profiles.university_id` is the implicit tenant scope.
   - **D (confined)** — RESTRICTIVE INSERT policy named `tenant_confined` comparing both
     parties' `profiles.university_id` (see `conversations` in `20260723020000`).
4. **Run `npm run test:db`** — must be green before the PR ships.

### 3.2 The inventory itself, and activation-specific notes

**The full per-table inventory (classes A–F + views, with what each table holds) is canonical in
[`docs/schema-map.md`](schema-map.md)** — one table list, kept honest by the registry audit. Do not
re-list tables here. Only the notes that are *activation instructions* stay in this doc:

- **`marketplace_listings` column grants:** it uses an enumerated column-level SELECT grant (SEC-6, `20260622000733`); the migration explicitly grants SELECT on `university_id`. Any activation-time query/RLS work must respect the grant list — never `select('*')`.
- **Social graph (class D) — decided 2026-07-10:** DMs/groups are **tenant-confined**, not cross-campus — enforced at creation time (`tenant_confined` INSERT policies, `20260723020000`), with reads inheriting via membership. Revisit only if a cross-campus product need emerges.
- **`university_waitlist`** (`20260708000000`) — public email capture for students whose university is not yet active. anon+authenticated INSERT-only (no SELECT/UPDATE/DELETE; service-role reads it); BEFORE-INSERT trigger lowercases the email and derives `email_domain`; `unique (lower(email))` dedups. Captures demand *ahead of* a tenant existing. **Scrub by `email_domain` before activating a university (§6 step 0).**
- **`analytics_events`** may later want a `university_id` *dimension* for per-campus dashboards — an analytics decision, not a tenancy requirement.
- **`schools` + `school_domains`** (`20260725000000`, class F) — US institution reference directory (College Scorecard/IPEDS spine, many domains per school), read pre-login only via the anon-callable `resolve_school_by_domain()` RPC (progressive subdomain strip — a deliberate, naming-only divergence from the §2 exact-match gate invariant). Powers the auth page's "Looks like you're at {school}" waitlist branch and tags `university_waitlist.school_id` at capture (`20260725010000`, set server-side by `/api/join-waitlist`). **Directory membership never authorizes sign-in**; `schools.matched_university_id` is the only bridge to the tenant registry and is set at activation (§6). Seed/refresh: `scripts/seed-school-directory.mjs` (needs `SCORECARD_API_KEY`).

## 4. Query sites needing `university_id` filters at #2

Files that read the root tables today (grep `from('<table>')`, 2026-07-05). None filter by university - with one active tenant every row is Pitt's. At #2, add `.eq('university_id', …)` (or rely on Phase 3 RLS and keep clients unfiltered - decide then; RLS-only is the safer default):

- `master_housing`: `src/hooks/useDorms.ts`, `src/hooks/useCurrentUserBuilding.ts`, `src/lib/dormUtils.ts`, `src/lib/mapboxWalking.ts`, `src/components/dorm-portal/OverviewTab.tsx`, `src/pages/admin/DormEditPage.tsx`, `src/pages/admin/ReportsPage.tsx`
- `marketplace_listings`: `src/hooks/useMyListings.ts`, `src/hooks/useDeleteListing.ts`, `src/components/dorm-portal/MarketplaceTab.tsx`, `src/components/chat/MessagePreviewCard.tsx`, `src/components/my-home/SavedHomeBand.tsx`, `src/components/my-home/ActivityFeedWidget.tsx`, `src/pages/app/MarketplaceEdit.tsx`, `src/pages/app/MyHomePage.tsx` (+ the `get_marketplace_preview` RPC and Marketplace browse queries)
- `business_listings`: `src/components/marketplace/StudentBusinessesSection.tsx`, `src/components/marketplace/BusinessListingForm.tsx`, `src/pages/app/MarketplaceMyItems.tsx`, `src/components/chat/MessagePreviewCard.tsx`
- `roommate_search_posts`: `src/components/roommates/FindingRoommates.tsx`, `src/components/my-home/YourRoommatePostWidget.tsx`, `src/pages/app/MyHomePage.tsx`, `src/pages/admin/ReportsPage.tsx`, `src/components/chat/MessagePreviewCard.tsx`
- `dorm_questions` (+ answers via portal QA): `src/components/my-home/ActivityFeedWidget.tsx`, dorm-portal QA tab
- `student_setups`: `src/components/dorm-portal/StudentSetupsTab.tsx`, `src/pages/app/RoomGalleryPage.tsx`, `src/components/my-home/ActivityFeedWidget.tsx`
- `building_chat_links`: `src/hooks/useBuildingChatLinks.ts`, `src/pages/admin/ReportsPage.tsx`
- `explore_picks`: `src/pages/app/ChecklistPage.tsx`, `src/components/checklist/ChecklistExploreTab.tsx`, `src/components/checklist/ExploreProductDetailModal.tsx`
- `buildings` / `course_sections`: `src/hooks/useSchedule.ts`
- User search (`public_profiles`) in `DmUserSearchModal` - cross-tenant discovery question (§3.D)
- Server side: `supabase/functions/admin-metrics` (per-campus rollups), `api/_lib/notifications.ts` (Pitt-branded email template)

## 5. Pitt-named code deliberately left (rename/generalize at #2)

**Status update 2026-07-10 (pre-flip content gating, step 9):** signed-in surfaces no longer leak
Pitt content to other tenants. Move In / Move Out tabs gate on `hasMoveInContent()` /
`hasMoveOutContent()` with a shared `UniversityContentComingSoon` empty state; the campus map
centers from `University.campusCenter`; the OverviewTab DRS block and address fallback and the My
Home countdown window fallback are pitt-slug-gated; tenant-shared copy ("Pitt student" fallbacks, marketplace subtitles,
VerifiedStudentBadge) is neutral or shortName-driven. Items below still hold for renames and for
authoring real #2 content (moveInArrival.ts pins, Ship2Pitt wizards remain
Pitt-only behind the Move In gate; marketing/legal/Footer stay Pitt per the 07-03 branding note).

**Status update 2026-08-06 (de-Pitt sweep, phase 1 — geo):** the last three hardcoded Oakland
coordinates in signed-in code are gone. `ScheduleMapView` and the admin `MapPicker` no longer
carry a `PITT_CENTER` constant — the schedule map opens on `University.campusCenter` for the
signed-in student, and the picker takes a **required** `center` prop derived from the dorm row's
own `university_id`, so a superadmin editing a CMU dorm does not start over Oakland. The building
table behind move-in walking times is slug-keyed (see the `campusMapData.ts` entry below).
`SetHomeDialog`'s private geocoder was folded into `@/lib/geocode` separately (`c03cf94f`).
Required arguments are the pattern here: `geocodeAddress(address, proximity)` and
`MapPicker`'s `center` both fail to compile rather than silently defaulting to Pitt.

- ~~`/resources` hub + the dorm-portal resources tab (pitt-slug-gated)~~ - **the feature was removed entirely**, so there is nothing left to generalize at #2. Every frontend consumer is gone (`ResourcesPage`, the native guide pages, the `/admin/resources` CRUD, `useUniversityResources`, the My Home widget, the PlatformPage seed count) and `20260820030000_drop_university_resources.sql` drops the table. **That drop is committed but NOT yet applied to prod** — verified 2026-08-06, `public.university_resources` still exists there, orphaned, because the contract step is gated on a confirmed backup (`npm run db:preflight`). Rollback DDL: re-run `20260711041131_university_resources.sql`.
- ~~`validate_pitt_email()` DB function + `check_pitt_email_on_signup` trigger~~ - **renamed 2026-07-10** to `validate_university_email()` / `check_university_email_on_signup` (`20260710055958_generalize_email_gate`). This entry stood for weeks saying the rename was "deferred" after it had already shipped; that inversion is what `npm run docs:check` now catches.
- ~~`is_pitt_user()` SQL primitive (`20260630000000`)~~ - **dropped 2026-07-10** (`20260724020000`); it was never wired to a policy and tenancy goes through `current_university_id()`.
- ~~`src/lib/pittAuth.ts` - deprecated re-export shim~~ - **deleted 2026-07-28** (dead-code sweep item 1; zero importers confirmed against HEAD before removal). <!-- docs-drift-ignore: src/lib/pittAuth.ts — deleted 2026-07-28, kept as a historical pointer for this checklist's own "delete at #2" item -->
- ~~`api/_lib/auth.ts` `isPittEmail()` name (body generalized)~~ - **renamed to `isAllowedEmailDomain()`**; the `ALLOWED_EMAIL_DOMAINS` sync constant (`['pitt.edu', 'andrew.cmu.edu', 'cmu.edu']`) remains the thing to keep in sync with `src/config/universities.ts`.
- ~~`src/lib/pittCampusMapData.ts` (`PITT_COURSE_BUILDINGS`, reference pins)~~ - **done 2026-08-06**: renamed to `src/lib/campusMapData.ts` and keyed by slug behind `resolveCampusBuilding(name, slug)`, with a deliberately empty `cmu` entry (same shape as `campusLandmarks.ts`). The old `resolveAnyPittBuilding()` resolved ANY tenant's move-in step against the flat Pitt table, so a CMU student got an Oakland walking time; an unknown slug now returns null instead of falling back to Pitt. Authoring real CMU building coordinates is still open — an empty entry means "no walk time", not "no work left". <!-- docs-drift-ignore: src/lib/pittCampusMapData.ts — renamed 2026-08-06, kept as the historical name this checklist item was filed under -->
- Pitt program content: Ship2Pitt / Store@Pitt wizards (`LogisticsPanel.tsx`), `OverviewTab.tsx` building addresses + housing contacts, `moveInArrival.ts`, seeds (`scripts/seed-buildings.mjs`, `seed-course-sections.mjs` are Pitt-sourced).
- Decorative auth-page copy ("The Student Hub for Pitt.", "Built by Pitt students, for Pitt students.", "Spam/Pitt Quarantine"), Cathedral of Learning hero image.
- Marketing + legal zone (`src/pages/marketing/*`, `src/components/marketing/*`, Terms/Privacy) - per the 07-03 branding decision.
- Pitt-branded transactional email template (`api/_lib/notifications.ts`).

## 6. How to activate university #2

0. **Scrub the waitlist:** query `public.university_waitlist` for the incoming domain (`email_domain = '<domain>'`) so you know who to notify, and can cite real demand in the partnership pitch. Table is service-role-read only; captured client-side from the auth page's non-active-domain branch (see §3.F and `docs/audits/auth-and-access.md` §6).
1. **Operator (service role):** `INSERT INTO universities (slug, name, short_name, email_domains, city, is_active) VALUES (…, false)` - keep inactive while preparing.
2. **Schema prep:** drop the single-tenant `DEFAULT` on the 10 root tables; add a profile-derived `university_id` trigger (or set it in the insert paths). Make the gate rejection message dynamic.
3. **Config:** add the entry to `UNIVERSITIES` in `src/config/universities.ts` (id = the new row's UUID) - set `isActive` and `authMethods` (which logins are live for this school; array order = button order on `/auth`; keep in sync with the providers actually enabled in Supabase/Entra/Google for that domain); wire `UniversityProvider` to resolve from `profiles.university_id`. Pre-auth school resolution is **identifier-first** (2026-07-10): `/auth` resolves the school from the typed email via `resolveUniversityByEmail()` and only then reveals that school's provider buttons / OAuth domain-hint / light branding; the `/select-school` picker (`src/pages/auth/SelectSchool.tsx`, resolver `src/lib/selectedUniversity.ts`) is a fallback reached from the auth card's "Pick it from the list" link (`?pick=1`). A new tenant needs only a correct `emailDomains` + `authMethods` entry - **never add an SSO method until it is wired and tested for that domain** (email/password is the universal floor). The flow only changes which buttons/hints show; the actual **email signup gate stays single-flow** until step 6 wiring lands.
4. **Content:** author slug-keyed entries for move-in/move-out/journey data, campus map data, logistics; decide `features` overrides.
5. **Tenant isolation (Phase 3):** `current_university_id()` helper + RLS filters on §3.A/B/D tables per `docs/architecture-zones-and-admin-tiers.md`; decide the social-graph cross-tenant question.
6. **Flip `is_active = true`** - signups for the new domain start working. Update `api/_lib/auth.ts` domains. Sweep §5.
7. **Ops:** apply migrations to prod via MCP `apply_migration` (never `db push`), smoke-test signup for both domains, run advisors + `npm run audit:app`.

<!-- docs-drift-ignore: validate_pitt_email, is_pitt_user -->
<!-- Both are named ONLY in struck-through historical entries recording their
     removal/rename. -->
