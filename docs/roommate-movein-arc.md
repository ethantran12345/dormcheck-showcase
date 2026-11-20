# Roommate + Move-in Arc - north-star map

*The shared map for the connected move-in experience. Read this before working on roommates, the Your Dorm hub, or move-in surfaces. Landed in-repo 2026-07-06 (source: Cowork arc brief).*

## North star

Turn DormCheck from a set of disconnected tools into **one connected move-in experience** where a student's people and place follow them through the whole journey:

- Your **roommate** is a real, mutually-confirmed link the whole app reads (checklist collaboration, pinned in your dorm hub, later shopping split and identity).
- Your **dorm** is a place with people and coordination, not a card with three chat buttons.

Strategically this is the retention + top-of-funnel layer: repeated pre-sublet opens, and a warm building/roommate graph feeding the sublet marketplace and the university B2B wedge. It stays inside the hard rules: extension of campus systems (never a replacement), never charging the student.

## The stages

| Stage | What | Status |
|-------|------|--------|
| **1. Roommate-group backbone** | Confirmed, mutual, unit+term-scoped roommate group. Generalized the `ranking_collaborations` primitive with `group_type` (`checklist`/`ranking`/`roommate`) + `dorm_name`/`unit_label`/`term`/`university_id`; `create_ranking_group` recreated with defaulted params; confirmed relationship graduated to Phase 1 (`SHOW_CONFIRMED_ROOMMATES`), browsing stays gated. The roommate group IS the checklist collaboration group. | **Shipped to prod** (migration `20260710000000`; merged to dev `ffc6213`, prod applied 2026-07-06). |
| **2. "Your Dorm" hub - Phase A** | `YourDormWidget` became a tabbed hub: **Community** (building + floor chats primary, external link import demoted to a bridge; building chats graduated to Phase 1 via `SHOW_BUILDING_CHATS`) and **People & Move-in** (opt-in co-resident directory populated passively from `profiles.current_dorm` via `get_building_residents` RPC, roommate group pinned, personal move-in date). | **Shipped to prod** (migration `20260711000000`, applied 2026-07-06). |
| **2.5. Move-in front door** | Capture housing once, reuse everywhere: onboarding step 3 writes `housing_type` + optional `move_in_date` (fixing the RLS gap that kept building chats/People tab dark post-onboarding); roommate confirmation by shareable link (`invite_code` on the group + `join_group_via_invite`/preview/rotate RPCs, Phase-1 route `/roommates/invite/:code`); hall dedupe - `profiles.current_dorm` is the single source of truth for "which hall", synced with `user_home_location` via `src/lib/hallSync.ts` (off-campus addresses stay schedule-only). | **Shipped to prod** (migration `20260712000000` applied 2026-07-07; released to `main` in `fa881e7`). |
| **2.75. Move-in payoff** | Spend the captured data (handoff 2 of 3): **guided setup path** - persistent, dismissible "Finish setting up" card on My Home (`setup_guide` widget, state-derived, dismissal via `home_layout.hidden`, each step deep-links: `?openHousing=true`, `/checklist?confirmRoommates=1`, `/checklist`, `?dormTab=people`); **slot coordination** - People & Move-in tab gains a "By arrival day" view grouping opted-in residents on `move_in_date` (frontend-only over `get_building_residents`); **shopping split** - `checklist_items.assigned_to` (migration `20260712100000`, single assignee, rides the checklist realtime channel; supersedes the multi-claim UI in group mode, `checklist_item_claims` table untouched). | **Shipped** (branch `feat/movein-handoff-2`, migration `20260712100000` prod-applied 2026-07-07). |
| **2.9. Move-in retention (notifications + nudges)** | The habit loop (handoff 3 of 3): a real in-app notifications backend (`notifications` table, server-only writes, realtime badge, mark-as-read RPC - replaced `notificationsStub.ts`) plus exactly two move-in nudges: "X confirmed you as a roommate" (to the group owner, both accept paths) and a cron-free rolling digest of "N new people joined your building" (to existing opted-in residents). In-app only, no email in v1; bell is desktop app shell (mobile/native surface is the follow-up). Detail: `docs/audits/notifications.md`. | **Shipped** (branch `feat/notifications-backend`, migration `20260713000000`, prod-applied 2026-07-07). **This completes the 3-handoff move-in arc.** |
| **3. Hub - Phase B** | Building **events** (RSVP) and **RA** surfacing. Net-new tables, cold-start + moderation/verification cost. | **Backlog.** Decide only after Phase A is live with real residents; an empty Events tab is the FutureResidentsTab trap again. |

## The FutureResidents lesson (do not repeat)

`FutureResidentsTab` was built (`77f8751`) and removed (`e7f05ae`). It died of: (1) explicit self-tag population (cold-start empty), (2) default enumeration of residents (privacy hole), (3) living as a browse tab on every gated dorm page. The Phase-A People tab rebuilds the intent with the opposite mechanics: **passive population from `current_dorm`**, **opt-in visibility default-private** (`profiles.show_in_building`, RPC only listable by residents of the same building, identity tier only), **anchored in the user's own hub**, seeded warm from the roommate group. `dorm_future_residents` (the old table) is intentionally unused.

## Phase-B seams (left clean, unbuilt)

- The hub's tab structure in `YourDormWidget` accepts more tabs (Events, RA) without restructuring.
- `get_building_residents` is the residency + privacy boundary any future building-scoped surface should reuse or mirror.
- The retired `building_chats` my-home widget id must not be reused (legacy `home_layout` JSON still contains it; the parser drops unknown ids).

## Deliberately out of scope for this arc

- Un-gating roommate *browsing* (stays Beyond Phase 1; only the confirmed relationship is Phase 1).
- Marketplace integration off the roommate group (the checklist shopping split itself shipped in stage 2.75 as `checklist_items.assigned_to`).
- Tenant RLS / per-school content (deferred to university #2).
