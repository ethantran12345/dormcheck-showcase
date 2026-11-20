# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Undergraduate university students, primarily first- and second-years at the University of
Pittsburgh (live pilot) and Carnegie Mellon (live). They arrive in three situations:

- **Pre-move-in** — accepted, assigned or choosing a dorm, packing. The job is "figure out
  what I actually need to bring and what my room will be like."
- **Move-in and early semester** — settling in, buying and offloading dorm goods, finding
  people. The job is "get set up and connected without overpaying."
- **Housing search (rising sophomores/juniors)** — deciding where to live next year. The job
  is "compare real options with real information from people who lived there."

Secondary audiences, both confirmed but not the design center: university housing/residence-life
staff (admin surfaces, tenant-scoped), and local businesses/landlords listing to students.

## Product Purpose

Dormcheck is a multi-tenant platform for university housing and campus life. It gives a student
one place to prepare for, move into, and live in university housing: a packing/move-in checklist,
a student-to-student marketplace, direct messages, and — beyond the Phase 1 default — housing
exploration, a campus map, roommate matching, dorm rankings, group chats, and saved dorms.

Success is a student who trusts Dormcheck enough to use it before they arrive on campus and keeps
using it through the housing-search cycle, and a university that sees it as an extension of its
own housing operation rather than a competitor to it.

## Positioning

Dormcheck is **tenant-scoped and student-verified**: every account is gated on a university email
address, and content is scoped to that university. A general-purpose marketplace, forum, or
listing site cannot truthfully claim that its housing information and its sellers are all verified
students of the same school. That verification is the mechanism, not a feature.

Dormcheck positions as an **extension, not a replacement** for existing university systems
(StarRez, College Pads, RoomSync, Panther Central at Pitt). Copy and design must never imply
those systems are broken or that Dormcheck replaces them.

## Operating Context

- Students use this overwhelmingly on a phone, frequently on campus wifi or cellular, often in
  short bursts (between classes, while packing, while standing in a dorm room).
- The same product is reached three ways from one codebase: desktop web at dormcheck.com, an
  iOS app (Capacitor shell around the same React bundle), and mobile web. Runtime — not
  build-time — branching decides the shell.
- Real-world rituals the product sits inside: housing assignment release, move-in day, the
  spring housing-selection lottery, end-of-semester move-out (which drives marketplace supply).

## Capabilities and Constraints

**Confirmed capabilities:** checklist (incl. shareable checklists and an affiliate-linked Shop
Essentials catalog), marketplace with listings and seller ratings, direct and group messaging,
housing explore, campus map, roommate matching, dorm rankings, saved dorms, admin/moderation
surfaces, push and transactional email notifications.

**Feature gating:** Phase 1 is the default for non-admins (checklist, marketplace, DMs). The
remaining features exist in the codebase but are behind `LIMITED_SURFACES` in
`src/lib/featureFlags.ts`. Design work must not assume a surface is reachable by a normal user.

**Technical constraints:**

- One React 18 + TypeScript SPA (Vite, Tailwind 3.4, Radix/shadcn) serves all three surfaces.
  Unprefixed Tailwind classes are the mobile/iOS baseline; desktop is layered on with `md:`/`lg:`
  only. Never change an unprefixed class to serve desktop.
- One Supabase backend (Postgres + RLS, Auth, Realtime, Storage, Edge Functions); transactional
  email runs on Vercel `/api`. Multi-tenancy is enforced in RLS, not in the client.
- iPad is not supported today (iPhone-only native); it is planned, not shipped.
- Auth is gated on a university email across four synced layers (form validation, a client-side
  enforcement helper, a Postgres trigger, and the API handler). Any sign-up UI must respect it.

**Terminology:** "tenant" = a university. "Lane" = an internal parallel-agent git worktree, not
a product concept. "Phase 1" = the shipped, non-admin feature set.

## Brand Commitments

- **Name:** Dormcheck. Wordmark set in Sora; assets in `public/` (`dormcheck-logo*.png`,
  `dormcheck-wordmark-sora*.png`).
- **Brand color is `#03C03C`** — malachite green. This is binding. Never substitute another
  green hex, and never describe the brand as "teal." Greens in code come from the `malachite-*`
  scale; solid green fills on light backgrounds use `malachite-800` for AA contrast.
- **Voice:** plain, student-peer, non-institutional. No em dashes in user-facing copy.
- **Never charge the student.** Monetization flows through universities, brands, and businesses.
  No student-facing pricing, paywall, subscription, or upsell surface may be designed.
- **Extension, not replacement** — see Positioning. Binding on copy as well as design.
- Amazon affiliate links must carry `tag=dormcheck-20`.

## Evidence on Hand

- Live production product with real users at Pitt and CMU; real dorm, listing, and checklist
  data in Supabase.
- Real brand assets, logos, and wordmarks in `public/`; product photography in `src/assets/`.
- A documented design system: `src/design/tokens.json` (canonical), `src/index.css` (runtime CSS
  variables), `tailwind.config.ts`, and per-feature audits in `docs/audits/`.
- Strategy, market, and institutional-data material lives in a separate Obsidian vault, not in
  this repo.

**Absences future work must not fabricate:** there are no published testimonials, case studies,
press mentions, user counts, revenue figures, or pricing in this repository. Do not invent them,
and do not restate a number from memory — every figure comes from the vault's institutional-data
file or it does not get used.

## Product Principles

1. **Verified and scoped beats open.** Every surface assumes the viewer is a verified student of
   one university, and shows them their university's world.
2. **The phone is the product.** Design mobile-first and treat desktop as the layered case.
3. **Extension, not replacement.** Never position against or disparage a university's existing
   housing systems.
4. **The student never pays.** Value reaches the student free; revenue comes from institutions
   and businesses.
5. **One codebase, three shells.** Differences between web, mobile web, and the iOS app are
   runtime decisions, never forks of the design.

## Accessibility & Inclusion

WCAG AA contrast is a blocking gate, not an aspiration: `jsx-a11y` lint and axe checks must pass
before merge. Interactive icon-only controls require an accessible name. Solid brand-green fills
on light backgrounds must use `malachite-800` rather than the `#03C03C` brand tone to hold AA.
Dark mode ships via a `class` strategy; pre-auth and `/admin` are always light.
