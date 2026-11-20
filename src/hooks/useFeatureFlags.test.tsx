import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { resolveFeatureFlags, useFeatureFlags } from '@/hooks/useFeatureFlags';
import { CMU_UNIVERSITY_ID, PITT_UNIVERSITY_ID } from '@/config/universities';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/contexts/AdminPreviewContext', () => ({
  useAdminFullAppPreview: vi.fn(() => ({ fullAppPreview: false, setFullAppPreview: vi.fn() })),
}));

// The hook's DB-override query must never hit the network in unit tests; the
// mock resolves to "no row", i.e. no per-tenant overrides.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }),
  },
}));

import { useAuth } from '@/hooks/useAuth';

const mockUseAuth = vi.mocked(useAuth);

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('resolveFeatureFlags', () => {
  it('logged-out: flagsResolved true, showFullApp false under LIMITED_SURFACES', () => {
    const flags = resolveFeatureFlags(
      { userId: undefined, isAdmin: false, profileLoaded: true },
      true,
    );
    expect(flags.flagsResolved).toBe(true);
    expect(flags.showFullApp).toBe(false);
    expect(flags.showHousing).toBe(false);
    expect(flags.showRoommates).toBe(false);
    expect(flags.showMap).toBe(false);
    expect(flags.showGroupChats).toBe(false);
    expect(flags.showRankings).toBe(false);
    expect(flags.showSavedDorms).toBe(false);
  });

  it('language picker is on now that zh is fully translated (all auth states)', () => {
    const student = resolveFeatureFlags(
      { userId: 'user-1', isAdmin: false, profileLoaded: true },
      true,
    );
    const admin = resolveFeatureFlags(
      { userId: 'admin-1', isAdmin: true, isSuperAdmin: true, profileLoaded: true, fullAppPreview: true },
      true,
    );
    expect(student.showLanguagePicker).toBe(true);
    expect(admin.showLanguagePicker).toBe(true);
  });

  it('full-app preview is superadmin-only: superadmin unlocks, university_admin does not', () => {
    const superadmin = resolveFeatureFlags(
      { userId: 'su-1', isAdmin: true, isSuperAdmin: true, profileLoaded: true, fullAppPreview: true },
      true,
    );
    // A university_admin has isAdmin true but isSuperAdmin false - the preview
    // flag must NOT unlock the full app for them.
    const universityAdmin = resolveFeatureFlags(
      { userId: 'ua-1', isAdmin: true, isSuperAdmin: false, profileLoaded: true, fullAppPreview: true },
      true,
    );
    expect(superadmin.showFullApp).toBe(true);
    expect(superadmin.showHousing).toBe(true);
    expect(universityAdmin.showFullApp).toBe(false);
    expect(universityAdmin.showHousing).toBe(false);
  });

  it('confirmed roommates are always on for non-admins while browsing stays gated', () => {
    const flags = resolveFeatureFlags(
      { userId: 'user-1', isAdmin: false, profileLoaded: true },
      true,
    );
    expect(flags.showConfirmedRoommates).toBe(true);
    expect(flags.showRoommates).toBe(false);
  });

  it('building chats are always on while general group chats stay gated', () => {
    const flags = resolveFeatureFlags(
      { userId: 'user-1', isAdmin: false, profileLoaded: true },
      true,
    );
    expect(flags.showBuildingChats).toBe(true);
    expect(flags.showGroupChats).toBe(false);
  });

  it('logged-in loading: showFullApp false while profile is unresolved', () => {
    const flags = resolveFeatureFlags(
      { userId: 'user-1', isAdmin: true, profileLoaded: false },
      true,
    );
    expect(flags.flagsResolved).toBe(false);
    expect(flags.showFullApp).toBe(false);
    expect(flags.showHousing).toBe(false);
  });

  it('non-admin loaded: showFullApp false', () => {
    const flags = resolveFeatureFlags(
      { userId: 'user-1', isAdmin: false, profileLoaded: true },
      true,
    );
    expect(flags.flagsResolved).toBe(true);
    expect(flags.showFullApp).toBe(false);
    expect(flags.showSavedDorms).toBe(false);
  });

  it('superadmin loaded without preview: showFullApp false', () => {
    const flags = resolveFeatureFlags(
      { userId: 'user-1', isAdmin: true, isSuperAdmin: true, profileLoaded: true, fullAppPreview: false },
      true,
    );
    expect(flags.flagsResolved).toBe(true);
    expect(flags.showFullApp).toBe(false);
    expect(flags.showHousing).toBe(false);
  });

  it('superadmin loaded with preview: showFullApp true and all gated surfaces enabled', () => {
    const flags = resolveFeatureFlags(
      { userId: 'user-1', isAdmin: true, isSuperAdmin: true, profileLoaded: true, fullAppPreview: true },
      true,
    );
    expect(flags.flagsResolved).toBe(true);
    expect(flags.showFullApp).toBe(true);
    expect(flags.showHousing).toBe(true);
    expect(flags.showRoommates).toBe(true);
    expect(flags.showMap).toBe(true);
    expect(flags.showGroupChats).toBe(true);
    expect(flags.showRankings).toBe(true);
    expect(flags.showSavedDorms).toBe(true);
  });

  it('limitedSurfaces=false: showFullApp true regardless of admin state', () => {
    expect(
      resolveFeatureFlags(
        { userId: undefined, isAdmin: false, profileLoaded: true },
        false,
      ).showFullApp,
    ).toBe(true);
    expect(
      resolveFeatureFlags(
        { userId: 'user-1', isAdmin: false, profileLoaded: false },
        false,
      ).showFullApp,
    ).toBe(true);
    expect(
      resolveFeatureFlags(
        { userId: 'user-1', isAdmin: false, profileLoaded: true },
        false,
      ).showFullApp,
    ).toBe(true);
  });
});

describe('useFeatureFlags', () => {
  it('delegates to auth state via resolveFeatureFlags', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'admin-1' } as ReturnType<typeof useAuth>['user'],
      session: null,
      isLoading: false,
      signOut: vi.fn(),
      isAdmin: true,
      role: 'university_admin',
      isSuperAdmin: false,
      isUniversityAdmin: true,
      adminScopes: null,
      profileLoaded: true,
      universityId: null,
    });

    const { result } = renderHook(() => useFeatureFlags(), { wrapper });

    expect(result.current).toEqual(
      resolveFeatureFlags(
        { userId: 'admin-1', isAdmin: true, isSuperAdmin: false, profileLoaded: true, fullAppPreview: false },
        true,
      ),
    );
  });

  const baseAuth = {
    session: null,
    isLoading: false,
    signOut: vi.fn(),
    isAdmin: false,
    role: 'user' as const,
    isSuperAdmin: false,
    isUniversityAdmin: false,
    adminScopes: null,
    profileLoaded: true,
  };

  it('CMU non-admin gets the full app (per-university limitedSurfaces: false)', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      user: { id: 'cmu-1' } as ReturnType<typeof useAuth>['user'],
      universityId: CMU_UNIVERSITY_ID,
    });

    const { result } = renderHook(() => useFeatureFlags(), { wrapper });

    expect(result.current.showFullApp).toBe(true);
    expect(result.current.showHousing).toBe(true);
    expect(result.current.showRoommates).toBe(true);
    expect(result.current.showMap).toBe(true);
    expect(result.current.showGroupChats).toBe(true);
    expect(result.current.showRankings).toBe(true);
    expect(result.current.showSavedDorms).toBe(true);
  });

  it('Pitt non-admin stays surface-gated', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      user: { id: 'pitt-1' } as ReturnType<typeof useAuth>['user'],
      universityId: PITT_UNIVERSITY_ID,
    });

    const { result } = renderHook(() => useFeatureFlags(), { wrapper });

    expect(result.current.showFullApp).toBe(false);
    expect(result.current.showSavedDorms).toBe(false);
    // …except the surfaces Pitt opts into via its static `features` block in
    // src/config/universities.ts, which went live 2026-08-05 when the
    // per-university flag wiring landed. Housing browse is one of them; the
    // master gate itself is untouched, which is what showFullApp asserts.
    expect(result.current.showHousing).toBe(true);
  });

  it('unresolved universityId falls back to the global gate', () => {
    mockUseAuth.mockReturnValue({
      ...baseAuth,
      user: { id: 'user-1' } as ReturnType<typeof useAuth>['user'],
      universityId: null,
    });

    const { result } = renderHook(() => useFeatureFlags(), { wrapper });

    expect(result.current.showFullApp).toBe(false);
  });
});
