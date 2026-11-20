# Architecture: Web Zones + Admin Tiers - Migration Plan

> Doc-control: created 2026-06-27, status refreshed 2026-07-27 at commit `92ca927d`. Owner: Ethan.
> Companion decision: strategy vault `08 - Decisions Log.md` (2026-06-27).
> Code truth stays in `docs/ARCHITECTURE.md` + `docs/audits/*`; this is a planning doc.

> **Status: phases 0–3 have SHIPPED.** This is no longer a forward-looking plan for the
> zone split or the admin tiers — it is retained for the reasoning behind them. What is
> live today:
>
> - **Phases 0–1 (zones):** `src/pages/` is split into `app/`, `auth/`, `marketing/`,
>   `admin/`, `advertiser/`, and `src/routes/` holds `AppRoutes`, `AuthRoutes`,
>   `LegalRoutes`, `MarketingRoutes`, `AdminRoutes`, `AdvertiserRoutes`, composed by
>   `App.tsx`. An **advertiser zone** exists that this doc never anticipated.
> - **Phase 3 (admin tiers):** the `app_role` enum, `profiles.role`, `profiles.university_id`,
>   `profiles.admin_scopes`, `current_university_id()` / `has_admin_scope()`, the
>   `AuthProvider` role surface, and `RequireSuperAdmin` route guards are all live.
>   `AdminLayout` shipped after all (this doc called it future work), as did a delegated
>   **capability-scope** layer finer-grained than the two tiers described below.
> - **`profiles.is_admin` is retained but DERIVED** — a trigger projects it from
>   `profiles.role`. Writing it directly is silently reverted; always write `role`.
> - **The multi-university deferral below is void.** University #2 (CMU) activated
>   2026-07-10; tenant-aware RLS shipped across the schema. See
>   [`schema-map.md`](schema-map.md) and [`multi-university.md`](multi-university.md).
>   The `@pitt.edu` literals in this doc are historical: the gate is now tenant-driven
>   (`validate_university_email()`, `src/lib/universityAuth.ts`).
>
> The remaining genuinely-open item is **phase 2's physical native-bundle exclusion**
> (admin/marketing chunks are route-guarded, not excluded from the native build).

## Decision summary

Stay on Capacitor. One React/TypeScript codebase serves desktop web, mobile web, and
the iOS app (the same bundle in a WKWebView) - no SwiftUI/native rewrite. Organize the
web app into three **audience zones**, and have the native build ship only the User
zone. Replace the binary `profiles.is_admin` flag with **tiered admin roles**.

### Why not native (recap)

The iOS app is the same React bundle in a WKWebView. ~81k lines of UI plus the data
layer (97 Supabase-touching files, 64 TanStack Query files, 16 realtime files), auth,
and feature flags are shared across web and iOS. A SwiftUI rewrite would re-implement
the shared *user* features a second time in Swift and force dual maintenance forever,
while the genuinely web-only surfaces (admin, marketing) were never the problem. The
web/iOS difference is structured layering (~385 `md:`/`lg:` overrides + native nav
chrome on one component tree), not two UIs. Revisit only if iOS becomes the primary
surface or a native-only capability becomes a real user need.

## Target architecture

### Three zones

| Zone | Audience | Surfaces (routes) | Ships to iOS? | Chrome / layout |
|------|----------|-------------------|---------------|-----------------|
| **Public / Marketing** | anyone (mostly logged-out) | `/`, `/dorms`, `/ads`, `/moderation`, + future `/about`, `/pricing`, `/sales` | No | `GlobalTopNav` + `Footer` (`MarketingLayout`) |
| **Legal (shared)** | anyone, signed in or out | `/privacy`, `/terms` | **Yes** | inherits the shell (own page chrome) |
| **User App** | students (auth, `@pitt.edu`) | `/my-home`, `/checklist`, `/marketplace*`, `/messages`, `/profile*`; Phase-2: `/campus*`, `/housing*`, `/gallery`, `/map`, `/roommates*`, `/rankings/*` | **Yes - the native bundle** | `NativeTopBar` + `BottomNav` (native) / mobile-web (`AppLayout`) |
| **Admin / Internal** | `university_admin` + `superadmin` | `/admin*`, `/admin/platform*` | No | `AdminLayout` |

Auth boundary (shared, both web and native): `/auth`, `/auth/v1/callback`, `/onboarding/intro`.
`NotFound` (`*`) stays shared. The **legal pages** `/privacy` and `/terms` are a small shared zone (`src/routes/LegalRoutes.tsx`): they mount on web **and** native, and are exempt from the native logged-out → `/auth` guard, because Apple requires the privacy policy and terms to be reachable in-app - including from the signed-out sign-in screen. They were split out of Marketing (which is otherwise web-only) so the sign-in (`Auth.tsx`) and profile (`ProfileView.tsx`) legal links don't 404 / bounce on native.

### Admin tiers (RBAC)

Two dimensions: **role** + **university scope**. Replaces the single `is_admin` boolean.

| Role | Scope | Can do | Routes |
|------|-------|--------|--------|
| `user` | self | the User App only | (no admin) |
| `university_admin` | one university (`university_id`) | manage **their** university's dorms, reports, moderation | `/admin/*` (data filtered to their `university_id`) |
| `superadmin` | all universities + platform | everything above, all universities, plus university management, role assignment, global feature flags, platform dashboards | `/admin/*` **and** `/admin/platform/*` (superadmin-only) |

## Backend RBAC model (the careful part)

This is mostly a backend change, not a UI one. Today `isAdmin` is one boolean read from
`profiles.is_admin` in ~12 places.

- **Migration:** create `app_role` enum (`user`, `university_admin`, `superadmin`); add
  `profiles.role` (default `user`); add `profiles.university_id` (nullable; single Pitt
  tenant for now). Backfill existing `is_admin = true` → `superadmin`.
- **Compatibility:** keep `is_admin` working during the transition (retain the column or
  derive it) so the ~12 references don't break; migrate them to role checks incrementally.
- **RLS (security-critical):** add SECURITY DEFINER helpers `current_app_role()`,
  `is_superadmin()`, `current_university_id()` to avoid recursive policies. University-scoped
  tables get policies where `superadmin` has full access and `university_admin` is confined
  via `USING (university_id = current_university_id())`. This is the part that must be right - 
  do it in the DB, never in the client.
- **AuthProvider** (`src/hooks/useAuth.tsx`): expose `role`, `universityId`, `isSuperAdmin`,
  `isUniversityAdmin`; keep `isAdmin = role !== 'user'` for backward compatibility.

## Phased migration (each phase independently shippable)

| Phase | What | Code risk |
|-------|------|-----------|
| **0** | Document + decide (this doc + decision log) | none |
| **1** | Reorganize, behavior unchanged (zone folders + route modules) | low (file moves) |
| **2** | Enforce the mobile boundary (lazy zones + one native guard; optional native-bundle exclusion) | low–med |
| **3** | Admin tiers: DB role model → AuthProvider → route guards → superadmin surface | med (RLS) |
| **4** | Declarative per-zone access guards; grow web-only surfaces | low |

Phase 3 (the admin-tier work) depends on Phase 1's `AdminRoutes` split - don't start it first.

### Phase 1 detail - file moves + route split

**Folder moves** (pure moves; the `@/` alias keeps imports safe). `src/pages/*` → `src/pages/<zone>/`:

- `marketing/`: `LandingPage`, `Dorms`, `Ads`, `Moderation`, `Privacy`, `Terms`
- `auth/`: `Auth`, `AuthCallback`, `OnboardingIntro`
- `app/`: `MyHomePage`, `ChecklistPage`, `Marketplace`, `MarketplaceEdit`, `MarketplaceMyItems`, `MessagesPage`, `ProfilePage`, `EditProfile`, `EditProfilePage`, `BlockedAccountsPage`, `Index`, `HousingDetailPage`, `MapPage`, `RoomGalleryPage`, `RoommatePage`, `RoommatesLikedPage`, `RoommatesSavedPostsPage`, `RankingInvitePage`
- `admin/`: `AdminPanel` + existing `admin/` (`Dashboard`, `DormEditPage`, `DormsListPage`, `ReportsPage`)
- shared: `NotFound` stays at top level

Leave `src/components`, `src/hooks`, `src/contexts`, `src/lib` shared - they're cross-zone. Only pages and route wiring move in Phase 1.

**Route modules** - split `App.tsx` (all 35 routes today) into `src/routes/`:

- `MarketingRoutes.tsx` - public routes (web-only), minus the legal pair
- `LegalRoutes.tsx` - `/privacy`, `/terms` (shared web + native); path list + guard in `legalPaths.ts`
- `AuthRoutes.tsx` - `/auth*`, `/onboarding/intro`
- `AppRoutes.tsx` - user routes under `AppLayout`, keeping Phase-1 flag gating
- `AdminRoutes.tsx` - `/admin*` (later add `/admin/platform*`)

`App.tsx` (`RoutedApp`) composes these inside the existing provider stack and the existing
`LayoutWrapper` / `AppLayout` shell (Phase 1 did **not** introduce `MarketingLayout` /
`AdminLayout` - those stay future work).

**Native guard** - consolidate the scattered `Capacitor.isNativePlatform()` route checks in
`App.tsx` into one place: on native, mount only `AppRoutes` + `AuthRoutes` + `LegalRoutes`,
plus `/` (`LandingRoute`, which redirects native → `/my-home` or `/auth`); never mount the
rest of Marketing or any Admin. **Legal exception:** `/privacy` and `/terms` mount on native
and are exempt from the `AppLayout` logged-out → `/auth` redirect, so they stay reachable
in-app (Apple requirement; linked from the signed-out sign-in screen). The chrome-level
native checks in `LayoutWrapper` / `AppLayout` / `NativeSplashGate` remain (they govern
layout, not routing).

## Verification (run after every phase)

`npm run build`, `npm run lint`, `npm run test`, and `npm run audit:app` (Playwright crawl
of every route as anon / user / admin). For Phase 3, extend the audit personas to include
`university_admin` and `superadmin`. Refresh `docs/audits/*` when a feature's behavior
changes and append `docs/CHANGELOG.md`.

## Decide later (open items)

- Naming: `university_admin` vs `partner_admin`; superadmin path `/admin/platform` vs `/superadmin`.
- When university #2 lands: flesh out `university_id` scoping + tenant-aware RLS across the 97 Supabase-touching files.
- Whether to physically exclude admin/marketing chunks from the native bundle (Vite entry split using the existing `CAPACITOR=1` env) vs route-guarding them only.

## Safe pre-#2 refactor: tenant-config for copy/branding

Added 2026-07-03 (Ethan, via Cowork). This is the one multi-university prep worth doing **before** university #2, and it is explicitly NOT the deferred tenancy work above. The 06-27 deferral ("don't build multi-tenancy before there's a second tenant") stays in force for `university_id` scoping + RLS. This item is only the string/branding layer, which carries no DB or behavior change.

**Problem:** "Pitt / Panther / @pitt.edu" is hard-coded in ~435 spots across `src/`, and `@pitt.edu` sits in ~20 UI surfaces (landing, marketplace verified badge, DM search, trust strip, learn-more cards). Each new school today would mean a find-and-replace sweep across the whole UI. `VerifiedStudentBadge.tsx` already flags the intent: "override per school later."

**Fix (pure refactor, no schema change):** pull the tenant-specific literals into one config object, e.g. `src/config/tenant.ts` (`{ name: 'University of Pittsburgh', shortName: 'Pitt', mascot: 'Panther', emailDomains: ['pitt.edu'], logisticsUrls: {...}, brand: {...} }`) and route all copy/URLs through it. Pitt stays the only tenant; nothing about behavior or data changes.

**The verification gate reads the domain from config, it is never removed.** `isPittEmail()` in `src/lib/pittAuth.ts` and the DB trigger `validate_pitt_email()` become domain-driven (validate against `tenant.emailDomains`), keeping the exact same @pitt.edu enforcement for the pilot. Generalize the mechanism, keep the value.

**Out of scope here (still deferred to #2):** `profiles.university_id`, tenant-aware RLS, per-school dorm/logistics/SIS content, the admin role tiers (those are Phase 3 above).

**Timing:** safe to do independent of the #2 deferral, but keep it **behind the ~July 14 pilot and the in-flight EBRG security review**. Do not refactor `pittAuth.ts` or the auth trigger during pilot crunch on code Pitt is actively reviewing. Post-pilot window. Verify with `npm run build` / `lint` / `test` / `audit:app` since it touches copy on every route.

<!-- docs-drift-ignore: partner_admin, src/config/tenant.ts, validate_pitt_email, src/lib/pittAuth.ts — design proposal below never shipped as written; see the explanatory block for each name -->
<!-- This section is a DESIGN PROPOSAL, not a description of the tree:
     `partner_admin` was a naming option that lost, `src/config/tenant.ts` was the
     sketched filename (shipped as `src/config/universities.ts`), and
     `validate_pitt_email()` has since been renamed `validate_university_email()`.
     `src/lib/pittAuth.ts`, the shim this proposal's "generalize the mechanism" line
     refers to, was deleted 2026-07-28 (dead-code sweep item 1). -->
