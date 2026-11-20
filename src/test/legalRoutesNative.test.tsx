import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * Regression guard for Phase 1: on the native shell the privacy policy and terms
 * of service must stay reachable in-app (Apple requirement; linked from the
 * sign-in and profile screens). They are mounted by LegalRoutes on web + native
 * and exempt from AppLayout's native "logged-out → /auth" redirect, so they must
 * render - not NotFound, and not bounce to /auth - under native conditions.
 *
 * audit:app only exercises web, so this forces Capacitor.isNativePlatform() true.
 */

// Force the native shell (iOS flavor; getPlatform feeds the iOS-only
// push/SSO gates and Android back-button gate).
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" },
}));

// Controllable auth so we can cover the signed-out sign-in screen and the
// signed-in profile screen without the real provider / Supabase.
const { mockAuthState } = vi.hoisted(() => ({
  mockAuthState: { user: null as null | { id: string }, isLoading: false },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockAuthState,
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// Phase-1 flags resolved; legal routes are ungated so values don't matter.
vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({
    flagsResolved: true,
    showHousing: false,
    showMap: false,
    showRoommates: false,
    showRankings: false,
  }),
}));

// Stub heavy nav chrome that isn't relevant to route resolution.
vi.mock("@/components/GlobalTopNav", () => ({ GlobalTopNav: () => null }));
vi.mock("@/components/BottomNav", () => ({ BottomNav: () => null }));
vi.mock("@/components/NativeTopBar", () => ({ NativeTopBar: () => null }));
// Shell chrome, same as the three above: this suite renders RoutedApp without the
// app's provider stack, and the legal notice reads its per-account acknowledgement
// through react-query. Stubbing it keeps this file about route resolution.
vi.mock("@/components/legal/LegalUpdateNotice", () => ({ LegalUpdateNotice: () => null }));

import { RoutedApp } from "@/App";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RoutedApp onOpenSupportModal={() => {}} />
    </MemoryRouter>,
  );
}

describe("native legal routes (Phase 1 regression guard)", () => {
  beforeEach(() => {
    mockAuthState.user = null;
    mockAuthState.isLoading = false;
  });

  it("renders /privacy on native when signed out (sign-in screen link)", () => {
    renderAt("/privacy");
    expect(screen.getAllByText(/Privacy Policy/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Page not found/i)).toBeNull();
  });

  it("shows a native back control on /privacy so the page isn't a dead-end", () => {
    // On native the legal pages mount bare (no NativeTopBar/BottomNav when
    // signed out), so LegalBackBar is the only way out. Guards the 2026-06-29
    // regression where the in-page back header was removed in a cleanup.
    renderAt("/privacy");
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("renders /terms on native when signed out (sign-in screen link)", () => {
    renderAt("/terms");
    expect(screen.getAllByText(/Terms of Service/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Page not found/i)).toBeNull();
  });

  it("renders /moderation on native (Settings > Support & legal link)", () => {
    renderAt("/moderation");
    expect(screen.getAllByText(/Moderation Guidelines/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Page not found/i)).toBeNull();
  });

  it("renders /licenses on native (Settings > Support & legal link)", () => {
    renderAt("/licenses");
    expect(screen.getAllByText(/Open-source licenses/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Page not found/i)).toBeNull();
  });

  it("renders /privacy on native when signed in (profile screen link)", () => {
    mockAuthState.user = { id: "user-1" };
    renderAt("/privacy");
    expect(screen.getAllByText(/Privacy Policy/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Page not found/i)).toBeNull();
  });

  // Was /dorms until 2026-08-16; that route was deleted outright, so asserting it
  // is NotFound would pass for the wrong reason and stop testing the native guard.
  it("keeps the rest of Marketing web-only: /ads is NotFound on native", () => {
    mockAuthState.user = { id: "user-1" };
    renderAt("/ads");
    expect(screen.getByText(/Page not found/i)).toBeInTheDocument();
  });
});
