import {
  Home,
  ClipboardCheck,
  ShoppingBag,
  Building2,
  Users,
  LifeBuoy,
  MessageCircle,
  Settings,
  User,
  CalendarDays,
  Bookmark,
  type LucideIcon,
} from 'lucide-react';

/**
 * Mercury-style page bookmarks for the signed-in desktop web sidebar. A user
 * pins app pages from each page's title toggle; they render in the sidebar's
 * "Bookmarks" section. Persisted per-user (localStorage cache + a debounced
 * write-through to profiles.app_bookmarks). Desktop web only.
 */

export type BookmarkIconKey =
  | 'home'
  | 'checklist'
  | 'marketplace'
  | 'housing'
  | 'roommates'
  | 'resources'
  | 'messages'
  | 'settings'
  | 'profile'
  | 'schedule'
  | 'bookmark';

/** Serializable icon key → lucide component. Keys are stored in jsonb so the
 *  icon survives a round-trip (we never persist a React component). */
export const BOOKMARK_ICONS: Record<BookmarkIconKey, LucideIcon> = {
  home: Home,
  checklist: ClipboardCheck,
  marketplace: ShoppingBag,
  housing: Building2,
  roommates: Users,
  resources: LifeBuoy,
  messages: MessageCircle,
  settings: Settings,
  profile: User,
  schedule: CalendarDays,
  bookmark: Bookmark,
};

export interface Bookmark {
  /** Canonical pathname the bookmark links to (tabs collapse to the base page). */
  path: string;
  label: string;
  icon: BookmarkIconKey;
}

export const BOOKMARKS_STORAGE_KEY = 'dc_bookmarks';

/**
 * Canonical bookmark entry for the page at `pathname`, reusing the sidebar's
 * labels/icons. Returns null for routes that shouldn't be bookmarkable
 * (auth/onboarding/admin/unknown). `titleOverride` lets a detail page store a
 * specific label (e.g. a dorm or guide name) instead of the generic one.
 */
export function resolveBookmarkMeta(
  pathname: string,
  opts?: { titleOverride?: string; universityShortName?: string },
): Bookmark | null {
  const title = opts?.titleOverride?.trim();
  const make = (path: string, label: string, icon: BookmarkIconKey): Bookmark => ({
    path,
    label: title || label,
    icon,
  });

  if (pathname === '/my-home') return make('/my-home', 'My Home', 'home');
  if (pathname === '/checklist') return make('/checklist', 'Checklist', 'checklist');
  if (pathname.startsWith('/marketplace')) return make('/marketplace', 'Marketplace', 'marketplace');
  if (pathname === '/schedule') return make('/schedule', 'Schedule', 'schedule');
  if (
    pathname.startsWith('/housing') ||
    pathname.startsWith('/campus') ||
    pathname.startsWith('/gallery')
  ) {
    // Detail pages keep their own pathname so each dorm bookmarks distinctly.
    const detail = pathname !== '/housing' && pathname !== '/campus';
    return make(detail ? pathname : '/housing', 'Housing', 'housing');
  }
  if (pathname.startsWith('/roommates')) return make('/roommates', 'Roommates', 'roommates');
  if (pathname === '/messages') return make('/messages', 'Messages', 'messages');
  if (pathname.startsWith('/settings')) return make('/settings', 'Settings', 'settings');
  if (pathname === '/profile') return make('/profile', 'Profile', 'profile');
  return null;
}

function isValidBookmark(v: unknown): v is Bookmark {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.path === 'string' &&
    typeof b.label === 'string' &&
    typeof b.icon === 'string' &&
    b.icon in BOOKMARK_ICONS
  );
}

/** Coerce arbitrary persisted data into a clean, deduped Bookmark[]. */
export function normalizeBookmarks(raw: unknown): Bookmark[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Bookmark[] = [];
  for (const item of raw) {
    if (!isValidBookmark(item) || seen.has(item.path)) continue;
    seen.add(item.path);
    out.push({ path: item.path, label: item.label, icon: item.icon });
  }
  return out;
}

export function readStoredBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    return raw ? normalizeBookmarks(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function writeStoredBookmarks(bookmarks: Bookmark[]): void {
  try {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(bookmarks));
  } catch {
    // ignore storage errors
  }
}
