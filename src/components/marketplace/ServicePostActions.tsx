import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useServicePostActions } from '@/hooks/useServicePostActions';
import { canClaimServicePost, canCompleteServicePost } from '@/lib/servicePosts';

const FOCUS_RING = 'focus-visible:ring-malachite-600 focus-visible:ring-offset-2';

/**
 * The open -> claimed -> completed controls on a service post.
 *
 * One button at a time, because there is only ever one move available: a peer
 * claims an open post, and either side marks a claimed one done. Both go
 * through the RPCs (see useServicePostActions) — these checks decide what to
 * render, never what is allowed.
 *
 * Nothing here settles up. "Done" records that the help happened and unlocks
 * the EXISTING seller rating; it does not reference, request or track money.
 */
export function ServicePostActions({
  listing,
  className,
}: {
  listing: {
    id: string;
    user_id: string;
    status?: string | null;
    post_type?: string | null;
    claimed_by?: string | null;
  };
  className?: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { claim, complete, pendingId } = useServicePostActions();
  const busy = pendingId === listing.id;

  /**
   * The transition the caller has not seen yet.
   *
   * The RPCs invalidate the FEED query, but this component is usually rendered
   * inside the detail sheet off a listing the parent captured when the card was
   * tapped — so a successful claim left "I can help" on screen and a second tap
   * earned "This post is no longer open." The row this component shows is the
   * one thing it can always be sure of: it just wrote it.
   */
  const [applied, setApplied] = useState<{ status: string; claimed_by?: string | null } | null>(null);
  useEffect(() => {
    setApplied(null);
  }, [listing.id, listing.status]);
  const current = applied ? { ...listing, ...applied } : listing;

  const canClaim = canClaimServicePost(current, user?.id);
  const canComplete = canCompleteServicePost(current, user?.id);

  if (canClaim) {
    return (
      <Button
        onClick={() =>
          void claim(listing.id, () => setApplied({ status: 'claimed', claimed_by: user?.id ?? null }))
        }
        disabled={busy}
        aria-label={t('marketplace:service.claimAria')}
        className={cn(
          // KEEP: primary action of a service post. malachite-800 for AA on white.
          // dark: was malachite-700 — 4.22:1 under white text, below the 4.5 AA floor.
          'min-h-[44px] bg-malachite-800 font-medium text-white hover:bg-malachite-800 active:bg-malachite-800 disabled:opacity-50 sm:min-h-0 dark:bg-malachite-800',
          FOCUS_RING,
          className,
        )}
      >
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t('marketplace:service.claim')}
      </Button>
    );
  }

  if (canComplete) {
    return (
      <Button
        variant="outline"
        onClick={() => void complete(listing.id, () => setApplied({ status: 'completed' }))}
        disabled={busy}
        aria-label={t('marketplace:service.completeAria')}
        className={cn('min-h-[44px] sm:min-h-0', FOCUS_RING, className)}
      >
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {t('marketplace:service.complete')}
      </Button>
    );
  }

  // Nothing to do: say which, rather than leaving a silent gap where a button was.
  if (current.status === 'claimed') {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        {current.claimed_by && current.claimed_by === user?.id
          ? t('marketplace:service.claimed')
          : t('marketplace:service.claimedByOther')}
      </p>
    );
  }
  if (current.status === 'completed') {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        {t('marketplace:service.status.completed')}
      </p>
    );
  }
  return null;
}
