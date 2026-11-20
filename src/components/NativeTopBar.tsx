import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { Bell, MessageCircle, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useChat } from '@/contexts/ChatContext';
import { useNotifications } from '@/hooks/useNotifications';
import { useScrollEngagement } from '@/contexts/ScrollEngagementContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { getFirstNameInitial } from '@/lib/profileDisplay';
import { safeImageSrc } from '@/lib/sanitize';

const MotionLink = motion.create(Link);

// Match the bottom nav's glass exactly so the top-right pill and the bottom bar
// read as one material. Rest tint 0.72 (BottomNav REST_GLASS); solidify-on-scroll
// to 0.62 + saturate 1.7 (BottomNav ENGAGED_GLASS). The frosted 28px blur is
// retired (defaults: blur 5px / saturate 1.4), same as the bottom bar.
const TOPBAR_REST_GLASS = {
  '--glass-opacity': '0.72',
} as CSSProperties;
const TOPBAR_ENGAGED_GLASS = {
  '--glass-opacity': '0.62',
  '--glass-saturate': '1.7',
} as CSSProperties;

export function NativeTopBar() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { hasUnreadMessages } = useChat();
  const { unreadNotificationCount } = useNotifications();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const { engaged: scrollEngaged } = useScrollEngagement();

  const { data: profileRow } = useQuery({
    queryKey: ['native_top_bar_profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      return data as { full_name: string | null; avatar_url: string | null } | null;
    },
    enabled: !!user?.id,
  });

  if (!user) return null;

  // Avatars come only from profiles.avatar_url (manual upload) — never OAuth
  // provider metadata; without one we show initials.
  const avatarSrc = profileRow?.avatar_url || '';
  const displayName =
    profileRow?.full_name?.trim() ||
    user.email?.split('@')[0] ||
    'Student';
  const initial = getFirstNameInitial(displayName);

  const isMessagesRoute =
    location.pathname === '/messages' || location.pathname.startsWith('/messages/');
  const isNotificationsRoute = location.pathname === '/notifications';
  const isProfileRoute = location.pathname === '/profile' || location.pathname.startsWith('/profile/');
  // The avatar now opens the canonical /settings surface (the old /account menu
  // redirects there); keep /account in the active check for any lingering deep link.
  const isAccountRoute =
    location.pathname.startsWith('/settings') ||
    location.pathname === '/account' ||
    location.pathname.startsWith('/account/');
  const isAdminRoute = location.pathname.startsWith('/admin');
  // Full-bleed map routes should stay clean to the very top - no fade greying the map.
  const isImmersiveMapRoute =
    location.pathname === '/housing' ||
    location.pathname === '/subleases' ||
    location.pathname === '/map' ||
    location.pathname.startsWith('/campus');
  return (
    <header className="pointer-events-none fixed top-0 left-0 right-0 z-[10052] pt-[env(safe-area-inset-top)]">
      {/* Short, light fade over the status-bar area only - every page now renders its own
          title as scrolling content (it slides away under the pill), so we keep the top
          clear like Home instead of greying a band behind a fixed title. Skipped on
          full-bleed map routes so the map reaches the very top. */}
      {!isImmersiveMapRoute && (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[calc(env(safe-area-inset-top)+0.5rem)] bg-gradient-to-b from-background via-background/70 to-transparent"
      />
      )}
      <div className="relative flex h-12 items-center gap-2 px-3">{/* title now lives in page content */}
        <div
          style={scrollEngaged ? TOPBAR_ENGAGED_GLASS : TOPBAR_REST_GLASS}
          className="glass-chrome pointer-events-auto ml-auto flex items-center gap-0.5 rounded-full border border-border/60 px-0.5 shadow-raised"
        >
        {/* Search intentionally omitted on the native/mobile top bar — search lives
            on desktop only (sidebar + Cmd/Ctrl+K). See docs/CHANGELOG 2026-07-18. */}
        <MotionLink
          to="/messages"
          whileTap={reduceMotion ? undefined : { scale: 0.92 }}
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
        </MotionLink>

        <MotionLink
          to="/notifications"
          whileTap={reduceMotion ? undefined : { scale: 0.92 }}
          className={cn(
            'relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2 transition-colors',
            isNotificationsRoute ? 'text-malachite-600' : 'text-foreground hover:bg-accent',
          )}
          aria-label={
            unreadNotificationCount > 0
              ? t('misc:topBar.notificationsUnread', { n: unreadNotificationCount })
              : t('misc:topBar.goToNotifications')
          }
        >
          <Bell className="h-6 w-6 shrink-0" strokeWidth={2} />
          {unreadNotificationCount > 0 && (
            <span
              className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-background"
              aria-hidden
            />
          )}
        </MotionLink>

        <MotionLink
          to="/settings"
          data-tour-id="nav-profile"
          whileTap={reduceMotion ? undefined : { scale: 0.92 }}
          className={cn(
            'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-1.5 transition-colors',
            isAccountRoute || isProfileRoute || isAdminRoute
              ? 'ring-2 ring-malachite-600/30'
              : 'hover:bg-accent',
          )}
          aria-label={t('misc:topBar.openAccountMenu')}
        >
          <Avatar className="h-8 w-8 overflow-hidden rounded-full">
            <AvatarImage
              src={safeImageSrc(avatarSrc) ?? undefined}
              alt=""
              className="object-cover"
            />
            <AvatarFallback className="rounded-full bg-malachite-800 text-sm font-semibold text-white">
              {initial ?? <User className="h-4 w-4" strokeWidth={2} aria-hidden />}
            </AvatarFallback>
          </Avatar>
        </MotionLink>
        </div>
      </div>
    </header>
  );
}
