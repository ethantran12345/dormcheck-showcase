import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/hooks/useAuth';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useRoommateGroup, type RoommateGroupMember } from '@/hooks/useRoommateGroup';
import { cn } from '@/lib/utils';

function initials(name: string | null): string {
  if (!name?.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

/** Members with self first, so "you" anchors the cluster on every surface. */
function orderMembers(members: RoommateGroupMember[], selfId: string | null): RoommateGroupMember[] {
  if (!selfId) return members;
  return [...members].sort((a, b) => (a.id === selfId ? -1 : 0) - (b.id === selfId ? -1 : 0));
}

export interface RoommatePresenceChipProps {
  /**
   * `hero` - My Home strip (avatars + names line);
   * `compact` - dense chip for toolbars (avatars only);
   * `sidebar` - desktop AppSidebar row (avatars + label, icon-only when collapsed).
   */
  variant?: 'hero' | 'compact' | 'sidebar';
  collapsed?: boolean;
  className?: string;
}

/**
 * Persistent "us" identity: the confirmed roommate group's avatar cluster,
 * linking to the Roommate Hub. Self-contained - renders nothing while loading,
 * when the flag is off, or when the user has no accepted roommate group with
 * at least one confirmed roommate (so users without a group see zero chrome).
 */
export function RoommatePresenceChip({ variant = 'compact', collapsed = false, className }: RoommatePresenceChipProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { showConfirmedRoommates } = useFeatureFlags();
  const { roommateGroup } = useRoommateGroup(showConfirmedRoommates ? user?.id : null);

  if (!showConfirmedRoommates || !roommateGroup || roommateGroup.members.length < 2) return null;

  const members = orderMembers(roommateGroup.members, user?.id ?? null);
  const shown = members.slice(0, 4);
  const overflow = members.length - shown.length;
  const others = members.filter((m) => m.id !== user?.id);
  const label =
    roommateGroup.groupName?.trim() ||
    (others.length === 1
      ? t('roommates:presence.youAndOne', { name: (others[0].full_name ?? '').split(/\s+/)[0] || t('roommates:presence.roommate') })
      : t('roommates:presence.youAndN', { count: others.length }));

  const avatarSize = variant === 'hero' ? 'h-8 w-8' : 'h-6 w-6';
  const cluster = (
    <span className="flex shrink-0 items-center">
      <span className="flex -space-x-2">
        {shown.map((m) => (
          <Avatar key={m.id} className={cn(avatarSize, 'border-2 border-background ring-1 ring-border')}>
            <AvatarImage src={m.avatar_url ?? undefined} />
            <AvatarFallback className="bg-muted text-[9px] text-muted-foreground">
              {initials(m.full_name)}
            </AvatarFallback>
          </Avatar>
        ))}
      </span>
      {overflow > 0 ? (
        <span className="ml-1 text-[10px] font-medium text-muted-foreground">+{overflow}</span>
      ) : null}
    </span>
  );

  if (variant === 'sidebar') {
    return (
      <Link
        to="/roommates/us"
        aria-label={t('roommates:presence.openHub')}
        className={cn(
          'flex items-center gap-2.5 rounded-lg py-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1',
          collapsed ? 'justify-center px-0' : 'px-3',
          className,
        )}
      >
        {cluster}
        {!collapsed && <span className="min-w-0 truncate">{label}</span>}
      </Link>
    );
  }

  // Hero (My Home): a full-width row card in the same system as the stat tiles -
  // avatar cluster + group name + caption on the left, chevron into the hub on
  // the right. No longer a small floating pill that reads as hidden chrome.
  if (variant === 'hero') {
    return (
      <Link
        to="/roommates/us"
        aria-label={t('roommates:presence.openHub')}
        className={cn(
          'group flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card p-3.5 shadow-raised transition-[transform,box-shadow] duration-200 ease-ios motion-safe:hover:-translate-y-0.5 hover:shadow-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1 lg:p-4',
          className,
        )}
      >
        {cluster}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {t('roommates:presence.groupCaption')}
          </span>
        </span>
        <ChevronRight
          className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    );
  }

  return (
    <Link
      to="/roommates/us"
      aria-label={t('roommates:presence.openHub')}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-2 shadow-raised transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1',
        className,
      )}
    >
      {cluster}
    </Link>
  );
}
