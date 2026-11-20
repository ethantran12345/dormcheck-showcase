import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import type { Dorm } from '@/types';
import { cn } from '@/lib/utils';
import { safeImageSrc } from '@/lib/sanitize';
import {
  getAudienceBadgeClassName,
  getDormCardHeaderBadges,
  getDormCardRoomConfigBadges,
  toRoomTypeDisplayLabel,
} from '@/lib/dormUtils';

const DORM_PLACEHOLDER_IMAGE = '/placeholder.svg';
const CARD_WIDTH_PX = 280;
const DEBOUNCE_MS = 150;
const PROGRAMMATIC_SCROLL_GUARD_MS = 450;

function MapPreviewCarouselCard({
  dorm,
  onCardTap,
}: {
  dorm: Dorm;
  onCardTap: () => void;
}) {
  const { audienceBadge, housingBadge } = getDormCardHeaderBadges(dorm);
  const roomConfigBadges = getDormCardRoomConfigBadges(dorm);

  return (
    <button
      type="button"
      className="flex w-full flex-col text-left"
      onClick={onCardTap}
    >
      <div className="relative h-[92px] w-full shrink-0 overflow-hidden bg-muted">
        <img
          src={safeImageSrc(dorm.image) ?? DORM_PLACEHOLDER_IMAGE}
          alt={dorm.name ?? 'Residence hall'}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
      <div className="px-3 py-2 pr-8">
        <p className="truncate text-sm font-semibold text-foreground">
          {dorm.name ?? 'Residence Hall'}
        </p>
        <div className="mt-0.5">
          {(dorm.semesterRate ?? 0) > 0 ? (
            <>
              <p className="text-xs font-medium text-malachite-800">
                {dorm.minRate != null && dorm.minRate > 0 && <span>From </span>}
                ${(dorm.semesterRate ?? 0).toLocaleString()}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {dorm.rentPeriod === 'month' ? 'per month' : 'per semester'}
              </p>
            </>
          ) : (
            <p className="text-xs font-medium text-muted-foreground">Rate not published</p>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium',
              getAudienceBadgeClassName(dorm),
            )}
          >
            {audienceBadge}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {housingBadge}
          </span>
          {roomConfigBadges.badges.map((label) => (
            <span
              key={label}
              className="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {toRoomTypeDisplayLabel(label)}
            </span>
          ))}
          {roomConfigBadges.hasMore && (
            <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              +{roomConfigBadges.moreCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

interface MapPreviewCarouselProps {
  dorms: Dorm[];
  activeDormId: string | null;
  onActiveDormChange: (dorm: Dorm) => void;
  onCardTap: (dorm: Dorm) => void;
  onDismiss: () => void;
  className?: string;
  style?: CSSProperties;
}

export function MapPreviewCarousel({
  dorms,
  activeDormId,
  onActiveDormChange,
  onCardTap,
  onDismiss,
  className,
  style,
}: MapPreviewCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const skipNotifyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const guardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReportedIdRef = useRef<string | null>(null);

  const clearGuardTimer = useCallback(() => {
    if (guardTimerRef.current) {
      clearTimeout(guardTimerRef.current);
      guardTimerRef.current = null;
    }
  }, []);

  const armProgrammaticGuard = useCallback(() => {
    skipNotifyRef.current = true;
    clearGuardTimer();
    guardTimerRef.current = setTimeout(() => {
      skipNotifyRef.current = false;
      guardTimerRef.current = null;
    }, PROGRAMMATIC_SCROLL_GUARD_MS);
  }, [clearGuardTimer]);

  const scrollCardToCenter = useCallback(
    (id: string, behavior: ScrollBehavior = 'smooth') => {
      const root = scrollRef.current;
      const card = cardRefs.current.get(id);
      if (!root || !card) return;
      armProgrammaticGuard();
      const rootRect = root.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const delta =
        cardRect.left + cardRect.width / 2 - (rootRect.left + rootRect.width / 2);
      root.scrollTo({ left: root.scrollLeft + delta, behavior });
    },
    [armProgrammaticGuard],
  );

  useEffect(() => {
    if (!activeDormId) return;
    scrollCardToCenter(activeDormId);
  }, [activeDormId, scrollCardToCenter]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || dorms.length === 0) return;

    const reportCentered = (dormId: string) => {
      if (skipNotifyRef.current || dormId === lastReportedIdRef.current) return;
      const dorm = dorms.find((d) => d.id === dormId);
      if (!dorm) return;
      lastReportedIdRef.current = dormId;
      onActiveDormChange(dorm);
    };

    /** Card whose center is closest to the scrollport center (works both directions). */
    const pickCenteredCard = () => {
      if (skipNotifyRef.current) return;
      const rootRect = root.getBoundingClientRect();
      const centerX = rootRect.left + rootRect.width / 2;
      let bestId: string | null = null;
      let bestDist = Infinity;
      cardRefs.current.forEach((el, id) => {
        const rect = el.getBoundingClientRect();
        if (rect.right < rootRect.left || rect.left > rootRect.right) return;
        const cardCenter = rect.left + rect.width / 2;
        const dist = Math.abs(cardCenter - centerX);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
      });
      if (bestId) reportCentered(bestId);
    };

    const schedulePickCentered = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        pickCenteredCard();
      }, DEBOUNCE_MS);
    };

    const observer = new IntersectionObserver(
      () => {
        if (skipNotifyRef.current) return;
        schedulePickCentered();
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    cardRefs.current.forEach((el) => observer.observe(el));

    root.addEventListener('scroll', schedulePickCentered, { passive: true });
    root.addEventListener('scrollend', pickCenteredCard);

    return () => {
      observer.disconnect();
      root.removeEventListener('scroll', schedulePickCentered);
      root.removeEventListener('scrollend', pickCenteredCard);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [dorms, onActiveDormChange]);

  useEffect(() => {
    lastReportedIdRef.current = activeDormId;
  }, [activeDormId]);

  useEffect(
    () => () => {
      clearGuardTimer();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [clearGuardTimer],
  );

  if (dorms.length === 0) return null;

  const sideInset = `max(12px, calc((100% - ${CARD_WIDTH_PX}px) / 2))`;

  return (
    <div
      className={cn('pointer-events-auto', className)}
      style={style}
      aria-label="Map listing preview"
    >
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          scrollSnapType: 'x mandatory',
          scrollPaddingInline: sideInset,
          paddingInline: sideInset,
        }}
      >
        {dorms.map((dorm) => {
          const isActive = dorm.id === activeDormId;
          return (
            <div
              key={dorm.id}
              ref={(el) => {
                if (el) cardRefs.current.set(dorm.id, el);
                else cardRefs.current.delete(dorm.id);
              }}
              data-dorm-id={dorm.id}
              className={cn(
                'relative shrink-0 snap-center snap-always overflow-hidden rounded-2xl border bg-card shadow-overlay transition-shadow',
                isActive ? 'border-malachite-600 shadow-raised' : 'border-border',
              )}
              style={{ width: CARD_WIDTH_PX, scrollSnapAlign: 'center', scrollSnapStop: 'always' }}
            >
              <MapPreviewCarouselCard dorm={dorm} onCardTap={() => onCardTap(dorm)} />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss();
                }}
                className="absolute right-2 top-2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-card/95 text-muted-foreground shadow-raised ring-1 ring-border hover:text-foreground"
                aria-label="Dismiss preview"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
