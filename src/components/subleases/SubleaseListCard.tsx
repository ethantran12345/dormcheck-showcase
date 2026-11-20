import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatRent, formatSubleaseRange } from '@/lib/subleases';
import type { SubleaseMapListing } from '@/hooks/useSubleaseMapListings';

/**
 * One sublease in the map's list.
 *
 * Everything on this card is a typed column — building, rent, dates. That is the
 * rule src/lib/subleases.ts opens with and it is why the card has no description
 * line: `house_rules`/`additional_rules` are the only free text a sublease carries
 * and they render last, in the detail view, never in the position a student reads
 * first. The headline is the BUILDING, which for a pinned row is the registry
 * row's own name and for a pre-registry row is the name copied onto the listing.
 */
export function SubleaseListCard({
  listing,
  buildingName,
  onOpen,
}: {
  listing: SubleaseMapListing;
  /**
   * The building label to show. Passed in rather than derived so a grouped card
   * and an unmapped card read from one decision made by the caller.
   */
  buildingName: string;
  onOpen: (listing: SubleaseMapListing) => void;
}) {
  const { t } = useTranslation();
  const range = formatSubleaseRange(listing.sublease_start, listing.sublease_end);

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onOpen(listing)}
      // The glyph tint is stated in the SAME descendant group Button's base uses
      // ([&_svg]:text-current), not as a bare class on the icon — a utility on the
      // svg loses that specificity fight silently. See scripts/check-glyphs.mjs.
      className="h-auto w-full justify-between gap-3 rounded-card border border-border bg-card px-3 py-3 text-left [&_svg]:text-muted-foreground"
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-semibold text-foreground">{buildingName}</span>
        {range ? (
          <span className="truncate text-xs font-normal text-muted-foreground">{range}</span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <span className="flex flex-col items-end">
          <span className="text-sm font-semibold text-malachite-800 dark:text-malachite-400">
            {formatRent(listing.price)}
          </span>
          <span className="text-[11px] font-normal text-muted-foreground">
            {t('marketplace:subleaseMap.perMonth')}
          </span>
        </span>
        <ChevronRight aria-hidden />
      </span>
    </Button>
  );
}
