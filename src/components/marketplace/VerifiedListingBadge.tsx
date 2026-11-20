import { BadgeCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * Listing-level trust badge (P0.7): renders only when the listing has an
 * admin-approved verification (marketplace_listings.verified_at set by the
 * listing_verifications review trigger, migration 20260712140000).
 */
export function VerifiedListingBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground',
        className,
      )}
    >
      <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {t('marketplace:badge.verifiedListing')}
    </span>
  );
}
