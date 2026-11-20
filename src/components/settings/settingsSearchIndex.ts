import { Capacitor } from '@capacitor/core';
import { SETTINGS_SECTIONS, type SettingsSection, type SettingsSectionId } from './settingsSections';

/**
 * Flat, hand-authored index of the REAL rows rendered across the Settings
 * sections (R8 search). Each entry is something a user can actually see and act
 * on today - no aspirational or hidden rows. Search (`SettingsSearch`) filters
 * this list; picking a result navigates to that section via `?section=` and
 * passes `?sr=<slug>` so `SettingsView` can scroll to and flash the row.
 *
 * `anchor` is the row's exact visible text, used to re-find the element in the
 * DOM after navigation (defaults to `label`). Keep `anchor` in sync with the
 * rendered copy; if it drifts, highlight degrades gracefully to a section jump.
 *
 * i18n (Phase 1): `label`/`anchor`/`keywords` stay English - they are the
 * fallback, the DOM anchor, and the English search haystack. `labelKey` is the
 * i18n key rendered for the localized result label and matched against localized
 * queries. It MUST equal the key the row's component renders for its title, so
 * localized DOM anchoring lines up — which is the binding constraint, not the
 * namespace. Most rows render a `settings:` key, but a row whose title comes from
 * a shared key points there instead (`account-password` renders
 * `common:actions.password`); inventing a parallel `settings:` copy of it is what
 * makes the two drift in zh. It was `settings:account.password.title` — a key that
 * never existed — until the 2026-08-17 pass, so the row rendered a raw key.
 */
export interface SettingsSearchEntry {
  /** Stable id carried in `?sr=` to re-find the row after navigation. */
  slug: string;
  /** English label: search result fallback, DOM anchor, English haystack term. */
  label: string;
  /** i18n key for the localized label; must match the key the row renders as its title. */
  labelKey: string;
  section: SettingsSectionId;
  /** Exact visible row text for DOM anchoring; falls back to `label`. */
  anchor?: string;
  /** Extra match terms not present in the label. Kept English so English search works. */
  keywords?: string[];
  /** Admin-only rows, hidden from non-admin search (mirrors section gating). */
  adminOnly?: boolean;
  /** Superadmin-only rows (preview/dev tools), hidden from university_admin search. */
  superAdminOnly?: boolean;
  /** Rows that only render in the native shell (e.g. push-only controls). */
  nativeOnly?: boolean;
}

export const SETTINGS_SEARCH_INDEX: readonly SettingsSearchEntry[] = [
  // ----- Profile -----
  { slug: 'profile-name', label: 'Name', labelKey: 'settings:profile.name', section: 'profile', anchor: 'Name', keywords: ['full name', 'display name', 'identity'] },
  { slug: 'profile-pronouns', label: 'Pronouns', labelKey: 'settings:profile.pronouns', section: 'profile', anchor: 'Pronouns', keywords: ['she', 'he', 'they', 'identity'] },
  { slug: 'profile-major', label: 'Major', labelKey: 'settings:profile.major', section: 'profile', anchor: 'Major', keywords: ['study', 'degree', 'school', 'college'] },
  { slug: 'profile-housing', label: 'Housing', labelKey: 'settings:profile.housing', section: 'profile', anchor: 'Housing', keywords: ['dorm', 'room', 'floor', 'building'] },
  { slug: 'profile-grade', label: 'Grade Level', labelKey: 'settings:profile.gradeLevel', section: 'profile', anchor: 'Grade Level', keywords: ['freshman', 'sophomore', 'junior', 'senior', 'graduate', 'year'] },
  { slug: 'profile-payments', label: 'Payments', labelKey: 'settings:profile.payments', section: 'profile', keywords: ['venmo', 'zelle', 'split', 'checklist', 'balances'] },
  { slug: 'profile-bio', label: 'Bio', labelKey: 'settings:profile.bio', section: 'profile', keywords: ['about', 'roommate', 'photos', 'habits'] },
  { slug: 'profile-roommate-visibility', label: 'Show my profile to roommates', labelKey: 'settings:profile.roommateVisibility', section: 'profile', keywords: ['roommate', 'matching', 'searching', 'visibility', 'discoverable'] },
  { slug: 'profile-photo', label: 'Profile photo', labelKey: 'settings:profile.photo', section: 'profile', keywords: ['avatar', 'picture', 'image', 'photo'] },
  { slug: 'profile-delete', label: 'Delete Profile', labelKey: 'settings:profile.delete', section: 'profile', keywords: ['remove roommate profile', 'clear', 'reset'] },

  // ----- Account -----
  { slug: 'account-verified', label: 'Verified student status', labelKey: 'settings:account.verified.title', section: 'account', keywords: ['verified', 'student', 'verification', 'pitt', 'university'] },
  { slug: 'account-email', label: 'Email', labelKey: 'settings:account.email.title', section: 'account', keywords: ['address', 'contact', 'sign-in'] },
  { slug: 'account-password', label: 'Password', labelKey: 'common:actions.password', section: 'account', keywords: ['reset', 'change', 'sign-in', 'login'] },
  { slug: 'account-connected', label: 'Connected sign-in methods', labelKey: 'settings:account.connected.title', section: 'account', keywords: ['google', 'oauth', 'linked', 'sso'] },
  { slug: 'account-signout', label: 'Sign Out', labelKey: 'settings:account.signOut', section: 'account', keywords: ['log out', 'logout', 'sign off'] },

  // ----- Security -----
  { slug: 'security-activity', label: 'Recent security activity', labelKey: 'settings:security.activity.title', section: 'security', keywords: ['log', 'history', 'sign-in', 'last sign-in', 'events'] },
  { slug: 'security-login-alerts', label: 'Login alerts', labelKey: 'settings:security.loginAlerts.title', section: 'security', keywords: ['new device', 'notify', 'email alert'] },
  { slug: 'security-2fa', label: 'Two-factor authentication', labelKey: 'settings:security.twoFactor.title', section: 'security', keywords: ['2fa', 'mfa', 'totp', 'authenticator', 'otp'] },
  { slug: 'security-sessions', label: 'Active sessions', labelKey: 'settings:security.sessions.title', section: 'security', keywords: ['devices', 'sign out', 'logged in'] },

  // ----- Appearance -----
  { slug: 'appearance-theme', label: 'Theme', labelKey: 'settings:appearance.theme.title', section: 'appearance', keywords: ['dark', 'light', 'system', 'mode', 'color scheme'] },
  { slug: 'appearance-reduce-motion', label: 'Reduce motion', labelKey: 'settings:appearance.reduceMotion.title', section: 'appearance', keywords: ['animation', 'accessibility', 'motion'] },
  { slug: 'appearance-text-size', label: 'Text size', labelKey: 'settings:appearance.textSize.title', section: 'appearance', keywords: ['font', 'larger', 'accessibility', 'zoom', 'scale'] },

  // ----- Notifications -----
  { slug: 'notifications-email', label: 'Email notifications', labelKey: 'settings:notifications.email.title', section: 'notifications', anchor: 'Email notifications', keywords: ['master', 'toggle', 'push'] },
  // Quiet hours is a push-only control that only renders in the native shell.
  { slug: 'notifications-quiet-hours', label: 'Quiet hours', labelKey: 'settings:notifications.quietHours.title', section: 'notifications', nativeOnly: true, keywords: ['do not disturb', 'dnd', 'mute', 'night', 'schedule', 'push'] },
  { slug: 'notifications-important', label: 'Important updates', labelKey: 'settings:notifications.important.title', section: 'notifications', anchor: 'Important updates', keywords: ['security', 'account'] },
  { slug: 'notifications-general', label: 'General updates', labelKey: 'settings:notifications.general.title', section: 'notifications', anchor: 'General updates', keywords: ['marketplace', 'messages', 'community'] },

  // ----- Privacy -----
  { slug: 'privacy-messaging', label: 'Who can message you', labelKey: 'settings:privacy.messaging.title', section: 'privacy', keywords: ['dm', 'direct message', 'contact'] },
  { slug: 'privacy-search', label: 'Show me in search', labelKey: 'settings:privacy.searchVisibility.title', section: 'privacy', keywords: ['discovery', 'visibility', 'discoverable'] },
  { slug: 'privacy-blocked', label: 'Blocked accounts', labelKey: 'settings:privacy.blocked.title', section: 'privacy', keywords: ['block', 'mute', 'unblock'] },
  { slug: 'privacy-download', label: 'Download my data', labelKey: 'settings:privacy.download.title', section: 'privacy', keywords: ['export', 'json', 'gdpr', 'my data'] },
  { slug: 'privacy-retention', label: 'How long we keep your data', labelKey: 'settings:privacy.retention.title', section: 'privacy', keywords: ['retention', 'data retention'] },
  { slug: 'privacy-policy', label: 'Privacy Policy', labelKey: 'settings:privacy.policy.title', section: 'privacy', keywords: ['legal', 'policy'] },

  // ----- Support & Legal -----
  { slug: 'support-safety', label: 'Safety Center', labelKey: 'settings:support.safety.title', section: 'support', keywords: ['safety', 'help', 'scam', 'trading', 'contacts'] },
  { slug: 'support-feedback', label: 'Feedback', labelKey: 'settings:support.feedback.title', section: 'support', keywords: ['contact', 'support', 'suggestion', 'bug', 'report'] },
  { slug: 'support-guidelines', label: 'Community Guidelines', labelKey: 'settings:support.guidelines.title', section: 'support', keywords: ['rules', 'moderation', 'conduct'] },
  { slug: 'support-terms', label: 'Terms of Service', labelKey: 'settings:support.terms.title', section: 'support', keywords: ['legal', 'tos', 'terms'] },
  { slug: 'support-licenses', label: 'Open-source licenses', labelKey: 'settings:support.licenses.title', section: 'support', keywords: ['oss', 'attribution', 'credits', 'licenses'] },

  // ----- Admin (admin-only) -----
  { slug: 'admin-preview', label: 'Full app preview', labelKey: 'settings:admin.preview.title', section: 'admin', adminOnly: true, superAdminOnly: true, keywords: ['preview', 'features'] },
  { slug: 'admin-setup', label: 'Enable Setup Mode', labelKey: 'settings:admin.setup.title', section: 'admin', adminOnly: true, superAdminOnly: true, keywords: ['edit', 'delete', 'marketplace', 'setup'] },
  { slug: 'admin-replay', label: 'Replay onboarding', labelKey: 'settings:admin.replay.title', section: 'admin', adminOnly: true, superAdminOnly: true, keywords: ['intro', 'tour', 'onboarding'] },
  { slug: 'admin-panel', label: 'Admin Panel', labelKey: 'settings:admin.panel.title', section: 'admin', adminOnly: true, keywords: ['admin', 'dashboard'] },

  // ----- Danger Zone -----
  { slug: 'danger-delete', label: 'Delete Account', labelKey: 'settings:danger.delete.title', section: 'danger', keywords: ['remove', 'close account', 'permanent', 'delete'] },
] as const;

const SECTION_BY_ID = new Map<SettingsSectionId, SettingsSection>(
  SETTINGS_SECTIONS.map((s) => [s.id, s]),
);

/** Section metadata (label + icon) for a section id, for rendering search results. */
export function sectionMetaFor(id: SettingsSectionId): SettingsSection | undefined {
  return SECTION_BY_ID.get(id);
}

/** English section label for a section id (empty string if unknown). */
export function sectionLabelFor(id: SettingsSectionId): string {
  return SECTION_BY_ID.get(id)?.label ?? '';
}

/** Resolve a `?sr=` slug back to its index entry (for post-navigation highlight). */
export function settingsEntryBySlug(slug: string | null | undefined): SettingsSearchEntry | undefined {
  if (!slug) return undefined;
  return SETTINGS_SEARCH_INDEX.find((e) => e.slug === slug);
}

/**
 * Filter the index for a query. All whitespace-separated terms must match (AND);
 * a term matches on the label, the section label, or any keyword. Results are
 * ranked: label prefix > label substring > keyword/section match. Admin-only
 * rows are dropped for non-admins.
 *
 * `translate` (optional) resolves `labelKey`/`section.labelKey` so a localized
 * query matches the localized label too; the English label + keywords always
 * stay in the haystack so typing English keeps working in any locale.
 */
export function searchSettings(
  query: string,
  isAdmin: boolean,
  isSuperAdmin: boolean,
  translate?: (key: string) => string,
): SettingsSearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  const isNative = Capacitor.isNativePlatform();
  const scored: Array<{ entry: SettingsSearchEntry; score: number }> = [];
  for (const entry of SETTINGS_SEARCH_INDEX) {
    if (entry.adminOnly && !isAdmin) continue;
    if (entry.superAdminOnly && !isSuperAdmin) continue;
    if (entry.nativeOnly && !isNative) continue;
    const label = entry.label.toLowerCase();
    const localizedLabel = translate ? translate(entry.labelKey).toLowerCase() : '';
    const sectionMeta = sectionMetaFor(entry.section);
    const sectionLabel = (sectionMeta?.label ?? '').toLowerCase();
    const localizedSection =
      translate && sectionMeta ? translate(sectionMeta.labelKey).toLowerCase() : '';
    const keywords = (entry.keywords ?? []).map((k) => k.toLowerCase());
    const haystacks = [label, localizedLabel, sectionLabel, localizedSection, ...keywords].filter(
      Boolean,
    );

    let total = 0;
    let matchedAll = true;
    for (const term of terms) {
      if (label.startsWith(term) || (localizedLabel && localizedLabel.startsWith(term))) total += 6;
      else if (label.includes(term) || (localizedLabel && localizedLabel.includes(term))) total += 4;
      else if (sectionLabel.includes(term) || localizedSection.includes(term)) total += 2;
      else if (keywords.some((k) => k.includes(term))) total += 3;
      else if (haystacks.some((h) => h.includes(term))) total += 1;
      else {
        matchedAll = false;
        break;
      }
    }
    if (matchedAll) scored.push({ entry, score: total });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.entry.label.localeCompare(b.entry.label))
    .map((s) => s.entry);
}
