/**
 * Feature toggles - keep related UI gated in one place for easy re-enable.
 * Student Businesses: marketplace tab, mega-menu, mobile sheet, my-items tabs.
 */
export const SHOW_STUDENT_BUSINESSES = false;

/**
 * Master surface gate. When true, the app runs a reduced surface set and the
 * engagement surfaces below are off unless a per-surface flag is overridden
 * individually. Set to false to restore the full product.
 *
 * Renamed from `PHASE_1_ONLY` on 2026-08-05. The old name described *why* the
 * surfaces were off — a staged rollout for an institutional pilot. That pilot
 * no longer exists, so the name had become a lie about the reason. What the
 * flag actually does now is unchanged: it selects a surface set for a product
 * with no institutional partner, where Roommates, Map, Rankings, Group Chats
 * and Saved Dorms are engagement features that need a userbase we do not have
 * yet. Housing is deliberately NOT in that set any more — it is restored
 * per-tenant via `features: { showHousing: true }` so dorm reviews are
 * reachable (vault `Reviews Subleases Services PRD.md` §5b).
 */
export const LIMITED_SURFACES = true;

// Gated surfaces. Derived from the master flag; can be overridden individually.
export const SHOW_HOUSING = !LIMITED_SURFACES; // dorm explore, /campus, /housing, /gallery, dorm detail, reviews
export const SHOW_ROOMMATES = !LIMITED_SURFACES; // /roommates*, finding posts, liked/saved

/**
 * Marketplace post types (vault `Reviews Subleases Services PRD.md` §5 Phase 2).
 * One post flow and one feed serve every type; these are the global defaults a
 * university can override individually via `universities.feature_flags`.
 *
 * Deliberately NOT derived from LIMITED_SURFACES: the marketplace is inside the
 * reduced surface set, so items are on for everyone. The other three are the machinery
 * landing ahead of the types themselves — they stay off until their schema,
 * their card and (for the service types) the discriminator column exist.
 */
export const SHOW_POST_ITEM = true;
export const SHOW_POST_SUBLEASE = true;
export const SHOW_POST_REQUEST_HELP = true;
export const SHOW_POST_OFFER_HELP = true;

/**
 * Cross-school REMOTE services (tutoring, resume review, design, editing).
 *
 * OFF, and it is a legal gate rather than a readiness one. The published
 * Privacy §5 (`src/pages/marketing/Privacy.tsx`, verified 2026-08-16) discloses
 * exactly one cross-school audience: "Verified students at partner schools IN
 * YOUR AREA ... a shared LOCAL marketplace". That sentence covers the
 * `marketplace_group` mechanism, and so covers LOCAL categories at group range.
 * It does not describe a nationwide any-school surface, which is what a REMOTE
 * category becomes once its reach passes the group.
 *
 * Turning this on is a three-part change, in this order: rewrite Privacy §5,
 * send the material-change notice Privacy §11 commits us to, then set
 * `universities.remote_services_open` on the participating schools. Flipping
 * this constant alone widens nothing — the DB column is the real gate and
 * defaults false (migration 20260924000000).
 */
export const SHOW_REMOTE_SERVICES = false;

/**
 * My Schedule (`/schedule`, SchedulePage). Restored 2026-08-26 after the
 * 2026-08-17 retirement: the surface is live again for every school.
 *
 * Deliberately NOT derived from LIMITED_SURFACES — Schedule is a live surface
 * inside the reduced set, so deriving it would switch it off for Pitt
 * (limitedSurfaces: true) at the moment we are trying to ship it everywhere.
 *
 * A university can still take the nav entries back off via
 * `universities.feature_flags` (`{"showSchedule": false}`) without a deploy;
 * the route stays reachable by direct link either way.
 */
export const SHOW_SCHEDULE = true;

/**
 * Campus Live (`/campus-live`): laundry, dining and registrar dates read from a
 * school's own public feeds, populated by the api/cron/campus-* ingests.
 *
 * Deliberately NOT derived from LIMITED_SURFACES — this is information density
 * for the reduced surface set, not an engagement feature, so it belongs to the
 * set Pitt sees today. It is empty for any school without a configured source in
 * `campus_data_sources`, which is why a tenant can also take it off outright via
 * `universities.feature_flags` (`{"showCampusLive": false}`) without a deploy.
 */
export const SHOW_CAMPUS_LIVE = true;

/**
 * Confirmed roommate groups (invite/accept + checklist integration) graduate into
 * the always-on surface set; roommate *browsing* stays behind SHOW_ROOMMATES.
 */
export const SHOW_CONFIRMED_ROOMMATES = true;

/**
 * Building and floor chats are always on (the Your Dorm hub's Community
 * tab); general group chats stay behind showGroupChats.
 */
export const SHOW_BUILDING_CHATS = true;

/**
 * i18n language picker in Settings > Appearance. On now that Chinese (zh) is
 * fully translated (Phases 1-8). Only languages flagged `enabled` in
 * src/i18n/languages.ts appear in the picker, so demo/incomplete locales still
 * never reach students even with this on.
 */
export const I18N_LANGUAGE_PICKER = true;

/* SHOW_LANDING_TESTIMONIALS removed 2026-08-02 along with the section it gated.
   A flag is the wrong tool for fabricated content: it kept three invented students
   in the bundle and in the repo, one boolean from shipping. Real quotes will not
   need a flag. */

/**
 * Liquid-glass bottom-nav experiment (handoffs 2026-07-16/17). Material model:
 * the BAR is lightly frosted (`.glass-chrome`, always on); the moving PILL is
 * the glass. Flag-on adds the gated extras: a CLEAR pill (near-transparent
 * fill + bright rim + specular + slight backdrop blur; the frosted-white
 * fill is flag-off only) and DRAG-TO-SWITCH
 * (drag the pill along the row - it expands + magnifies icons it passes, then
 * soft-lands on the nearest tab and navigates; taps still work).
 *
 * Why no true background refraction: `backdrop-filter: url()` is
 * Chromium-only, and the Safari copy-and-displace path (evaluated
 * @samasante/liquid-glass, MIT, zero-dep) needs an explicit DOM copy of the
 * backdrop - not viable over live scrolled pages + the Mapbox canvas
 * (canvases clone blank). The lens magnify is therefore scale + specular, the
 * cheap approximation; a moving feDisplacementMap lens would be the first
 * thing dropped for perf anyway.
 *
 * Enabled for everyone 2026-07-16. Flag kept as the kill switch: flip to
 * false to fall back to the frosted bar + glassy tap-to-slide pill with no
 * drag (e.g. if real-device perf regresses on Housing mount + scroll +
 * drag-slide).
 */
export const LIQUID_GLASS_NAV = true;
