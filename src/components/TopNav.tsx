import { Capacitor } from '@capacitor/core';
import { memo, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate, useLocation, Link } from 'react-router';
import { cn } from '@/lib/utils';
import { LogIn, MessageCircle, Search, ShieldCheck, User } from 'lucide-react';
import { useChat } from '@/contexts/ChatContext';
import { useNavShell } from '@/contexts/NavShellContext';
import { useGlobalSearch } from '@/contexts/GlobalSearchContext';

function lastAdminStorageKey(userId: string): string {
  return `dc_last_admin_${userId}`;
}

interface TopNavProps {
  activeTab: 'campus' | 'map' | 'profile' | 'marketplace' | 'roommates' | 'guide';
  onTabChange: (tab: 'campus' | 'map' | 'profile') => void;
}

/**
 * Signed-in web top bar. Primary navigation lives elsewhere - AppSidebar at
 * `md+`, BottomNav below - so this bar carries the brand plus compact icon
 * links below `md` (messages / admin / profile). On the desktop app shell the
 * whole bar is hidden (`md:hidden`): the full-height AppSidebar carries the
 * brand and AppShellTopRight floats the bell + account menu. Native renders
 * nothing (below).
 */
const TopNavInner = memo(function TopNavInner({ activeTab, onTabChange }: TopNavProps) {
  const { t } = useTranslation();
  const { user, isAdmin, profileLoaded } = useAuth();

  const showAdminInNav = useMemo(() => {
    if (!user?.id) return false;
    if (isAdmin) return true;
    if (!profileLoaded) {
      try {
        return localStorage.getItem(lastAdminStorageKey(user.id)) === '1';
      } catch {
        return false;
      }
    }
    return false;
  }, [user?.id, isAdmin, profileLoaded]);

  useEffect(() => {
    if (!user?.id || !profileLoaded) return;
    try {
      localStorage.setItem(lastAdminStorageKey(user.id), isAdmin ? '1' : '0');
    } catch {
      /* private mode / disabled storage */
    }
  }, [user?.id, profileLoaded, isAdmin]);

  const { hasUnreadMessages } = useChat();
  const { isAppShell } = useNavShell();
  const { openSearch } = useGlobalSearch();
  const navigate = useNavigate();
  const location = useLocation();
  const isMessagesRoute =
    location.pathname === '/messages' || location.pathname.startsWith('/messages/');
  // An open thread (?conversation= / ?user= / ?group=) has its own header with
  // back + options on the right; the phone pill sat on top of that options
  // button (z-[1000]), so Report and Block were unreachable from a chat on
  // mobile. The conversation list keeps the pill.
  const isOpenThread =
    isMessagesRoute && /[?&](conversation|user|group)=/.test(location.search);

  const handleAuthClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (user) {
      onTabChange('profile');
    } else {
      navigate('/auth');
    }
  };

  return (
    // On the desktop app shell the bar disappears entirely (`md:hidden`) -
    // the full-height AppSidebar carries the brand and AppShellTopRight
    // floats the bell + account menu (Mercury-style chromeless canvas).
    // Mobile web (< md) keeps this bar for its icon links.
    //
    // `pointer-events-none` on the <nav> itself is load-bearing, not cosmetic. On
    // mobile this bar paints nothing but a gradient plus a right-hand glass pill,
    // yet the <nav> BOX still spans the full width and the whole
    // safe-area + h-12 band at z-[1000] - so with default pointer-events it
    // swallowed every tap in the top ~48px of the page. That is what made the
    // Messages back arrow (and any page control that scrolls into that band)
    // dead to touch. Interactivity is re-armed on the two things that actually
    // paint: the mobile pill (`pointer-events-auto`, below) and the md+ bar.
    <nav className={cn('pointer-events-none fixed top-0 z-[1000] w-full', isAppShell && 'md:hidden')}>
      {/* Mobile web (< md): iOS-style floating glass pill instead of the wordmark
          bar, so the app-in-a-browser matches the native shell. Content scrolls
          under it; primary nav lives in BottomNav. Mirrors NativeTopBar. */}
      {user && !isOpenThread && (
        <div className="pointer-events-none md:hidden pt-[env(safe-area-inset-top)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[calc(env(safe-area-inset-top)+0.5rem)] bg-gradient-to-b from-background via-background/70 to-transparent"
          />
          <div className="relative flex h-12 items-center px-3">
            <div className="glass-chrome pointer-events-auto ml-auto flex items-center gap-0.5 rounded-full border border-border/60 px-0.5 shadow-raised">
              {/* Search intentionally omitted on the mobile-web top bar — search is
                  desktop-only (sidebar + Cmd/Ctrl+K). See docs/CHANGELOG 2026-07-18. */}
              <Link
                to="/messages"
                className={cn(
                  'relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2 transition-colors',
                  isMessagesRoute ? 'text-malachite-600' : 'text-foreground hover:bg-accent',
                )}
                aria-label={hasUnreadMessages ? t('misc:topBar.messagesUnread') : t('misc:topBar.goToMessages')}
              >
                <MessageCircle className="h-6 w-6 shrink-0" strokeWidth={2} />
                {hasUnreadMessages && (
                  <span
                    className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background"
                    aria-hidden
                  />
                )}
              </Link>
              {showAdminInNav && (
                <Link
                  to="/admin"
                  className={cn(
                    'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2 transition-colors',
                    location.pathname.startsWith('/admin')
                      ? 'text-malachite-600'
                      : 'text-foreground hover:bg-accent',
                  )}
                  aria-label={t('misc:topBar.adminDashboard')}
                >
                  <ShieldCheck className="h-6 w-6 shrink-0" strokeWidth={2} />
                </Link>
              )}
              <button
                type="button"
                onClick={handleAuthClick}
                data-tour-id="nav-profile"
                className={cn(
                  'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2 transition-colors',
                  activeTab === 'profile'
                    ? 'bg-malachite-600/10 text-malachite-600'
                    : 'text-foreground hover:bg-accent',
                )}
                aria-label={t('common:labels.profile')}
              >
                <User className="h-6 w-6 shrink-0" strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      )}
      {/* md+ wordmark bar (desktop / non-app-shell contexts); hidden on mobile web. */}
      <div className="pointer-events-auto relative z-0 hidden w-full md:block">
        <div className="w-full border-b border-border bg-background pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-12 w-full max-w-[100rem] items-center px-3 sm:px-4 md:px-5 lg:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-12">
            <Link
              to="/"
              className="group flex shrink-0 items-center gap-2 text-xl leading-none"
            >
              <img
                src="/dormcheck-logo-new.png"
                alt=""
                draggable={false}
                className="h-7 w-7 shrink-0 object-contain select-none"
                onError={(e) => {
                  e.currentTarget.src = '/dormcheck-logo.png';
                }}
              />
              <img
                src="/dormcheck-logo-new.png"
                alt=""
                draggable={false}
                className="hidden h-7 w-7 shrink-0 object-contain select-none"
                onError={(e) => {
                  e.currentTarget.src = '/dormcheck-logo-dark.png';
                }}
              />
              <span className="brand-wordmark text-[19px]">DormCheck</span>
            </Link>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2 md:gap-4">
            {user ? (
              <>
                <div className="flex items-center gap-0.5 md:hidden">
                  <button
                    type="button"
                    onClick={(e) => openSearch({ returnFocusTo: e.currentTarget })}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2 text-foreground transition-colors hover:bg-accent"
                    aria-label={t('misc:search.openSearch')}
                  >
                    <Search className="h-6 w-6 shrink-0" strokeWidth={2} />
                  </button>
                  <Link
                    to="/messages"
                    className={cn(
                      'relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2 transition-colors',
                      isMessagesRoute ? 'text-malachite-600' : 'text-foreground hover:bg-accent',
                    )}
                    aria-label={hasUnreadMessages ? t('misc:topBar.messagesUnread') : t('misc:topBar.goToMessages')}
                  >
                    <MessageCircle className="h-6 w-6 shrink-0" strokeWidth={2} />
                    {hasUnreadMessages && (
                      <span
                        className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background"
                        aria-hidden
                      />
                    )}
                  </Link>
                  {showAdminInNav && (
                    <Link
                      to="/admin"
                      className={cn(
                        'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2 transition-colors',
                        location.pathname.startsWith('/admin')
                          ? 'text-malachite-600'
                          : 'text-foreground hover:bg-accent',
                      )}
                      aria-label={t('misc:topBar.adminDashboard')}
                    >
                      <ShieldCheck className="h-6 w-6 shrink-0" strokeWidth={2} />
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={handleAuthClick}
                    data-tour-id="nav-profile"
                    className={cn(
                      'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2 transition-colors',
                      activeTab === 'profile'
                        ? 'bg-malachite-600/10 text-malachite-600'
                        : 'text-foreground hover:bg-accent',
                    )}
                    aria-label={t('common:labels.profile')}
                  >
                    <User className="h-6 w-6 shrink-0" strokeWidth={2} />
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={handleAuthClick}
                className="rounded-full bg-malachite-800 px-6 py-2.5 text-sm font-bold text-white shadow-raised transition-transform hover:-translate-y-0.5"
              >
                <LogIn className="-mt-0.5 mr-2 inline h-4 w-4" />
                {t('common:actions.signIn')}
              </button>
            )}
          </div>
          </div>
        </div>
      </div>
    </nav>
  );
});

export const TopNav = memo(function TopNav(props: TopNavProps) {
  if (Capacitor.isNativePlatform()) return null;
  return <TopNavInner {...props} />;
});
