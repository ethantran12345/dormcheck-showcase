import { User, UserCircle, Bell, Ban, LifeBuoy, Wrench, Trash2, Palette, ShieldCheck, type LucideIcon } from 'lucide-react';

/**
 * Single source of truth for the Settings sections, shared by `SettingsView`
 * (which renders one section's panel at a time, keyed off the `?section=` query
 * param) and `AppSidebar`'s route-aware Settings variant (which renders these as
 * the left-nav rows on `/settings`). Icons drive the sidebar rows.
 */
/**
 * The Safety Center's only address. Its standalone `/safety` route was removed
 * 2026-08-05 (vault `Reviews Subleases Services PRD.md` §5b) - the CONTENT
 * stayed and lives on as the Settings > Support doc, rendered inline by
 * `SettingsView` from `?doc=safety`. Anything that used to link to `/safety`
 * links here instead. It is also the concrete artifact for App Store guideline
 * 1.2, so it must stay reachable in one hop.
 */
export const SAFETY_CENTER_PATH = '/settings?section=support&doc=safety';

export type SettingsSectionId =
  | 'profile'
  | 'account'
  | 'security'
  | 'appearance'
  | 'notifications'
  | 'privacy'
  | 'support'
  | 'admin'
  | 'danger';

export type SettingsSection = {
  id: SettingsSectionId;
  /** English label - also the fallback + English search haystack term. */
  label: string;
  /** i18n key (settings ns) resolved at render for the localized nav label. */
  labelKey: string;
  icon: LucideIcon;
  /** Visible only to admins (matches SettingsView's silo gating). */
  adminOnly?: boolean;
};

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'profile', label: 'Profile', labelKey: 'settings:sections.profile.label', icon: UserCircle },
  { id: 'account', label: 'Account', labelKey: 'settings:sections.account.label', icon: User },
  { id: 'security', label: 'Security', labelKey: 'settings:sections.security.label', icon: ShieldCheck },
  { id: 'appearance', label: 'Appearance', labelKey: 'settings:sections.appearance.label', icon: Palette },
  { id: 'notifications', label: 'Notifications', labelKey: 'settings:sections.notifications.label', icon: Bell },
  { id: 'privacy', label: 'Privacy', labelKey: 'settings:sections.privacy.label', icon: Ban },
  { id: 'support', label: 'Support & Legal', labelKey: 'settings:sections.support.label', icon: LifeBuoy },
  { id: 'admin', label: 'Admin', labelKey: 'settings:sections.admin.label', icon: Wrench, adminOnly: true },
  { id: 'danger', label: 'Danger Zone', labelKey: 'settings:sections.danger.label', icon: Trash2 },
] as const;

/** Sections visible for the given admin state (admin-only rows drop for students). */
export function visibleSettingsSections(isAdmin: boolean): readonly SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => !s.adminOnly || isAdmin);
}

/**
 * Resolve a raw `?section=` value to a valid, permitted section id, falling back
 * to `'account'` when the value is missing, unknown, or admin-gated for a
 * non-admin.
 */
export function resolveSettingsSection(
  raw: string | null | undefined,
  isAdmin: boolean,
): SettingsSectionId {
  const match = visibleSettingsSections(isAdmin).find((s) => s.id === raw);
  return match?.id ?? 'account';
}
