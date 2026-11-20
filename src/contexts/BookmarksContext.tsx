import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  BOOKMARKS_STORAGE_KEY,
  normalizeBookmarks,
  readStoredBookmarks,
  writeStoredBookmarks,
  type Bookmark,
} from '@/lib/bookmarks';

type BookmarksContextValue = {
  bookmarks: Bookmark[];
  isBookmarked: (path: string) => boolean;
  /** Add the entry if its path isn't bookmarked, otherwise remove it. */
  toggle: (entry: Bookmark) => void;
  remove: (path: string) => void;
};

const BookmarksContext = createContext<BookmarksContextValue | null>(null);

/**
 * Per-user page bookmarks for the desktop sidebar. Two-tier persistence
 * (mirrors ThemeContext): a localStorage cache for instant load + a debounced
 * write-through to profiles.app_bookmarks so bookmarks sync across devices.
 * Safe when signed out (empty list, no writes).
 */
export function BookmarksProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => readStoredBookmarks());
  // Set once the user changes bookmarks this session; guards the profile loader
  // from clobbering a just-made change.
  const localChangeRef = useRef(false);

  const toggle = useCallback(
    (entry: Bookmark) => {
      setBookmarks((prev) => {
        const exists = prev.some((b) => b.path === entry.path);
        const next = exists
          ? prev.filter((b) => b.path !== entry.path)
          : [...prev, entry];
        localChangeRef.current = true;
        writeStoredBookmarks(next);
        return next;
      });
    },
    [],
  );

  const remove = useCallback(
    (path: string) => {
      setBookmarks((prev) => {
        const next = prev.filter((b) => b.path !== path);
        localChangeRef.current = true;
        writeStoredBookmarks(next);
        return next;
      });
    },
    [],
  );

  const isBookmarked = useCallback(
    (path: string) => bookmarks.some((b) => b.path === path),
    [bookmarks],
  );

  // Cross-tab sync: another tab changed the list.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== BOOKMARKS_STORAGE_KEY) return;
      try {
        setBookmarks(normalizeBookmarks(e.newValue ? JSON.parse(e.newValue) : []));
      } catch {
        // ignore malformed cross-tab payloads
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // On sign-in, adopt the list saved on the profile (unless the user already
  // changed bookmarks on this device this session).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void supabase
      .from('profiles')
      .select('app_bookmarks')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || localChangeRef.current) return;
        const raw = (data as { app_bookmarks: unknown } | null)?.app_bookmarks;
        const next = normalizeBookmarks(raw);
        setBookmarks(next);
        writeStoredBookmarks(next);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Write-through: persist the user's list on their profile (debounced).
  useEffect(() => {
    if (!user?.id || !localChangeRef.current) return;
    const timer = setTimeout(() => {
      void supabase
        .from('profiles')
        // Cast: types.ts intentionally lags the app_bookmarks migration.
        .update({ app_bookmarks: bookmarks } as never)
        .eq('id', user.id)
        .then(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [bookmarks, user?.id]);

  const value = useMemo(
    () => ({ bookmarks, isBookmarked, toggle, remove }),
    [bookmarks, isBookmarked, toggle, remove],
  );

  return <BookmarksContext.Provider value={value}>{children}</BookmarksContext.Provider>;
}

/** Safe outside the provider (native / marketing trees): empty, no-op. */
export function useBookmarks(): BookmarksContextValue {
  const ctx = useContext(BookmarksContext);
  return (
    ctx ?? {
      bookmarks: [],
      isBookmarked: () => false,
      toggle: () => {},
      remove: () => {},
    }
  );
}
