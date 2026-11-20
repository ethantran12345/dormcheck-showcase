import { ProfileEditFields } from '@/components/profile/ProfileEditFields';

/**
 * Settings → Profile (R9): the whole profile - identity AND roommate matching -
 * lives here as one Settings section. It reuses the shared `ProfileEditFields`
 * verbatim (the single source of truth for the profile fetch + save path, also
 * used by the RoommatePage `EditProfile` modal and `MobileAccountSheet`), so no
 * field or save logic is forked here.
 *
 * The section header ("Profile - your identity, housing...") was intentionally
 * dropped: by the time this renders the user has already tapped Profile, so the
 * identity chip + description was redundant chrome. The profile now opens
 * straight into its own sectioned cards, independent and above everything else.
 *
 * Layout: `SettingsView` already centers section panels at `max-w-3xl`, which
 * gives the form a comfortable readable column on desktop instead of the old
 * full-bleed `/profile` stretch. Mobile stays the single-column drill-down (the
 * R8 pattern) - the unprefixed classes inside `ProfileEditFields` are untouched.
 */
export function SettingsProfile() {
  // `flat` opts this surface into the Mercury row-list idiom: the Basics identity
  // set renders as borderless hairline rows under a small-caps label, no
  // collapsible accordion. The Roommate modal / onboarding / ProfilePage keep the
  // card + accordion (they don't pass `flat`).
  return <ProfileEditFields flat />;
}
