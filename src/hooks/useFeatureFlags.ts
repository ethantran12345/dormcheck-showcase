import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useAdminFullAppPreview } from '@/contexts/AdminPreviewContext';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import {
  I18N_LANGUAGE_PICKER,
  LIMITED_SURFACES,
  SHOW_BUILDING_CHATS,
  SHOW_CONFIRMED_ROOMMATES,
  SHOW_POST_ITEM,
  SHOW_POST_OFFER_HELP,
  SHOW_REMOTE_SERVICES,
  SHOW_POST_REQUEST_HELP,
  SHOW_POST_SUBLEASE,
  SHOW_CAMPUS_LIVE,
  SHOW_SCHEDULE,
} from '@/lib/featureFlags';
import { getUniversityById } from '@/config/universities';

export type FeatureFlagAuth = {
  userId: string | undefined;
  isAdmin: boolean;
  /** Full-app preview is a platform (superadmin) tool; university_admins can't self-unlock.
   *  Optional (undefined = not superadmin) so student/legacy callers need no change. */
  isSuperAdmin?: boolean;
  profileLoaded: boolean;
  fullAppPreview?: boolean;
};

export type FeatureFlags = {
  showFullApp: boolean;
  flagsResolved: boolean;
  showHousing: boolean;
  showRoommates: boolean;
  showConfirmedRoommates: boolean;
  showBuildingChats: boolean;
  showMap: boolean;
  showGroupChats: boolean;
  showRankings: boolean;
  showSavedDorms: boolean;
  /** My Schedule nav entries. The `/schedule` route ignores this — see SHOW_SCHEDULE. */
  showSchedule: boolean;
  /** Campus Live nav + My Home tile. The `/campus-live` route ignores this. */
  showCampusLive: boolean;
  showLanguagePicker: boolean;
  /** Marketplace post types — one flow, one feed. See src/lib/postTypes.ts. */
  showPostItem: boolean;
  showPostSublease: boolean;
  showPostRequestHelp: boolean;
  showPostOfferHelp: boolean;
  /**
   * Whether the sublease chip appears in the FEED filter row — which is to say,
   * whether a student can READ subleases at all: the feed filters one `post_type`
   * at a time and defaults to `item`, so that chip is the only route to them.
   *
   * Split out of `showPostSublease` on 2026-08-17. Gating POSTING for the two
   * tenants with no seeded buildings (CMU, Carlow — their picker is empty, so the
   * composer is a dead end) would otherwise have silently taken their READING away
   * with it. Browsing stays open to every tenant by design, so this key is NOT in
   * OVERRIDABLE_SURFACES — a school can close its own posting, never anyone's
   * reading. Nothing closes it any more: the native clamp stopped covering it on
   * 2026-08-18 (see the clamp in `resolveFeatureFlags`), so it is true everywhere
   * subleases are launched.
   */
  showBrowseSublease: boolean;
  /**
   * Cross-school REMOTE service categories. Client-side visibility only — the
   * real gate is `universities.remote_services_open`, which defaults false, so a
   * tenant override here widens the picker and nothing else. See
   * SHOW_REMOTE_SERVICES for why it is off.
   */
  showRemoteServices: boolean;
};

/**
 * Sparse per-tenant overrides stored in universities.feature_flags (jsonb).
 * Missing keys inherit the static config / global defaults, so `{}` is a
 * no-op. `limitedSurfaces` overrides the master gate; the `show*` keys override
 * individual surfaces after derivation.
 */
export type UniversityFeatureOverrides = Partial<
  Pick<
    FeatureFlags,
    | 'showHousing'
    | 'showRoommates'
    | 'showConfirmedRoommates'
    | 'showBuildingChats'
    | 'showMap'
    | 'showGroupChats'
    | 'showRankings'
    | 'showSavedDorms'
    | 'showSchedule'
    | 'showCampusLive'
    | 'showPostItem'
    | 'showPostSublease'
    | 'showPostRequestHelp'
    | 'showPostOfferHelp'
    | 'showRemoteServices'
  >
> & { limitedSurfaces?: boolean };

const OVERRIDABLE_SURFACES = [
  'showHousing',
  'showRoommates',
  'showConfirmedRoommates',
  'showBuildingChats',
  'showMap',
  'showGroupChats',
  'showRankings',
  'showSavedDorms',
  // Nav-only gate: a school can take My Schedule back off the nav without a deploy.
  'showSchedule',
  'showCampusLive',
  // Marketplace post types: this is what lets CMU run subleases while Pitt does
  // not, without a branch (PRD §5 Phase 2).
  'showPostItem',
  'showPostSublease',
  'showPostRequestHelp',
  'showPostOfferHelp',
  // Picker-side only. `universities.remote_services_open` is the gate that
  // actually widens who can read a remote listing, and it is a separate column
  // on purpose: a jsonb override should not be able to publish a student's post
  // to schools the privacy policy has not disclosed.
  'showRemoteServices',
] as const;

/** Keep only well-formed boolean overrides from the DB jsonb (defense against
 *  a mistyped console write breaking flag resolution). */
export function sanitizeOverrides(raw: unknown): UniversityFeatureOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: UniversityFeatureOverrides = {};
  // DUAL-KEY READ, one release. `universities.feature_flags` is jsonb, so it
  // stores whatever was written and this function drops keys it does not know.
  // Reading only the new name would make a row still carrying the pre-rename
  // `phase1Only` resolve to {}, silently falling back to the static default —
  // an un-gated tenant would re-gate every student with NO error in any log.
  // The data is carried by 20260806000000_rename_phase1only_to_limitedsurfaces.sql;
  // this branch covers rows written between deploy and migration, and any row
  // that migration missed.
  // DEPRECATED: drop the `phase1Only` branch (and the field on
  // UniversityFeatureOverrides) only once the migration is confirmed applied in
  // prod and no row carries the old key. Regression tests guard both directions.
  if (typeof obj.phase1Only === 'boolean') out.limitedSurfaces = obj.phase1Only;
  if (typeof obj.limitedSurfaces === 'boolean') out.limitedSurfaces = obj.limitedSurfaces;
  for (const key of OVERRIDABLE_SURFACES) {
    if (typeof obj[key] === 'boolean') out[key] = obj[key] as boolean;
  }
  return out;
}

export function resolveFeatureFlags(
  auth: FeatureFlagAuth,
  limitedSurfaces: boolean = LIMITED_SURFACES,
  overrides: UniversityFeatureOverrides = {},
  /** Injected rather than read inline so this stays a pure, testable function. */
  isNative: boolean = Capacitor.isNativePlatform(),
): FeatureFlags {
  const showFullApp =
    !limitedSurfaces ||
    (auth.profileLoaded && auth.isAdmin && auth.isSuperAdmin && !!auth.fullAppPreview);
  const flagsResolved = !auth.userId || auth.profileLoaded;

  const base: FeatureFlags = {
    showFullApp,
    flagsResolved,
    showHousing: showFullApp,
    showRoommates: showFullApp,
    // Confirmed roommate groups are on for everyone; browsing stays gated.
    showConfirmedRoommates: SHOW_CONFIRMED_ROOMMATES,
    // Building/floor chats are always on (Your Dorm hub); general group chats stay gated.
    showBuildingChats: SHOW_BUILDING_CHATS,
    showMap: showFullApp,
    showGroupChats: showFullApp,
    showRankings: showFullApp,
    showSavedDorms: showFullApp,
    // Constant gate, not showFullApp-derived: Schedule is a live surface inside
    // the reduced set, so deriving it would switch it off for a gated school.
    showSchedule: SHOW_SCHEDULE,
    showCampusLive: SHOW_CAMPUS_LIVE,
    // Constant gate, not user-dependent: stays off until a locale is fully translated.
    showLanguagePicker: I18N_LANGUAGE_PICKER,
    // Marketplace is inside the reduced surface set, so post types are gated on
    // their own constants rather than derived from showFullApp.
    showPostItem: SHOW_POST_ITEM,
    showPostSublease: SHOW_POST_SUBLEASE,
    showPostRequestHelp: SHOW_POST_REQUEST_HELP,
    showPostOfferHelp: SHOW_POST_OFFER_HELP,
    // Same launch switch as posting — subleases either exist as a feature or they
    // do not — but a separate FLAG, so the per-tenant override below cannot reach
    // it. Set before the override loop and never revisited by it.
    showBrowseSublease: SHOW_POST_SUBLEASE,
    showRemoteServices: SHOW_REMOTE_SERVICES,
  };

  for (const key of OVERRIDABLE_SURFACES) {
    if (overrides[key] !== undefined) base[key] = overrides[key]!;
  }

  // NATIVE HISTORY, retained because this is an App Store risk decision rather
  // than dead implementation detail. The clamp used to close BROWSING too — build
  // 31 was rejected on 2026-08-05 and rental listings draw a separate tier of App
  // Store scrutiny (5.1.1 / 3.1.5), so subleases were kept out of the binary
  // entirely. Ethan was shown that risk again on 2026-08-18 and overrode it: the
  // reach of subleases on the phone was worth the review exposure, while the
  // composer stayed clamped. On 2026-08-18 Ethan explicitly overrode that
  // remaining posting clamp too, because the native browse surface already carries
  // the full rental exposure and an empty map without a posting path is a dead end.
  //
  // Falsifying condition: an App Store rejection citing rental or housing content
  // restores the native clamps here, after overrides: set both
  // `base.showPostSublease = false` and `base.showBrowseSublease = false`.
  if (isNative) {
    // Intentionally unclamped by Ethan's 2026-08-18 override above.
  }

  return base;
}

export function useFeatureFlags(): FeatureFlags {
  const { user, isSuperAdmin, profileLoaded, universityId } = useAuth();
  const { fullAppPreview } = useAdminFullAppPreview();
  // View-as: while a superadmin previews as a student, the gates resolve as
  // for a normal user (effectiveIsAdmin false overrides fullAppPreview).
  const { effectiveIsAdmin, siloUniversityId, viewAs } = useAdminUniversitySilo();

  // Resolve the gate per-university from the profile's universityId - NOT via
  // useUniversity(), which silently defaults to Pitt outside its provider.
  // Logged-out / unresolved university falls back to the global default.
  // A superadmin has no university of their own; while previewing as a
  // student, use the picked silo school so "a CMU student" vs "a Pitt
  // student" follows the school they chose.
  const flagUniversityId =
    isSuperAdmin && viewAs === 'user' && siloUniversityId ? siloUniversityId : universityId;
  const university = flagUniversityId ? getUniversityById(flagUniversityId) : undefined;

  // DB-driven per-tenant overrides (universities.feature_flags). While the
  // query is loading or on any failure this resolves to {} and the static
  // config below applies unchanged - no flash, no regression.
  const { data: dbOverrides } = useQuery({
    queryKey: ['university-feature-flags', flagUniversityId],
    queryFn: async (): Promise<UniversityFeatureOverrides> => {
      const { data, error } = await supabase
        .from('universities')
        .select('feature_flags')
        .eq('id', flagUniversityId!)
        .maybeSingle();
      if (error) throw error;
      // Cast: types.ts intentionally lags the feature_flags migration.
      return sanitizeOverrides(
        (data as unknown as { feature_flags?: unknown } | null)?.feature_flags,
      );
    },
    enabled: !!user && !!flagUniversityId,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  // Three layers, narrowest last: global constants < the school's static
  // `features` block in src/config/universities.ts < whatever ops wrote into
  // universities.feature_flags. The static layer is what lets a new tenant ship
  // its surface set in the same commit as its config, without waiting on a DB
  // write; the DB layer stays the live switch.
  const staticOverrides = university?.features ?? {};
  const overrides = useMemo(
    () => ({ ...staticOverrides, ...(dbOverrides ?? {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [university?.id, dbOverrides],
  );

  const limitedSurfaces =
    overrides.limitedSurfaces ?? university?.limitedSurfaces ?? LIMITED_SURFACES;

  return useMemo(
    () =>
      resolveFeatureFlags(
        {
          userId: user?.id,
          isAdmin: effectiveIsAdmin,
          isSuperAdmin,
          profileLoaded,
          fullAppPreview,
        },
        limitedSurfaces,
        overrides,
      ),
    // The disable this list used to carry is gone: memoizing `overrides` made
    // every dependency here an honest one.
    [user?.id, effectiveIsAdmin, isSuperAdmin, profileLoaded, fullAppPreview, limitedSurfaces, overrides],
  );
}
