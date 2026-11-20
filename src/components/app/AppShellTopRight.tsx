import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChat } from '@/contexts/ChatContext';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NotificationsBell } from '@/components/app/NotificationsBell';
import { ProfileMenu } from '@/components/app/ProfileMenu';

/**
 * Desktop app shell's floating top-right cluster: messages + notifications
 * bell + account menu, pinned over the chromeless strip where the top bar used
 * to be (Mercury-style - the bar itself is `md:hidden` in TopNav; AppSidebar
 * carries the brand). Hidden below `md`, where the mobile top bar still
 * renders. Messages lives here, not in the sidebar, mirroring Mercury.
 */
export function AppShellTopRight() {
  const { t } = useTranslation();
  const { hasUnreadMessages } = useChat();
  const { pathname } = useLocation();
  const isMessagesRoute = pathname === '/messages' || pathname.startsWith('/messages/');

  return (
    <div className="fixed right-4 top-2.5 z-[950] hidden items-center gap-1 rounded-full border border-border bg-background/85 px-1.5 py-1 shadow-raised backdrop-blur supports-[backdrop-filter]:bg-background/70 md:flex">
      {/* P8.4: the bell and the profile chip name themselves on hover; this
          icon-only link was the odd one out in the same cluster. The tooltip is
          purely additive - the control is already visible and already carries its
          aria-label, so nothing is hidden behind hover. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to="/messages"
            aria-label={hasUnreadMessages ? t('misc:topBar.messagesUnread') : t('misc:topBar.goToMessages')}
            className={cn(
              'relative inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600',
              isMessagesRoute
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            <MessageCircle className="h-5 w-5" strokeWidth={2} aria-hidden />
            {hasUnreadMessages && (
              <span
                className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-background"
                aria-hidden
              />
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {hasUnreadMessages ? t('misc:topBar.messagesUnread') : t('misc:topBar.goToMessages')}
        </TooltipContent>
      </Tooltip>
      <NotificationsBell />
      <ProfileMenu />
    </div>
  );
}
