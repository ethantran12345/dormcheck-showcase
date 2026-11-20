import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, createContext, useContext, type ReactNode } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route, Navigate, useLocation, useNavigate, useSearchParams, Outlet, type Location } from "react-router";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { enforceUniversityEmailOrSignOut } from "@/lib/universityAuth";
import { resolveUniversityByEmail } from "@/config/universities";
import { getPostLoginRedirect } from "@/lib/authRedirects";
import { universalLinkToPath } from "@/lib/deepLinks";
import {
  clearAppBadge,
  consumePendingPushRoute,
  isSafePushRoute,
  PUSH_NAV_EVENT,
  PUSH_FOREGROUND_EVENT,
} from "@/lib/pushNotifications";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { ScrollToTop } from "@/components/ScrollToTop";
import { PageTransition } from "@/components/motion/PageTransition";
import { ViewTransitionBrowserRouter } from "@/components/motion/ViewTransitionRouter";
import { RouteSkeleton } from "@/components/skeletons/RouteSkeleton";
import { markNavStart, markNavReady } from "@/lib/navTiming";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { MfaChallengeGate } from "@/components/auth/MfaChallengeGate";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { Loader2 } from "lucide-react";
import NotFound from "./pages/NotFound";
// Public, chrome-less page hosted by the native iMessage extension's WKWebView.
const IMessageSharePage = lazy(() => import("@/pages/IMessageSharePage"));
const SharedChecklistPage = lazy(() => import("@/pages/SharedChecklistPage"));
// Rendered as a modal sheet OVER the previous page on mobile (see RoutedApp).
const SettingsSheetPage = lazy(() => import("@/pages/app/SettingsPage"));
// Same treatment: on mobile the Post-an-Item composer is a tall sheet over the
// marketplace, not a route that replaces it. Desktop keeps it as a full page
// (the AppRoutes entry), so both mount the same lazy chunk.
const MarketplaceCreateSheetPage = lazy(() => import("@/pages/app/MarketplaceCreate"));

// DEV-ONLY landing fan-out (`/__variants`). The ternary is what keeps it out of
// production: Vite substitutes a literal `false` for `import.meta.env.DEV` in a
// prod build, so Rollup drops the dead branch AND the dynamic import inside it,
// taking the whole variants graph with it. Gating only the <Route> would not be
// enough — a top-level `lazy(() => import(...))` is still a live reference, so
// the chunk would be emitted and shipped even though nothing could route to it.
// Verified on every build by `npm run guard:dev-only`
// (scripts/check-dev-only-excluded.mjs, blocking in dev-push CI and lane:ship):
// it scans dist/ for the route literal, TweaksPanel, the variant registry's own
// copy, and per-variant chunk filenames, and fails naming what it found.
const VariantsGallery = import.meta.env.DEV
  ? lazy(() => import("@/pages/dev/VariantsPage"))
  : null;
const VariantSolo = import.meta.env.DEV
  ? lazy(() => import("@/pages/dev/VariantsPage").then((m) => ({ default: m.VariantSolo })))
  : null;

// DEV-ONLY design tweak panel — same dead-branch shape as the variants routes
// above, for the same reason: gating only the render site would leave a live
// `lazy()` reference and ship the chunk. Vite substitutes a literal `false` for
// import.meta.env.DEV in a prod build, so Rollup drops the branch, the dynamic
// import, and the whole src/dev/tweaks graph with it.
// VITE_DISABLE_TWEAKS: the floating trigger sits fixed bottom-right at z-[60]
// and intercepts pointer events aimed at controls underneath it (message Send,
// composer Post) — which breaks the Playwright e2e suite, whose dev server is
// the one consumer that never wants the panel. Same env-flag shape as
// VITE_E2E_AUTOLOGIN; unset in normal dev, so nothing changes for humans.
// Browser-only: on the native shell (iOS/Android live-reload) the same fixed
// trigger lands on top of BottomNav and there's no cheap way to move it out of
// the thumb zone, so the panel is a desktop/browser dev tool only.
// Temporarily off by default (2026-08-04, Ethan) — flip TWEAKS_ENABLED back to
// true to bring the floating trigger back.
const TWEAKS_ENABLED = false;

const TweaksPanel =
  TWEAKS_ENABLED &&
  import.meta.env.DEV &&
  import.meta.env.VITE_DISABLE_TWEAKS !== "1" &&
  !Capacitor.isNativePlatform()
    ? lazy(() => import("@/dev/tweaks/TweaksPanel"))
    : null;

/**
 * Where the previous page should be assumed to be when a mobile sheet route is
 * opened cold (deep link) with no tracked history — so there's always a page
 * behind the dimmed sheet instead of a black void. Per sheet, because the
 * plausible "page you came from" differs: Settings is reached from anywhere,
 * the composer only ever from the marketplace.
 */
const SETTINGS_FALLBACK_BG: Location = {
  pathname: "/my-home",
  search: "",
  hash: "",
  state: null,
  key: "settings-bg",
};
const POST_COMPOSER_FALLBACK_BG: Location = {
  pathname: "/marketplace",
  search: "?tab=buy-sell",
  hash: "",
  state: null,
  key: "composer-bg",
};

/**
 * Overrides the location the app chrome (LayoutWrapper) reflects. While the
 * mobile Settings sheet is open the real URL is `/settings`, but we want the top
 * bar / sidebar and the background `<Routes>` to keep rendering the page the
 * sheet opened OVER, so it stays mounted and visible behind the dimmed sheet
 * (Mercury/Bevel-style modal-over-page). `null` = no override → use the real
 * location. (Components rendered INSIDE the background `<Routes location>` get
 * this for free via React Router; this context is for the chrome above it.)
 */
const EffectiveLocationContext = createContext<Location | null>(null);
function useEffectiveLocation(): Location {
  const override = useContext(EffectiveLocationContext);
  const real = useLocation();
  return override ?? real;
}
import { MarketingRoutes, LandingRoute } from "@/routes/MarketingRoutes";
import { LegalRoutes } from "@/routes/LegalRoutes";
import { isLegalPath } from "@/routes/legalPaths";
import { isGuestBrowsablePath } from "@/routes/guestPaths";
import { isMarketingPath } from "@/routes/marketingPaths";
import { AuthRoutes } from "@/routes/AuthRoutes";
import { AppRoutes } from "@/routes/AppRoutes";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoutes } from "@/routes/AdminRoutes";
import { AdvertiserRoutes } from "@/routes/AdvertiserRoutes";
// Lazy on purpose. A static import made ChatWidget -> ChatPanel ->
// MessagePreviewCard the eager root of the entire messaging surface (roommate
// detail + profile form + photo editor + business/listing modals + the DM
// realtime hook, ~470 KB of chunks), so the signed-out landing page and
// /waitlist downloaded all of it before first paint to render a widget that is
// invisible until you open it. `fallback={null}` matches what the closed widget
// paints anyway.
const ChatWidget = lazy(() =>
  import("@/components/ChatWidget").then((m) => ({ default: m.ChatWidget })),
);
import { ChatProvider, useChat } from "@/contexts/ChatContext";
import { SetupModeProvider } from "@/contexts/SetupModeContext";
import { AdminPreviewProvider } from "@/contexts/AdminPreviewContext";
import { AdminUniversitySiloProvider } from "@/contexts/AdminUniversityContext";
import { UniversityProvider } from "@/contexts/UniversityContext";
import { NavShellProvider, useSidebarCollapsedState } from "@/contexts/NavShellContext";
import { GlobalSearchProvider } from "@/contexts/GlobalSearchContext";
import { ModalOverlayProvider } from "@/contexts/ModalOverlayContext";
import { CollaborationProvider } from "@/contexts/CollaborationContext";
import { ScrollEngagementProvider } from "@/contexts/ScrollEngagementContext";
import Footer from "@/components/Footer";
import { GlobalTopNav } from "@/components/GlobalTopNav";
import { MarketingTopNav } from "@/components/marketing/MarketingTopNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { AppSidebar } from "@/components/app/AppSidebar";
import { AppShellTopRight } from "@/components/app/AppShellTopRight";
import { HAD_PERSISTED_SESSION_AT_BOOT } from "@/lib/sessionHint";
import { FeatureTour } from "@/components/tour/FeatureTour";
import { ViewAsBanner } from "@/components/admin/ViewAsBanner";
import { FeedbackSupportModal } from "@/components/FeedbackSupportModal";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { BottomNav } from "@/components/BottomNav";
import { NativeTopBar } from "@/components/NativeTopBar";
import {
  NATIVE_GLASS_TAB_PRESS_EVENT,
  syncNativeGlassTabBar,
  type NativeGlassTabId,
  usesNativeGlassTabBar,
} from "@/lib/nativeGlassTabBar";
import { useModalOverlay } from "@/contexts/ModalOverlayContext";
import { HousingSavedProvider } from "@/contexts/HousingSavedContext";
import {
  clearExploreViewportLockStyles,
  isLockMobileExploreViewport,
} from "@/lib/exploreViewportLock";
import { ComingSoon } from "@/components/ComingSoon";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { AccessibilityProvider, useAccessibility } from "@/contexts/AccessibilityContext";
import { motionConfigMode } from "@/lib/accessibility";
import { BookmarksProvider } from "@/contexts/BookmarksContext";
import { MotionConfig } from "framer-motion";
import { ErrorBoundary } from "@/components/ErrorBoundary";

/**
 * Renders nothing; exists only to report that the route's element has committed.
 * It sits INSIDE the route Suspense boundary, so React cannot mount it until the
 * lazy chunk has resolved — which makes its mount the honest "the page is here"
 * signal. See `src/lib/navTiming.ts` for what the number does and does not cover.
 */
function NavTimingSentinel({ pathname }: { pathname: string }) {
  useEffect(() => {
    markNavReady(pathname);
  }, [pathname]);
  return null;
}

function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

/**
 * Mount ChatWidget on `/` and `/auth*` when closed; when open, mount so header chat works.
 * Floating bottom-right launcher is disabled everywhere - open messages from the top nav icon.
 */
function ChatWidgetGate() {
  const { pathname } = useLocation();
  const { isOpen } = useChat();

  if (pathname.startsWith("/messages")) return null;

  const hideWidgetWhenClosed =
    pathname.startsWith("/housing") ||
    pathname.startsWith("/campus") ||
    pathname.startsWith("/roommates") ||
    pathname.startsWith("/marketplace") ||
    pathname.startsWith("/checklist") ||
    pathname.startsWith("/logistics") ||
    pathname.startsWith("/gallery") ||
    pathname.startsWith("/profile");

  if (!isOpen) {
    if (hideWidgetWhenClosed) return null;
    if (pathname !== "/" && !pathname.startsWith("/auth")) return null;
  }

  return (
    <Suspense fallback={null}>
      <ChatWidget hideFloatingLauncher />
    </Suspense>
  );
}

/** Clears stale Index explore scroll lock when route is outside mobile explore lock. */
function ExploreViewportLockGuard() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const search = searchParams.toString();

  useLayoutEffect(() => {
    const locked = isLockMobileExploreViewport(pathname, searchParams, isMobile, 'layout');
    if (!locked) {
      clearExploreViewportLockStyles();
    }
  }, [pathname, search, isMobile, searchParams]);

  return null;
}

function LayoutWrapper({
  children,
  onOpenSupportModal,
}: {
  children: React.ReactNode;
  onOpenSupportModal?: () => void;
}) {
  // Effective (not raw) location: while the mobile Settings sheet is open the
  // chrome should keep reflecting the page behind it, not `/settings`.
  const location = useEffectiveLocation();
  const [searchParams] = useSearchParams();
  const pathname = location.pathname;
  const isMobile = useIsMobile();

  const isAuthPage = pathname.startsWith("/auth") || pathname.startsWith("/select-school");
  const isOnboardingPage = pathname.startsWith("/onboarding");
  // Pages that render with no app chrome (top nav, sidebar, footer), ever:
  // /imessage lives inside the native iMessage extension's small WKWebView,
  // and /checklist/shared/:token is the public family share view (token-scoped
  // guest page that renders its own header).
  const isBareChromePage =
    pathname.startsWith("/imessage") || pathname.startsWith("/checklist/shared/");
  // The Post-an-Item composer is a Facebook-style full-page takeover: no app
  // sidebar, no top padding, and no top-right pill nav — the page owns the whole
  // screen and offers a single X to leave. (Native hides its own top pill from
  // inside the page via ModalOverlay's hideTopNav.)
  const isPostComposerRoute = pathname === "/marketplace/create";
  // Admin console owns its own chrome (AdminLayout sidebar): no top nav,
  // app sidebar, footer, or top-bar padding on /admin* routes.
  const isAdminRoute = pathname.startsWith("/admin");
  // Advertiser zone (P1.10) owns its chrome like /admin.
  const isAdvertiserRoute = pathname.startsWith("/advertise");

  const isMapPage = pathname === "/map";
  const isCampusProfile = pathname === "/campus" && searchParams.get("tab") === "profile";
  // The sublease map. Same immersive shape as /map — a full-bleed canvas with a
  // drag-up sheet — so it needs the same three things this predicate grants: a
  // `h-[100dvh] overflow-hidden` shell, `overflow-hidden` on <main>, and no page
  // footer under a fixed viewport. Note this branch is NOT mobile-only, unlike
  // `lockMobileExploreViewport` below: without it the page's `h-full` resolves
  // against a `min-h-screen` shell with no definite height and the map renders
  // 0px tall on desktop (measured at 1440×900 on 2026-08-17).
  const isSubleaseMap = pathname === "/subleases";
  const isCampusExplore =
    ((pathname === "/campus" || pathname.startsWith("/campus/")) && !isCampusProfile) ||
    pathname === "/map" ||
    isSubleaseMap ||
    pathname === "/housing";
  const isExploreHousing = isCampusExplore;
  const isDormDetailsRoute = pathname.startsWith("/housing/");
  // Dorm detail inside Explore: /campus/:slug (legacy ?dorm= redirects to slug)
  const isDormDetailsInExplore =
    pathname.startsWith("/campus/") && pathname.split("/").filter(Boolean).length >= 2;
  const shouldLockExploreViewport = isExploreHousing && !(isDormDetailsRoute || isDormDetailsInExplore);
  /** Mobile map+sheet explore: pin layout to viewport (body safe-area padding otherwise allows page scroll). */
  const lockMobileExploreViewport = isLockMobileExploreViewport(pathname, searchParams, isMobile, "layout");

  const isMapImmersive = isMapPage;

  const isMessagesRoute = pathname.startsWith("/messages");
  // Community reuses the same GroupChatPanel chat surface as Messages, so it needs
  // the same fixed-viewport shell (no page scroll) - otherwise the open-room view's
  // full-height panel overflows the scrolling shell and its pinned composer falls
  // below the fold. The page then owns its own internal scroll.
  const isCommunityRoute = pathname.startsWith("/community");
  const isChatShellRoute = isMessagesRoute || isCommunityRoute;
  // On /settings the sidebar force-expands into the settings sub-nav, so the
  // content offset must be the full width even when the collapse pref is set.
  const isSettingsRoute = pathname.startsWith("/settings");
  const isProfileRoute = pathname === "/profile";
  const isNative = Capacitor.isNativePlatform();
  const { user, isLoading: authLoading } = useAuth();

  // `user` is null until supabase.auth.getSession() resolves a tick after mount,
  // so a signed-in user's FIRST frame would otherwise be the marketing tree —
  // MarketingTopNav's in-flow h-[84px] spacer, and a <main> without pt-12 or
  // md:pl-[220px]. Swapping to the app shell (whose chrome is all position:fixed,
  // i.e. zero layout space) then snaps <main> up and left: the audit crawl
  // measured main at dy -80 / dx 220, ~0.1699 CLS, on nearly every authed route.
  // Reading the persisted session synchronously lets the shell START in the shape
  // it is about to settle into, so the box is correct on frame one rather than
  // the chrome being deferred. Layout only — real access still gates on `user`.
  const layoutAuthed = !!user || (authLoading && HAD_PERSISTED_SESSION_AT_BOOT);

  // `/` is a marketing route only for a visitor who will actually SEE the
  // landing. A browser that already holds a session is redirected to /my-home by
  // LandingRoute, and MarketingRoutes already stopped painting LandingPage in
  // that case — but `isMarketingChrome` below is `(!layoutAuthed || isMarketing)`,
  // so plain `isMarketingPath('/')` kept forcing the marketing CHROME anyway.
  // The result was the other half of the same defect: one frame of a <main> with
  // neither `pt-12` nor `md:pl-[220px]`, then the app shell landing across the
  // redirect and shoving the content frame 220px right and 48px down. That is
  // the `div.relative.flex.min-h-0.w-full … moved 220,48px` entry the audit
  // crawl scored at 0.1512 on `/`. Excluding only `/` keeps every other
  // marketing page (/about, /features, …) on marketing chrome for signed-in
  // users, which is deliberate — those are reachable in-product and do not
  // redirect. Anonymous visitors are untouched: `layoutAuthed` is false for them.
  //
  // THIS CLAUSE IS PATH-SPECIFIC ON PURPOSE, and that is also its limit: `/` is
  // the only entry in MARKETING_PATHS that redirects into the app, and it does so
  // off the session hint, which is exactly what `layoutAuthed` reads. A marketing
  // path that redirected UNCONDITIONALLY would not be covered — `layoutAuthed` is
  // false for the anonymous visitor, so no variation of this guard would see it —
  // and it would need the same one-frame chrome swap fixed a different way.
  // /dorms was that case (b58fcdf0). It is not any more: the page was deleted and
  // old links redirect at the edge in `vercel.json`, so the SPA never mounts
  // there. Keep the rule, not a registry: a marketing path that should land in the
  // app belongs in `vercel.json` redirects, not in a client-side <Navigate>.
  const isMarketing = isMarketingPath(pathname) && !(pathname === "/" && layoutAuthed);
  // Web chrome splits on route + auth (spec §1): the marketing zone (`/`, /about,
  // /features, …) gets the marketing nav. A signed-in web user never lands on `/`
  // (LandingRoute redirects to /my-home) but can still reach the other marketing
  // pages via in-product links, where they keep the marketing nav. Logged-out
  // web gets the marketing nav everywhere. Signed-in web on an app route keeps the
  // app nav (→ sidebar below). Native is untouched - GlobalTopNav returns null there
  // and AppLayout owns NativeTopBar/BottomNav.
  const isMarketingChrome =
    !isNative && !isAuthPage && !isOnboardingPage && !isBareChromePage && (!layoutAuthed || isMarketing);
  // Signed-in web on a non-marketing route gets the sidebar shell (spec §3), gated
  // via CSS at `md+` (768px) so it hands off cleanly from `BottomNav` (which hides at
  // `md`), so there is no dead gap where neither nav shows. AppSidebar is `hidden
  // md:flex`, content is padded `md:pl-[220px]`, and the app footer hides at `md`.
  // Below 768px, mobile web keeps BottomNav; native is untouched (this is `!isNative`).
  // Excludes marketing paths so the sidebar never overlays the landing.
  const isAppShell =
    !isNative && layoutAuthed && !isAuthPage && !isOnboardingPage && !isBareChromePage && !isMarketing && !isAdminRoute && !isAdvertiserRoute;
  // Sidebar collapse (icon rail) preference - persisted; drives the content offset
  // below and is shared via NavShellProvider to the sidebar + in-page pill bars.
  const [sidebarCollapsed, setSidebarCollapsed] = useSidebarCollapsedState();

  // Footer: hide on map, explore housing (split-screen), auth, messages, and campus map (fixed viewport + internal scroll only)
  const showFooter =
    !isNative &&
    !isAuthPage &&
    !isOnboardingPage &&
    !isBareChromePage &&
    !isAdminRoute &&
    !isAdvertiserRoute &&
    !isMessagesRoute &&
    !isCommunityRoute &&
    !isPostComposerRoute &&
    (!isExploreHousing || isDormDetailsInExplore);

  return (
    <NavShellProvider
      isAppShell={isAppShell}
      collapsed={sidebarCollapsed}
      setCollapsed={setSidebarCollapsed}
    >
      <GlobalSearchProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[20000] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-overlay focus:ring-2 focus:ring-malachite-600"
      >
        Skip to main content
      </a>
      <ExploreViewportLockGuard />
    <div className={cn(
      "flex flex-col bg-background text-foreground",
      lockMobileExploreViewport
        ? "fixed inset-0 z-0 max-h-[100dvh] overflow-hidden overscroll-none"
        : shouldLockExploreViewport
          ? "h-[100dvh] overflow-hidden"
          : !(isMessagesRoute && isMobile) && !isCommunityRoute && "min-h-screen",
      isMapImmersive && isMobile && "overflow-hidden",
      isMessagesRoute &&
        (isMobile
          ? "fixed inset-x-0 top-0 bottom-[var(--keyboard-height,0px)] overflow-hidden transition-[bottom] duration-200 ease-ios"
          : "h-[calc(100dvh-env(safe-area-inset-top))] overflow-hidden"),
      isCommunityRoute && "h-[calc(100dvh-env(safe-area-inset-top))] overflow-hidden",
    )}>
      {!isAuthPage && !isOnboardingPage && !isAdminRoute && !isAdvertiserRoute && !isBareChromePage && !isPostComposerRoute && (isMarketingChrome ? <MarketingTopNav /> : <GlobalTopNav />)}
      {isAppShell && !isPostComposerRoute && <AppSidebar />}
      {isAppShell && !isPostComposerRoute && <AppShellTopRight />}
      <main id="main-content" tabIndex={-1} className={cn(
        "flex min-h-0 flex-grow flex-col bg-background outline-none",
        !isAuthPage && !isNative && !isMarketingChrome && !isAdminRoute && !isAdvertiserRoute && !isBareChromePage && !(isMessagesRoute && isMobile) &&
          // Dorm detail pages get a full-bleed hero in the sidebar shell: TopNav is
          // md:hidden there, so the desktop pt-12 is a phantom white strip above the hero.
          (isAppShell && (isDormDetailsRoute || isDormDetailsInExplore) ? "pt-12 md:pt-0" : "pt-12"),
        isAppShell && !isPostComposerRoute && (sidebarCollapsed && !isSettingsRoute ? "md:pl-16" : "md:pl-[220px]"),
        isPostComposerRoute && "!pt-0 md:!pl-0",
        (isMapImmersive && isMobile || shouldLockExploreViewport) && !isProfileRoute && "overflow-hidden",
        lockMobileExploreViewport && "max-h-full overscroll-none",
        isChatShellRoute && "min-h-0 h-full overflow-hidden",
        isProfileRoute && "overflow-y-auto"
      )}>{children}</main>
      {/* The footer renders after <main>, outside AppLayout's bottom-nav
          reservation, yet a signed-in phone still shows the bar on marketing and
          legal pages. Reserve the bar's measured height here too:
          `--dc-bottom-nav-h` is only set while BottomNav is mounted, so logged-out
          and desktop resolve to 0 (md:pb-0 keeps desktop explicit). */}
      {isMarketingChrome ? (
        <div className="pb-[var(--dc-bottom-nav-h,0px)] md:pb-0">
          <MarketingFooter />
        </div>
      ) : (
        showFooter && (
          // In the sidebar shell the sidebar's user chip replaces the footer,
          // so hide it wherever the sidebar shows (md+).
          <div className={cn("pb-[var(--dc-bottom-nav-h,0px)] md:pb-0", isAppShell && "md:hidden")}>
            <Footer onOpenSupportModal={onOpenSupportModal} />
          </div>
        )
      )}
    </div>
      </GlobalSearchProvider>
    </NavShellProvider>
  );
}

/**
 * Synchronizes UIKit's iOS-only glass tab bar with the shared React router.
 * Native code never chooses a route on its own: it emits a tab intent and this
 * gate resolves it through the same route targets the React bar uses.
 */
function NativeGlassTabBarGate({ visible, pathname }: { visible: boolean; pathname: string }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!usesNativeGlassTabBar()) return;

    const onTabPress = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: NativeGlassTabId }>).detail?.tab;
      if (!tab) return;

      switch (tab) {
        case 'home':
          navigate('/my-home');
          break;
        case 'housing': {
          // Match the React bar's familiar return-to-last-place behavior while
          // rejecting a malformed persisted value rather than routing blindly.
          const stored = window.localStorage.getItem('dormcheck_last_housing');
          navigate(stored?.startsWith('/') ? stored : '/campus');
          break;
        }
        case 'checklist':
          navigate('/checklist');
          break;
        case 'marketplace':
          navigate('/marketplace');
          break;
      }
    };

    window.addEventListener(NATIVE_GLASS_TAB_PRESS_EVENT, onTabPress);
    return () => window.removeEventListener(NATIVE_GLASS_TAB_PRESS_EVENT, onTabPress);
  }, [navigate]);

  useEffect(() => {
    syncNativeGlassTabBar({ visible, route: pathname });
  }, [pathname, visible]);

  return null;
}

function AppLayout() {
  const modalOverlay = useModalOverlay();
  const { user, isLoading } = useAuth();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const isNative = Capacitor.isNativePlatform();
  const isAuthRoute = pathname === "/auth" || pathname.startsWith("/auth/") || pathname === "/select-school";
  const hideNativeBottomChrome = isNative && !user;

  // Stamp the navigation start in the render phase rather than an effect: an
  // effect runs after the fallback has already committed, which would silently
  // subtract the most expensive part of the very interval we are measuring.
  // The probe is a no-op unless explicitly enabled, so this costs one ref
  // comparison in production.
  const lastTimedPath = useRef<string | null>(null);
  if (lastTimedPath.current !== pathname) {
    lastTimedPath.current = pathname;
    markNavStart(pathname);
  }

  if (isNative && isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Legal pages (/privacy, /terms) stay reachable in-app even signed out (Apple
  // requirement; linked from the sign-in screen), so they're exempt from the
  // native logged-out → /auth guard.
  if (isNative && !user && !isAuthRoute && !isLegalPath(pathname) && !isGuestBrowsablePath(pathname)) {
    return <Navigate to="/auth" replace />;
  }

  const isMessagesRoute = pathname.startsWith("/messages");
  // "Leaf" pages: pushed utility/detail screens reached from a tab, each with its
  // own back affordance (Messages' header, or <LeafPageBackButton> on the rest).
  // The bottom tab bar is redundant here, so we drop it (and the space it reserves)
  // - matching the native pattern where a pushed screen hides the tab bar.
  const isLeafRoute =
    isMessagesRoute ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/account");
  // Dorm-detail pages are immersive: a full-bleed hero photo with its own back +
  // save controls. The global floating pill would overlap the save button and a
  // top offset would leave a white gap above the photo, so we drop the pill here
  // (matching the listing-detail pattern in most apps) and let the hero go flush.
  const isDormDetailRoute =
    pathname.startsWith("/housing/") ||
    (pathname.startsWith("/campus/") &&
      pathname.split("/").filter(Boolean).length >= 2);
  // These routes render their own title as scrolling page content (it sits high near
  // the pill and scrolls away, like Home) instead of a fixed top-bar title - so they
  // own their top spacing and skip the global top-bar offset.
  const isMyHomeRoute = pathname === "/my-home";
  const isScrollAwayTitleRoute =
    isMyHomeRoute ||
    pathname === "/checklist" ||
    pathname.startsWith("/logistics") ||
    pathname.startsWith("/marketplace") ||
    pathname.startsWith("/roommates");
  // /account owns its top spacing too: it pins its own back arrow into the
  // top-bar pill's row (see AccountPage), so it must skip the shell's flat
  // pt-12 offset or the arrow floats below the pill with a white gap above.
  const isAccountRoute = pathname.startsWith("/account");
  const navHidden = modalOverlay?.hideBottomNav ?? false;
  // Messaging is full-screen with its own headers (Instagram-style) - no global pill.
  const showNativeTopBar =
    isNative &&
    !!user &&
    !isAuthRoute &&
    !pathname.startsWith("/onboarding") &&
    !isMessagesRoute &&
    !isDormDetailRoute;
  // BottomNav is app chrome - signed-in users only. Logged-out web is the
  // marketing zone (no app tabs), and native logged-out is already redirected
  // to /auth above. It stays md:hidden, so this only affects mobile/native.
  const showBottomNav =
    !!user &&
    !isAuthRoute &&
    !pathname.startsWith("/onboarding") &&
    !pathname.startsWith("/admin") &&
    !isLeafRoute;
  const lockMobileExploreViewport = isLockMobileExploreViewport(
    pathname,
    searchParams,
    isMobile,
    "app",
  );
  return (
    <ScrollEngagementProvider>
    <NativeGlassTabBarGate visible={showBottomNav && !navHidden} pathname={pathname} />
    <div className={cn(
      "relative flex min-h-0 w-full flex-1 flex-col bg-background text-foreground",
      lockMobileExploreViewport && "max-h-full overflow-hidden overscroll-none",
    )}>
      {showNativeTopBar && !modalOverlay?.hideTopNav && <NativeTopBar />}
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          // Immersive map fills edge-to-edge under the floating nav; white so any inset strip
          // (e.g. behind the bottom nav) reads flush instead of grey.
          lockMobileExploreViewport ? "bg-card" : "bg-background",
          // Reserve the bar's MEASURED height (BottomNav publishes
          // `--dc-bottom-nav-h`, safe-area already folded in) rather than the old
          // `4rem + safe-area` guess, which under-reserved by ~10px and left the
          // last row of every scrolling page tucked under the bar.
          showBottomNav && !hideNativeBottomChrome && !navHidden && !isLeafRoute &&
            "pb-[calc(var(--keyboard-height,0px)+var(--dc-bottom-nav-h,calc(4rem+env(safe-area-inset-bottom,0px))))] md:pb-0",
          isMessagesRoute && "min-h-0 overflow-hidden",
          showNativeTopBar &&
            !modalOverlay?.hideTopNav &&
            !modalOverlay?.fullBleedTop &&
            lockMobileExploreViewport &&
            "pt-[calc(env(safe-area-inset-top,0px)+3rem)]",
          showNativeTopBar &&
            !modalOverlay?.hideTopNav &&
            !lockMobileExploreViewport &&
            !isMessagesRoute &&
            !isScrollAwayTitleRoute &&
            !isAccountRoute &&
            "pt-12",
          lockMobileExploreViewport && "overflow-hidden overscroll-none",
        )}
      >
        {/* Per-route boundary (keyed by pathname so navigating away clears it):
            a throw or a failed lazy-import in a page shows the graceful fallback
            instead of white-screening the whole app. Sidebar (LayoutWrapper) and
            BottomNav (below) stay mounted. */}
        <ErrorBoundary key={pathname} label="route">
          {/* Route-level Suspense. Without a boundary HERE, a lazy page suspends
              all the way up to the single top-level <Suspense> in App, which
              unmounts the entire shell — sidebar, NativeTopBar, BottomNav — and
              replaces the whole screen with a centered spinner for the duration
              of the chunk load. That full-screen blank is most of what "the app
              feels laggy" actually was: the chrome flashing away and back on
              every tab tap. Catching suspension at the content region keeps the
              nav mounted and stationary, so only the page area swaps. */}
          <Suspense fallback={<RouteSkeleton pathname={pathname} />}>
            {/* Keyed by the boundary above, so every navigation remounts and re-runs
                the entrance fade — enter-only route transition, no exit phase. */}
            <PageTransition>
              <NavTimingSentinel pathname={pathname} />
              <Outlet />
            </PageTransition>
          </Suspense>
        </ErrorBoundary>
      </div>
      {/* Zero-height wrapper so fixed BottomNav does not steal flex space from Outlet */}
      {showBottomNav && (
        <div className="h-0 shrink-0 overflow-visible">
          <BottomNav hidden={navHidden} />
        </div>
      )}
    </div>
    </ScrollEngagementProvider>
  );
}

// Cache defaults: without these every tab switch / remount refetched everything
// (staleTime 0 + refetchOnWindowFocus) — the single biggest page-load cost.
// Writes still update instantly via explicit invalidateQueries after mutations.
//
// `staleTime` and `gcTime` do different jobs and the difference is the whole
// tab-switch story. `staleTime` only decides when a refetch happens *in the
// background* — the user still sees cached data instantly either way. `gcTime`
// decides when the cache entry is DELETED, and a deleted entry means the next
// visit mounts with no data and paints a spinner. At the old 5 minutes, coming
// back to a tab after a short detour was a guaranteed cold load even though the
// data was a second's fetch old. 30 minutes is longer than any realistic
// "browse away and come back" gap while staying well short of a session, and
// costs only the memory of already-fetched rows.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

/** Cross-platform `--keyboard-height` on <html> (Capacitor + mobile web visualViewport). */
function KeyboardInsetGate() {
  useKeyboardInset();
  return null;
}

function NativeSplashGate() {
  const { isLoading } = useAuth();
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || isLoading) return;
    const t = setTimeout(() => {
      import('@capacitor/splash-screen').then(({ SplashScreen }) =>
        SplashScreen.hide().catch(() => {}),
      );
    }, 100);
    return () => clearTimeout(t);
  }, [isLoading]);
  return null;
}

/**
 * Handles every native deep link that reaches the app via `appUrlOpen`:
 *
 *  1. Custom-scheme OAuth callbacks (`com.dormcheck.ios://auth-callback`,
 *     currently Microsoft/Azure — see `handleMicrosoftSignIn` in Auth.tsx):
 *     PKCE exchange → same @pitt.edu email gate → same redirect resolution as
 *     AuthCallback.tsx.
 *  2. Universal Links (iOS) / App Links (Android): an `https://dormcheck.com/…`
 *     invite/conversation link tapped with the app installed. If logged in we
 *     navigate straight there; if logged out we stash the destination in the
 *     SAME `auth_redirect` mechanism and route through /auth so it lands on the
 *     invite post-login. Web is always the no-install fallback — acceptance is
 *     never gated behind having the app.
 *
 * Lives app-wide (not in Auth.tsx) so it fires regardless of route and survives
 * a webview state reset.
 */
function DeepLinkGate() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: PluginListenerHandle | undefined;

    const handleUrl = async (url: string) => {
      // 1) Custom-scheme OAuth callback.
      if (url.startsWith('com.dormcheck.ios://auth-callback')) {
        await Browser.close().catch(() => {});
        const code = new URL(url).searchParams.get('code');
        if (!code) {
          navigate('/auth', { replace: true });
          return;
        }
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error || !data.session) {
          toast.error(error?.message ?? 'Sign-in failed. Please try again.');
          navigate('/auth', { replace: true });
          return;
        }
        // Same gate the Google/web paths use: signs out + toasts on failure. No
        // picked-school context here (deep-link callback), so resolve by the
        // session email against every active university, not just the default.
        const authedUniversity = resolveUniversityByEmail(data.session.user.email);
        if (!(await enforceUniversityEmailOrSignOut(data.session.user.email, authedUniversity))) {
          navigate('/auth', { replace: true });
          return;
        }
        // Honor the stashed redirect (mirror AuthCallback.tsx).
        let target = '/my-home';
        try {
          const stored = sessionStorage.getItem('auth_redirect');
          if (stored?.startsWith('/') && !stored.startsWith('//')) {
            sessionStorage.removeItem('auth_redirect');
            target = stored;
          } else {
            target = await getPostLoginRedirect(data.session.user.id);
          }
        } catch {
          // keep /my-home
        }
        navigate(target, { replace: true });
        return;
      }

      // 2) Universal Link / App Link into app content.
      const path = universalLinkToPath(url);
      if (!path) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        navigate(path, { replace: true });
      } else {
        try {
          sessionStorage.setItem('auth_redirect', path);
        } catch {
          // ignore — post-login just falls back to the default landing route.
        }
        navigate('/auth', { replace: true });
      }
    };

    void CapApp.addListener('appUrlOpen', ({ url }) => {
      void handleUrl(url);
    }).then((h) => {
      handle = h;
    });
    return () => {
      void handle?.remove();
    };
  }, [navigate]);
  return null;
}

/**
 * Android hardware/gesture back button: go back through in-app history when
 * possible, otherwise minimize the app (home screen) — never dead-exit
 * mid-flow. Capacitor only emits `backButton` on Android; the iOS/web guard
 * is belt-and-braces.
 */
function AndroidBackButtonGate() {
  const navigate = useNavigate();
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return;
    let handle: PluginListenerHandle | undefined;
    void CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        navigate(-1);
      } else {
        void CapApp.minimizeApp();
      }
    }).then((h) => {
      handle = h;
    });
    return () => {
      void handle?.remove();
    };
  }, [navigate]);
  return null;
}

/**
 * Routes push-notification taps and foreground pushes into the app. The
 * Capacitor listeners live in src/lib/pushNotifications.ts (non-React); they
 * bridge here via CustomEvents plus a pending-route stash for cold starts
 * (a tap can fire before React mounts).
 */
function PushNavGate() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Cold start: consume a tap that arrived before mount.
    const pending = consumePendingPushRoute();
    if (pending) navigate(pending);

    // Opening/resuming the app counts as seeing the badge - clear the stuck
    // app-icon badge (send-push stamps every payload with badge:1 and nothing
    // else ever resets it). Also clear on first mount for a cold start.
    void clearAppBadge();
    let stateHandle: PluginListenerHandle | undefined;
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        void clearAppBadge();
        // Resume Realtime on foreground: reopen the socket. supabase-js rejoins
        // every subscribed channel automatically (same path as a network
        // drop/resume), so all live features recover without remounting.
        supabase.realtime.connect();
      } else {
        // Pause Realtime while backgrounded so the app doesn't hold idle
        // subscriptions the server must keep polling WAL for (realtime.list_changes
        // is the dominant DB load). One central disconnect covers every channel;
        // channels rejoin on the next foreground.
        void supabase.realtime.disconnect();
      }
    }).then((h) => {
      stateHandle = h;
    });

    const onNav = (e: Event) => {
      const route = (e as CustomEvent<{ route?: string }>).detail?.route;
      consumePendingPushRoute(); // this tap is handled; don't replay on remount
      if (isSafePushRoute(route)) navigate(route);
    };
    const onForeground = (e: Event) => {
      const { title, body, route } =
        (e as CustomEvent<{ title?: string; body?: string; route?: string | null }>).detail ?? {};
      if (!title && !body) return;
      toast(title || 'DormCheck', {
        description: body,
        ...(isSafePushRoute(route)
          ? { action: { label: 'View', onClick: () => navigate(route) } }
          : {}),
      });
    };
    window.addEventListener(PUSH_NAV_EVENT, onNav);
    window.addEventListener(PUSH_FOREGROUND_EVENT, onForeground);
    return () => {
      window.removeEventListener(PUSH_NAV_EVENT, onNav);
      window.removeEventListener(PUSH_FOREGROUND_EVENT, onForeground);
      void stateHandle?.remove();
    };
  }, [navigate]);
  return null;
}

/**
 * Composes the four zone route modules inside the shared layout shell.
 *
 * The route tree, paths, layout (`LayoutWrapper` > single `<Routes>` > one
 * `<Route element={<AppLayout />}>`), and Phase-1 feature gating are unchanged
 * from before the zone split - the modules just group the same `<Route>`s.
 *
 * Native guard (single source of truth): on the native shell only the User App
 * (`AppRoutes`), Auth (`AuthRoutes`), and shared Legal (`LegalRoutes`) zones
 * mount, plus `/` (`LandingRoute`, which itself redirects native to `/my-home`
 * or `/auth`). The rest of Marketing and all of Admin are web-only (superadmins
 * get lightweight dev hot keys in /account instead of the console natively). `LegalRoutes`
 * (/privacy, /terms, /moderation, /licenses) mounts on both web and native so
 * the legal/policy pages never 404 in the app (Apple requires them reachable
 * in-app).
 */
export function RoutedApp({ onOpenSupportModal }: { onOpenSupportModal: () => void }) {
  const { flagsResolved, showHousing, showMap, showRoommates, showConfirmedRoommates, showRankings, showBrowseSublease } = useFeatureFlags();
  const isNative = Capacitor.isNativePlatform();
  const isMobile = useIsMobile();
  const realLocation = useLocation();

  // Sheet routes: on mobile these present as a sheet OVER the page they were
  // opened from — that page must stay mounted and visible behind the dimmed
  // sheet. We track the last non-sheet location and, while a sheet is open, feed
  // it to both the app chrome (via EffectiveLocationContext) and the background
  // `<Routes>` (via its `location` prop), so the sheet route renders as an
  // overlay rather than a page that replaces what's underneath. Desktop keeps
  // both as full pages.
  const onSettings = realLocation.pathname.startsWith("/settings");
  const onPostComposer = realLocation.pathname === "/marketplace/create";
  const onSheetRoute = onSettings || onPostComposer;
  // Starts null, not at a fallback, so "never recorded a real page" is
  // distinguishable — a cold deep link then gets the fallback for THIS sheet
  // instead of Settings' home screen.
  const behindRef = useRef<Location | null>(null);
  if (!onSheetRoute) behindRef.current = realLocation;
  const sheetOpen = isMobile && onSheetRoute;
  const behindLocation =
    behindRef.current ?? (onPostComposer ? POST_COMPOSER_FALLBACK_BG : SETTINGS_FALLBACK_BG);
  const effectiveLocation = sheetOpen ? behindLocation : realLocation;

  const gated = (show: boolean, realEl: ReactNode, title: string) => {
    if (!flagsResolved) {
      return <PageLoader />;
    }
    return show ? realEl : <ComingSoon title={title} />;
  };

  return (
    <EffectiveLocationContext.Provider value={sheetOpen ? effectiveLocation : null}>
    <Suspense fallback={<PageLoader />}>
      <LayoutWrapper onOpenSupportModal={onOpenSupportModal}>
        <Routes location={effectiveLocation}>
          {/* Public share UI for the native iMessage extension; outside AppLayout
              so it renders bare in the extension's WKWebView (no app nav). */}
          <Route path="/imessage" element={<IMessageSharePage />} />
          {/* Public family share view of a group checklist (token-scoped, no
              account); outside AppLayout so a logged-out parent sees no app
              chrome and no login wall. */}
          <Route path="/checklist/shared/:token" element={<SharedChecklistPage />} />
          {/* Dev-only landing fan-out. Outside AppLayout (no BottomNav / app
              chrome), but still inside LayoutWrapper, so a variant is framed by
              the REAL MarketingTopNav + MarketingFooter — which is deliberate:
              the landing page ships with that nav, and judging a composition
              without it would compare something that will never exist. */}
          {VariantsGallery && VariantSolo && (
            <>
              <Route path="/__variants" element={<VariantsGallery />} />
              <Route path="/__variants/:id" element={<VariantSolo />} />
            </>
          )}
          <Route element={<AppLayout />}>
            {isNative ? (
              <Route path="/" element={<LandingRoute />} />
            ) : (
              MarketingRoutes()
            )}
            {LegalRoutes()}
            {AuthRoutes()}
            {AppRoutes({ showHousing, showMap, showRoommates, showConfirmedRoommates, showRankings, showBrowseSublease, gated })}
            {!isNative && AdminRoutes()}
            {!isNative && AdvertiserRoutes()}
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </LayoutWrapper>
      {/* The sheets themselves, matched against the REAL URL so each reads its own
          params (Settings' `?section=`, the composer's nav-state draft), layered
          over the background page. */}
      {sheetOpen && (
        <Suspense fallback={null}>
          <Routes>
            <Route path="/settings" element={<SettingsSheetPage />} />
            <Route
              path="/marketplace/create"
              element={
                <ProtectedRoute>
                  <MarketplaceCreateSheetPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </Suspense>
      )}
      {/* Mounted outside the route table so its effect is visible on EVERY page,
          which is the point — a tweak you can only see on one screen is not a
          decision you can make. */}
      {TweaksPanel && (
        <Suspense fallback={null}>
          <TweaksPanel />
        </Suspense>
      )}
    </Suspense>
    </EffectiveLocationContext.Provider>
  );
}

/**
 * Drives framer-motion's Reduce Motion from the user's Accessibility preference:
 * 'system' → "user" (honor the OS), 'on' → "always", 'off' → "never".
 * (WCAG 2.3.3; CSS animations are handled by the .reduce-motion classes in index.css.)
 */
function A11yMotionConfig({ children }: { children: React.ReactNode }) {
  const { reduceMotion } = useAccessibility();
  return <MotionConfig reducedMotion={motionConfigMode(reduceMotion)}>{children}</MotionConfig>;
}

const App = () => {
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);

  return (
  <QueryClientProvider client={queryClient}>
    <AccessibilityProvider>
    <A11yMotionConfig>
    <TooltipProvider>
      {/* BrowserRouter + a view transition between top-level sections. */}
      <ViewTransitionBrowserRouter>
        <ScrollToTop />
        <KeyboardInsetGate />
        <AuthProvider>
          {/* ThemeProvider needs the router (route-scoped dark) + auth (per-user pref). */}
          <ThemeProvider>
          {/* Sonner reads useTheme, so it lives inside ThemeProvider. */}
          <Sonner />
          <UniversityProvider>
          <NativeSplashGate />
          <DeepLinkGate />
          <MfaChallengeGate />
          <PushNavGate />
          <AndroidBackButtonGate />
          <AdminPreviewProvider>
          <AdminUniversitySiloProvider>
          <SetupModeProvider>
          <ModalOverlayProvider>
          <CollaborationProvider>
          <ChatProvider>
          <HousingSavedProvider>
          {/* Desktop sidebar page bookmarks (localStorage cache + profile sync). */}
          <BookmarksProvider>
            <ChatWidgetGate />
            <FeatureTour />
            <ViewAsBanner />
            <RoutedApp onOpenSupportModal={() => setIsSupportModalOpen(true)} />
          </BookmarksProvider>
          </HousingSavedProvider>
          </ChatProvider>
          </CollaborationProvider>
          </ModalOverlayProvider>
          </SetupModeProvider>
          </AdminUniversitySiloProvider>
          </AdminPreviewProvider>
          </UniversityProvider>
          </ThemeProvider>
        </AuthProvider>
      </ViewTransitionBrowserRouter>
      <FeedbackSupportModal
        open={isSupportModalOpen}
        onOpenChange={setIsSupportModalOpen}
      />
      <Analytics />
      <SpeedInsights />
    </TooltipProvider>
    </A11yMotionConfig>
    </AccessibilityProvider>
  </QueryClientProvider>
  );
};

export default App;
