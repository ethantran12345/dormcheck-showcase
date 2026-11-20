import { Flag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VerifiedListingBadge } from '@/components/marketplace/VerifiedListingBadge';

export type StructuredField = {
  /** Already-translated label. Structured fields are typed data, never prose. */
  label: string;
  value: string;
};

/**
 * The trust layer every marketplace card type shares.
 *
 * Spec: vault `dormcheck/Reviews Subleases Services PRD.md` §5 Phase 2 — "one
 * trust layer, shared component. Verified badge, structured field block, report
 * action. Identical across all four types."
 *
 * The reasoning is defensive, not cosmetic: scams read as scams partly because
 * they look DIFFERENT from what surrounds them, so a sublease card and an item
 * card may differ in shape but must never differ in chrome. Keeping this in one
 * component is what makes that property hold as types are added — a new card
 * gets the badge, the field block and the report affordance by construction
 * rather than by whoever wrote it remembering.
 *
 * Renders nothing at all when given nothing, so a card that has no verification,
 * no status and no structured fields is byte-identical to one that never called
 * it.
 */
export function ListingTrustChrome({
  status,
  verified,
  fields = [],
  onReport,
  reportAriaLabel,
  className,
}: {
  /** Listing status; only `pending` is surfaced (sold/expired leave the feed). */
  status?: string | null;
  verified?: boolean;
  /** Typed field pairs (dates, rent, duration…). Free text does not belong here. */
  fields?: StructuredField[];
  /** Omitted for a viewer who cannot report (own listing, or a card whose report
   *  action lives in the detail view instead). */
  onReport?: () => void;
  reportAriaLabel?: string;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <>
      {fields.length > 0 && (
        <dl className={cn('flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground', className)}>
          {fields.map((field) => (
            <div key={field.label} className="flex min-w-0 items-baseline gap-1">
              <dt className="shrink-0 font-medium text-muted-foreground">{field.label}</dt>
              <dd className="min-w-0 truncate text-foreground">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {status === 'pending' && (
        <span className="inline-flex w-fit items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
          {t('housing:portal.marketplace.status.pending')}
        </span>
      )}
      {verified && <VerifiedListingBadge className="px-1.5 text-xs" />}
      {onReport && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={reportAriaLabel ?? t('marketplace:trust.reportAria')}
          onClick={(e) => {
            e.stopPropagation();
            onReport();
          }}
          className="h-6 w-fit gap-1 rounded-pill px-1.5 text-xs font-medium text-muted-foreground [&_svg]:size-3 [&_svg]:text-muted-foreground"
        >
          <Flag className="shrink-0" aria-hidden />
          {t('marketplace:trust.report')}
        </Button>
      )}
    </>
  );
}
