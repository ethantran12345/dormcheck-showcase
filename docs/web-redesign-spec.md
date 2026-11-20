# DormCheck - Web Redesign Spec (for the code agent)

**Goal, plain English:** the web version currently reuses the iOS app's chrome, so the public
site looks like a scaled-up app and - worse - student data is reachable without signing in.
Split the web into two clean modes:

1. **Public (logged out):** a real marketing site. Marketing nav + content pages. No student data anywhere.
2. **App (logged in):** the product, with a web-native desktop layout (sidebar, not iOS bottom nav / mega-menus), and every student-data route gated behind sign-in.

Companion visual: `docs/web-redesign-mock.html` (open in a browser; toggle bottom-center switches Public ⇄ Signed-in app).

**Hard rules that bind this work** (from `06 - Principles and Patterns.md` / repo CLAUDE.md):
- Never charge the student → **no Pricing page/link.** Money flows through universities/brands/businesses.
- "Extension, not replacement" for Pitt systems - public copy must not imply Pitt housing is broken.
- Brand color `#03C03C` = `malachite-600`. Never teal, never `#5FB49C`. Use `malachite-*` tokens, never raw green hex.
- No dollar figures in partner/stakeholder-facing marketing copy.

Branch off `dev`. Journal per repo CLAUDE.md (CHANGELOG + DECISIONS + affected audits).

---

## 0. Priority 0 - close the data leak (ship first, even alone)

**Problem:** in `src/routes/AppRoutes.tsx`, `/marketplace` and `/checklist` render with **no**
`ProtectedRoute` wrapper. A logged-out visitor can open `/marketplace` today and see real student
listings with phone numbers and Instagram handles. `/profile` (public profiles) is also ungated.

**Fix:** wrap every student-data route in `ProtectedRoute` (it already redirects to
`/auth?redirect=…`). Routes to gate:

| Route | Today | Change to |
|-------|-------|-----------|
| `/marketplace` | open | `ProtectedRoute` |
| `/checklist` | open | `ProtectedRoute` |
| `/campus`, `/campus/:dormSlug`, `/housing`, `/housing/:slug`, `/map`, `/gallery` | `gated()` flag only | wrap the gated element in `ProtectedRoute` too |
| `/roommates*`, `/rankings/invite/:code` | `gated()` flag only | `ProtectedRoute` + gate |
| `/profile` | open | `ProtectedRoute` |

`/my-home`, `/messages`, `/profile/edit`, `/profile/blocked`, `/marketplace/my-items`,
`/marketplace/edit/:id` are already protected - leave them.

**Keep public:** `/` (landing), the new marketing pages (§2), `/privacy`, `/terms`, `/auth*`.

> Note: gating changes what a shared marketplace/listing link does for a logged-out user - it will
> bounce to `/auth?redirect=`. That's the intended behavior and it composes with the planned
> canonical `/marketplace/listing/:id` share route (see vault memory `dormcheck-imessage-share-plan`).

---

## 1. Nav split - marketing nav vs app nav

Today `src/components/TopNav.tsx` renders the **app** nav for everyone and only swaps the right-side
button (`Sign In` vs `Profile`). Logged-out visitors see Housing/Checklist/Marketplace + iOS-style
mega-menus.

**Change:** branch the web top nav on auth.

- **Logged out (web):** render a new `MarketingTopNav`.
  - Links: **Features · How It Works · For Students · For Universities & Brands · About**
  - Right side: `Sign In` (ghost) + `Get Started` (primary → `/auth`)
  - No mega-menus, no app tabs, no student sections.
- **Logged in (web):** keep an app nav - but per §3 the primary app nav becomes a **left sidebar**,
  so the top bar here is reduced to logo + search + messages/notifications + avatar. Drop the
  hover mega-menus entirely (they're the iOS-shaped artifact that buried Logistics/Gallery).

Native (`Capacitor.isNativePlatform()`) is unchanged - `TopNav` already returns `null` there and the
app keeps `NativeTopBar` + `BottomNav`.

Suggested structure:
- New `src/components/marketing/MarketingTopNav.tsx` + `MarketingFooter.tsx` (or reuse `Footer`).
- New `src/components/app/AppSidebar.tsx` (see §3).
- In `LayoutWrapper` (`App.tsx`), pick chrome by auth + zone instead of always mounting `GlobalTopNav`.

---

## 2. Marketing pages + routes

Add to the Marketing zone (`src/routes/MarketingRoutes.tsx`, web-only - native must NOT mount these):

| Path | Page | Content (no student data) |
|------|------|---------------------------|
| `/` | existing `LandingPage` | keep hero (`HeroGeometric`) + bento; update nav to `MarketingTopNav` |
| `/features` | new | the 3 feature blocks (Checklist, Marketplace, Shipping & Storage) + how-it-works |
| `/how-it-works` | new (or anchor on `/features`) | 3-step verify → plan → settle |
| `/for-students` | new | free-for-students, verified community |
| `/partners` (For Universities & Brands) | new | extension-not-replacement, move-in reach. **No dollar figures.** |
| `/about` | new | mission, built-by-Pitt-students |

Marketing pages must contain **zero live student data** - illustrative placeholders only. Where the
mock shows a marketplace, it's a locked/blurred teaser with "Sign in with @pitt.edu to browse."

`/dorms`, `/ads`, `/moderation` already exist in the marketing zone - fold their nav/footer into the
new marketing chrome so they stop rendering the app `TopNav`.

---

## 3. Web-native app shell (logged-in IA)

Replace the "iOS tabs across a top bar" feel with a desktop layout:

- **Left sidebar** (`AppSidebar`), grouped:
  - **Home:** My Home
  - **Get ready:** Checklist · Marketplace · Shipping & Storage
  - **Community:** Messages · Housing *(Soon)* · Roommates *(Soon)*
  - **Footer:** Admin (if `isAdmin`) · user chip (avatar + name + email)
  - `Soon` = the Phase-1-gated surfaces (`useFeatureFlags` `showHousing`/`showRoommates`), shown as
    disabled items instead of hidden, so the roadmap is legible.
- **Top bar (app):** logo (mobile), search, messages, notifications, avatar. No mega-menus.
- **`/my-home` dashboard:** true multi-column desktop dashboard (mock shows 2fr/1fr):
  - Left: move-in countdown, quick actions, "fresh in the market" preview
  - Right: your listings, building/floor chats, your building + logistics
- **Responsive:** sidebar collapses under 900px; below that fall back to the existing mobile-web
  layout (`useIsMobile()` at 768px). Unprefixed Tailwind stays the mobile/iOS baseline; add sidebar
  with `md:`/`lg:` only (repo mobile-first rule).

This is layout/IA only - reuse existing page components and data hooks; don't fork feature logic.

---

## 4. File touch-list (starting point)

- `src/routes/AppRoutes.tsx` - add `ProtectedRoute` wrappers (§0).
- `src/routes/MarketingRoutes.tsx` - add marketing page routes (§2).
- `src/components/TopNav.tsx` / `GlobalTopNav.tsx` - split marketing vs app; drop mega-menus for app.
- `src/components/marketing/MarketingTopNav.tsx`, `MarketingFooter.tsx` - new.
- `src/components/app/AppSidebar.tsx` - new (§3).
- `src/pages/marketing/*` - new Features/HowItWorks/ForStudents/Partners/About pages.
- `src/App.tsx` `LayoutWrapper` / `AppLayout` - choose chrome by auth + zone.
- Reuse `useAuth`, `useFeatureFlags`, `ProtectedRoute`, `malachite-*` tokens, Nunito.

## 5. Verify before merge

- `npm run lint && npm run test && npm run build`
- `npm run audit:app` (3-persona Playwright crawl) - **must show the anon persona bounced off
  `/marketplace`, `/checklist`, `/profile` to `/auth`**, and marketing pages rendering for anon.
- Manual: logged-out web = marketing only, no student data reachable; logged-in web = sidebar shell;
  native app unchanged (still `NativeTopBar` + `BottomNav`).
- Grep for stray green hex / "teal" / any Pricing link before committing.
