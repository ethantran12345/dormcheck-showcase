import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Dorm } from '@/types';
import {
  getAudienceBadgeClassName,
  getDormCardHeaderBadges,
  getDormCardRoomConfigBadges,
  toRoomTypeDisplayLabel,
} from '@/lib/dormUtils';
import { Heart, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { safeImageSrc } from '@/lib/sanitize';
import { useNavigate } from 'react-router';

interface DormCardProps {
  dorm: Dorm;
  audienceTag?: string; // deprecated; derived from dorm
  onClick: () => void;
  isSaved?: boolean;
  onToggleSave?: (dormId: string) => void;
  isLoggedIn?: boolean;
  /** When set, shows a CTA link; use in split view. ctaLabel customizes the text (e.g. "Show on map"). */
  onViewDetails?: () => void;
  /** CTA label when onViewDetails is set. Default "View details →". Use "Show on map" in explore split view. */
  ctaLabel?: string;
  /** When true, uses more compact styling for 2-column grids. */
  compact?: boolean;
  /** Mobile explore sheet list: shorter image and tighter spacing (does not affect compact/desktop). */
  dense?: boolean;
  /** Map/list selection: neutral border and shadow only (no brand-colored ring). */
  isHighlighted?: boolean;
  /** Hide the map/details CTA on small screens (e.g. when a floating “Show Map” control exists). */
  hideMapCtaOnMobile?: boolean;
  /** This is the signed-in user's current hall: show a "Your hall" badge instead of a neutral card. */
  isYourHall?: boolean;
}

// Consistent icon size for the favorite heart
const ICON_SIZE = 'w-5 h-5';
const DENSE_ICON_SIZE = 'w-4 h-4';

function DormCardComponent({
  dorm,
  onClick,
  isSaved = false,
  onToggleSave,
  isLoggedIn = false,
  onViewDetails,
  ctaLabel = 'View details →',
  compact: _compact = false,
  dense = false,
  isHighlighted = false,
  hideMapCtaOnMobile = false,
  isYourHall = false,
}: DormCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleHeartClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!isLoggedIn) {
      navigate('/auth');
      return;
    }
    
    onToggleSave?.(dorm.id);
  };

  const roomConfigBadges = getDormCardRoomConfigBadges(dorm);
  const { audienceBadge, housingBadge } = getDormCardHeaderBadges(dorm);

  const iconSize = dense ? DENSE_ICON_SIZE : ICON_SIZE;

  return (
    // Click-to-open stays on the container for mouse users; keyboard/AT activation lives on
    // the title button below (role="button" here would nest the save button inside an
    // interactive element - invalid ARIA).
    <div
      onClick={onClick}
      role="presentation"
      className={cn(
        'h-full flex flex-col min-h-0 w-full min-w-0 overflow-hidden text-left cursor-pointer rounded-xl border bg-card shadow-raised transition-all animate-fade-in',
        'hover:shadow-overlay',
        isHighlighted ? 'border-border shadow-raised hover:border-border' : 'border-border hover:border-border',
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
      )}
    >
      {/* Hero Image */}
      <div
        className={cn(
          'relative w-full shrink-0 overflow-hidden bg-muted rounded-t-xl',
          dense ? 'h-[156px]' : 'aspect-[4/3]',
        )}
      >
        <img
          src={safeImageSrc(dorm.image) || '/placeholder.svg'}
          alt={dorm.name || 'Dorm'}
          className="absolute top-0 left-0 w-full h-full object-cover object-center"
          onError={(e) => {
            e.currentTarget.src = '/placeholder.svg';
          }}
        />
        {isYourHall && (
          <span className="absolute left-2 top-2 z-10 rounded-full bg-malachite-800 px-2.5 py-0.5 text-xs font-semibold text-white shadow-raised">
            {t('housing:card.yourHall')}
          </span>
        )}
        {/* Subtle 2% black overlay at bottom for text/icon contrast */}
        <div
          className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/[0.02] to-transparent pointer-events-none"
          aria-hidden
        />
      </div>

      {/* Content - flex-1 + mt-auto bottom block so grid rows share equal height */}
      <div className={cn('flex flex-1 flex-col min-h-0', dense ? 'px-3 py-2.5' : 'p-4')}>
        <div className="flex items-start justify-between gap-2">
          <h3
            className={cn(
              'font-semibold text-foreground tracking-tight min-w-0 leading-tight',
              dense ? 'text-sm truncate' : 'text-base',
            )}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
              className="text-left focus-visible:outline-none"
            >
              {dorm.name || 'Building'}
            </button>
          </h3>
          <button
            type="button"
            onClick={handleHeartClick}
            aria-label={isSaved ? t('housing:card.ariaRemoveFromSaved') : t('housing:card.ariaSaveDorm')}
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent',
              dense ? 'h-7 w-7' : 'h-8 w-8',
            )}
          >
            <Heart
              className={cn(
                iconSize,
                'transition-colors duration-200',
                isSaved ? 'text-[#FF6B6B] fill-[#FF6B6B]' : 'text-muted-foreground fill-none stroke-muted-foreground',
              )}
              strokeWidth={isSaved ? 0 : 1.5}
            />
          </button>
        </div>
        <div className={cn('text-left shrink-0', dense ? 'mt-0.5' : 'mt-1')}>
          {(dorm.semesterRate ?? 0) > 0 ? (
            <>
              <p className={cn('font-semibold text-malachite-800', dense ? 'text-xs' : 'text-sm')}>
                {(dorm.minRate != null && dorm.minRate > 0) && <span>{t('housing:card.pricePrefix')}</span>}
                ${(dorm.semesterRate ?? 0).toLocaleString()}
              </p>
              <p className={cn('text-muted-foreground', dense ? 'text-[11px]' : 'text-xs')}>
                {dorm.rentPeriod === 'month' ? t('housing:card.perMonth') : t('housing:card.perSemester')}
              </p>
            </>
          ) : (
            <p className={cn('font-medium text-muted-foreground', dense ? 'text-xs' : 'text-sm')}>
              Rate not published
            </p>
          )}
        </div>

        <div className={cn('mt-auto flex flex-col min-h-0', dense ? 'pt-1.5' : 'pt-2')}>
          <div className={cn('flex flex-wrap items-center', dense ? 'gap-1' : 'gap-1.5')}>
            <span
              className={cn(
                'font-medium rounded-full',
                getAudienceBadgeClassName(dorm),
                dense ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs',
              )}
            >
              {audienceBadge}
            </span>
            <span
              className={cn(
                'font-medium rounded-full bg-muted text-muted-foreground',
                dense ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs',
              )}
            >
              {housingBadge}
            </span>
            {roomConfigBadges.badges.map((label) => (
              <span
                key={label}
                className={cn(
                  'font-medium rounded-full bg-muted text-muted-foreground',
                  dense ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs',
                )}
              >
                {toRoomTypeDisplayLabel(label)}
              </span>
            ))}
            {roomConfigBadges.hasMore && (
              <span
                className={cn(
                  'font-medium rounded-full bg-muted text-muted-foreground',
                  dense ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-0.5 text-xs',
                )}
              >
                +{roomConfigBadges.moreCount}
              </span>
            )}
          </div>
          {onViewDetails && (
            <div
              className={cn(
                'mt-3 pt-3 border-t border-border shrink-0',
                hideMapCtaOnMobile && 'hidden md:block',
              )}
            >
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onViewDetails(); }}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-foreground bg-muted border border-border rounded-lg hover:bg-accent transition-colors"
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  {ctaLabel}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Memoized so the whole grid doesn't re-render when only sibling cards' hover state
// changes. Props are compared shallowly by React.memo's default.
export const DormCard = memo(DormCardComponent);
