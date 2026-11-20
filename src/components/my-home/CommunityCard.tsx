import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight, MessagesSquare } from 'lucide-react';
import { useCurrentUserBuilding } from '@/hooks/useCurrentUserBuilding';
import { useCommunityUnread } from '@/hooks/useCommunityRooms';
import { cn } from '@/lib/utils';

/**
 * Persistent Community entry point on My Home - the door to the resident's
 * building + floor rooms. Replaces the old one-time BuildingChatJoinPrompt:
 * no dismissal state, always findable. Renders nothing only when the user has
 * no resolved building (Community's own empty state handles that path).
 */
export function CommunityCard({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { building } = useCurrentUserBuilding();
  const { unreadCount, hasUnread } = useCommunityUnread();

  if (!building) return null;

  return (
    <Link
      to="/community"
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-raised transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600',
        className,
      )}
      aria-label={
        hasUnread
          ? t('messaging:community.cardAriaUnread', { building: building.residenceHallName, count: unreadCount })
          : t('messaging:community.cardAria', { building: building.residenceHallName })
      }
    >
      <div className="shrink-0 p-2 text-muted-foreground" aria-hidden>
        <MessagesSquare className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {t('messaging:community.cardTitle')}
          </h3>
          {hasUnread && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-bold text-background" aria-hidden>
              {unreadCount}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {t('messaging:community.cardBody', { building: building.residenceHallName })}
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
