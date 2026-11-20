import { lazy, type ReactNode } from "react";
import { Route, Navigate, useSearchParams } from "react-router";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { browserConnectionHints, shouldWarmLazyRoutes } from "@/lib/idlePreload";
// Index (housing explore) and ChecklistPage are the two largest pages in the
// repo. Statically imported, they landed in the eager `main` chunk, so EVERY
// user downloaded and parsed both before the app could paint its first frame —
// including on the native shell at cold start, where nothing else is competing
// for that time. Lazy + warmed on idle below is strictly better on both ends:
// the first paint no longer waits on them, and by the time a tab can be tapped
// the chunk is already resident, so navigation is unchanged.
const Index = lazy(() => import("@/pages/app/Index"));
const MapPage = lazy(() => import("@/pages/app/MapPage"));
const ChecklistPage = lazy(() => import("@/pages/app/ChecklistPage"));
const LogisticsPage = lazy(() => import("@/pages/app/LogisticsPage"));
const ShopEssentialsPage = lazy(() => import("@/pages/app/ShopEssentialsPage"));

/**
 * `/checklist` used to be four tabs. Move In / Move Out moved to `/logistics`,
 * and Shop Essentials moved to `/shop` (PRD §5b) - old deep links and bookmarks
 * for all three redirect. Everything else renders the checklist itself.
 */
function ChecklistOrLogisticsRedirect() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab");
  if (tab === "movein" || tab === "moveout") {
    return <Navigate to={`/logistics?tab=${tab}`} replace />;
  }
  if (tab === "explore") {
    return <Navigate to="/shop" replace />;
  }
  return <ChecklistPage />;
}

const BlockedAccountsPage = lazy(() => import("@/pages/app/BlockedAccountsPage"));
const MarketplacePage = lazy(() => import("@/pages/app/Marketplace"));
const MarketplaceMyItemsPage = lazy(() => import("@/pages/app/MarketplaceMyItems"));
const MarketplaceEditPage = lazy(() => import("@/pages/app/MarketplaceEdit"));
const MarketplaceCreatePage = lazy(() => import("@/pages/app/MarketplaceCreate"));
/* The sublease map (PRD §5 Phase 2). Deliberately NOT added to the idle-warm
   lists below: it is not a bottom-nav destination and it drags mapbox-gl, the
   heaviest chunk in the app — warming it would make every student pay for a
   surface most of them will not open. */
const SubleasesPage = lazy(() => import("@/pages/app/SubleasesPage"));
const RoommatePage = lazy(() => import("@/pages/app/RoommatePage"));
const RoommatesLikedPage = lazy(() => import("@/pages/app/RoommatesLikedPage"));
const RoommatesSavedPostsPage = lazy(() => import("@/pages/app/RoommatesSavedPostsPage"));
const RankingInvitePage = lazy(() => import("@/pages/app/RankingInvitePage"));
const RoommateHubPage = lazy(() => import("@/pages/app/RoommateHubPage"));
const RoommateInvitePage = lazy(() => import("@/pages/app/RoommateInvitePage"));
const MessagesPage = lazy(() => import("@/pages/app/MessagesPage"));
const CommunityPage = lazy(() => import("@/pages/app/CommunityPage"));
const HousingDetailPage = lazy(() => import("@/pages/app/HousingDetailPage"));
const RoomGalleryPage = lazy(() => import("@/pages/app/RoomGalleryPage"));
const ProfilePage = lazy(() => import("@/pages/app/ProfilePage"));
const SettingsPage = lazy(() => import("@/pages/app/SettingsPage"));
const MyHomePage = lazy(() => import("@/pages/app/MyHomePage"));
const DormHubPage = lazy(() => import("@/pages/app/DormHubPage"));
const NotificationsPage = lazy(() => import("@/pages/app/NotificationsPage"));
const SchedulePage = lazy(() => import("@/pages/app/SchedulePage"));
const CampusLivePage = lazy(() => import("@/pages/app/CampusLivePage"));
/* No SafetyCenterPage route: the standalone /safety page was removed 2026-08-05
   (vault `Reviews Subleases Services PRD.md` §5b). The CONTENT stayed -
   `SafetyCenterContent` is rendered inline by SettingsView as the Support doc,
   reachable at SAFETY_CENTER_PATH. */

/**
 * Warm the lazy chunks for the bottom-nav destinations once the browser is
 * idle, so tapping a tab doesn't pay a chunk download before the page can
 * mount. Data still fetches on mount; this removes only the JS waterfall.
 * Expensive, low-frequency map routes are intentionally excluded. Browsers
 * that report data saver or a 2G-class connection skip all background warming.
 */
if (typeof window !== "undefined" && shouldWarmLazyRoutes(browserConnectionHints())) {
  const idle: (cb: () => void) => void =
    "requestIdleCallback" in window
      ? (cb) => window.requestIdleCallback(cb, { timeout: 5000 })
      : (cb) => window.setTimeout(cb, 3000);
  idle(() => {
    // Checklist and Index lead: they are tab-bar destinations AND the two
    // heaviest page chunks, so they need the longest head start.
    void import("@/pages/app/ChecklistPage").catch(() => {});
    void import("@/pages/app/Index").catch(() => {});
    void import("@/pages/app/MyHomePage").catch(() => {});
    void import("@/pages/app/Marketplace").catch(() => {});
    void import("@/pages/app/MessagesPage").catch(() => {});
    void import("@/pages/app/CommunityPage").catch(() => {});
    // Second idle pass: the screens reached one tap PAST a nav tab. They are
    // not on the tab bar, so the first pass rightly skips them, but each one is
    // a near-certain destination in a normal session and a cold chunk on the
    // tap that opens it. Chained behind the first idle callback rather than
    // added to it, so the tab-bar chunks always win the bandwidth race.
    idle(() => {
      void import("@/pages/app/HousingDetailPage").catch(() => {});
      void import("@/pages/app/ProfilePage").catch(() => {});
      void import("@/pages/app/NotificationsPage").catch(() => {});
      void import("@/pages/app/SettingsPage").catch(() => {});
      void import("@/pages/app/DormHubPage").catch(() => {});
    });
  });
}

type GatedFn = (show: boolean, realEl: ReactNode, title: string) => ReactNode;

/**
 * User App zone routes, students (auth, `@pitt.edu`). Ships to native.
 *
 * Every route here renders student data (listings, public profiles, checklist,
 * roommates, housing), so all of them require sign-in. `ProtectedRoute`
 * redirects logged-out visitors to `/auth?redirect=…`; nothing student-facing
 * is reachable while signed out.
 *
 * Phase-1 feature gating is unchanged: the `gated` helper and the resolved
 * `show*` flags are passed in from the composing component so `useFeatureFlags`
 * is called once, at the same point in the tree as before. `authGated` layers
 * auth *before* the feature gate, so the flag only ever decides real page vs
 * `ComingSoon` for users who are already signed in.
 */
export function AppRoutes({
  showHousing,
  showMap,
  showRoommates,
  showConfirmedRoommates,
  showRankings,
  showBrowseSublease,
  gated,
}: {
  showHousing: boolean;
  showMap: boolean;
  showRoommates: boolean;
  showConfirmedRoommates: boolean;
  showRankings: boolean;
  showBrowseSublease: boolean;
  gated: GatedFn;
}) {
  // Auth first, then the Phase-1 feature flag. A logged-out visitor is bounced
  // to /auth regardless of the flag (no student data, and no ComingSoon leak);
  // a signed-in user sees the real page or ComingSoon per the flag as before.
  const authGated = (show: boolean, realEl: ReactNode, title: string): ReactNode => (
    <ProtectedRoute>{gated(show, realEl, title)}</ProtectedRoute>
  );

  return (
    <>
      <Route path="/my-home" element={<ProtectedRoute><MyHomePage /></ProtectedRoute>} />
      <Route path="/my-home/dorm" element={<ProtectedRoute><DormHubPage /></ProtectedRoute>} />
      <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
      <Route path="/campus/:dormSlug" element={authGated(showHousing, <Index />, "Housing")} />
      <Route path="/campus" element={authGated(showHousing, <Index />, "Housing")} />
      <Route path="/map" element={authGated(showMap, <MapPage />, "Campus Map")} />
      <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
      {/* Editing is inline on /profile now; keep the deep-linked path working */}
      <Route path="/profile/edit" element={<Navigate to="/profile" replace />} />
      <Route path="/profile/blocked" element={<ProtectedRoute><BlockedAccountsPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      {/* /account was a second, parallel settings menu that cross-linked with
          /settings and caused a back-navigation loop. Consolidated: the avatar now
          opens /settings, and this path redirects so old links/bookmarks still land. */}
      <Route path="/account" element={<Navigate to="/settings" replace />} />
      {/* App Store 5.1.1(v): browsing the Student Market (the feed AND listing
          detail, which opens as a modal on this same route via ?listing=<id>)
          must not require an account. The account-based actions inside it
          (message seller, save, report, post) prompt for sign-in instead.
          Reads for a signed-out visitor come from the `marketplace_public`
          view — the base table stays anon-REVOKEd to protect seller PII. */}
      <Route path="/marketplace" element={<MarketplacePage />} />
      <Route path="/marketplace/create" element={<ProtectedRoute><MarketplaceCreatePage /></ProtectedRoute>} />
      <Route path="/marketplace/my-items" element={<ProtectedRoute><MarketplaceMyItemsPage /></ProtectedRoute>} />
      <Route path="/marketplace/edit/:id" element={<ProtectedRoute><MarketplaceEditPage /></ProtectedRoute>} />
      {/* The sublease map. `showBrowseSublease` is the ONLY gate, on purpose:
          browsing is open to every tenant and, since 2026-08-18, on native too
          (Ethan's override of the 2026-08-05 clamp). The App Store exposure that
          clamp existed for is unchanged — what still cannot reach a binary is the
          rental-listing COMPOSER, and `showPostSublease` in useFeatureFlags.ts is
          the single place that says so. A second native check here would be a
          second thing to keep in sync and a second thing to miss. */}
      <Route path="/subleases" element={authGated(showBrowseSublease, <SubleasesPage />, "Subleases")} />
      <Route path="/subleases/create" element={authGated(showBrowseSublease, <MarketplaceCreatePage />, "Subleases")} />
      <Route path="/subleases/edit/:id" element={authGated(showBrowseSublease, <MarketplaceEditPage />, "Subleases")} />
      <Route path="/roommates" element={authGated(showRoommates, <RoommatePage />, "Roommates")} />
      <Route path="/roommates/liked" element={authGated(showRoommates, <RoommatesLikedPage />, "Roommates")} />
      <Route path="/roommates/saved-posts" element={authGated(showRoommates, <RoommatesSavedPostsPage />, "Roommates")} />
      <Route path="/rankings/invite/:code" element={authGated(showRankings, <RankingInvitePage />, "Dorm Rankings")} />
      {/* Roommate Hub: the confirmed-group home. Phase-1 reachable - rides
          showConfirmedRoommates (true under Phase 1), NOT the discovery flag. */}
      <Route path="/roommates/us" element={authGated(showConfirmedRoommates, <RoommateHubPage />, "Roommates")} />
      {/* Shareable roommate-group invite: Phase-1 reachable (auth only, no feature flag). */}
      <Route path="/roommates/invite/:code" element={<ProtectedRoute><RoommateInvitePage /></ProtectedRoute>} />
      <Route path="/messages" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
      {/* Community: building + floor rooms for the resident's own building.
          Phase-1 reachable (auth only) - building chats already ship in Phase 1. */}
      <Route path="/community" element={<ProtectedRoute><CommunityPage /></ProtectedRoute>} />
      <Route path="/housing" element={authGated(showHousing, <Index />, "Housing")} />
      <Route path="/housing/:slug" element={authGated(showHousing, <HousingDetailPage />, "Housing")} />
      <Route path="/gallery" element={authGated(showHousing, <RoomGalleryPage />, "Room Photos")} />
      <Route path="/guide" element={<Navigate to="/checklist" replace />} />
      <Route path="/checklist" element={<ProtectedRoute><ChecklistOrLogisticsRedirect /></ProtectedRoute>} />
      <Route path="/logistics" element={<ProtectedRoute><LogisticsPage /></ProtectedRoute>} />
      <Route path="/shop" element={<ProtectedRoute><ShopEssentialsPage /></ProtectedRoute>} />
      <Route path="/schedule" element={<ProtectedRoute><SchedulePage /></ProtectedRoute>} />
      <Route path="/campus-live" element={<ProtectedRoute><CampusLivePage /></ProtectedRoute>} />
    </>
  );
}
