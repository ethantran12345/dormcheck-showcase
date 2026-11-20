import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import useEmblaCarousel, { type UseEmblaCarouselType } from 'embla-carousel-react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type CarouselApi = UseEmblaCarouselType[1];

export type ImageGalleryCarouselProps = {
  images: string[];
  alt?: string;
  objectFit?: 'contain' | 'cover';
  showArrows?: 'desktop-only' | 'always' | 'never';
  renderOverlay?: (slideIndex: number) => ReactNode;
  onSlideTap?: (slideIndex: number) => void;
  onSlideChange?: (slideIndex: number) => void;
  onImageLoad?: (slideIndex: number, dimensions: { w: number; h: number }) => void;
  /** When set, called on img error instead of swapping to /placeholder.svg. */
  onImageError?: (slideIndex: number, src: string) => void;
  /** Initial slide index (Embla startIndex). Clamped to [0, slideCount - 1]. */
  startIndex?: number;
  /**
   * Non-image slides appended after the photos (e.g. a video embed). Each is
   * rendered inside the same aspect/slide wrapper the images use, and is counted
   * in the dots + navigation (photos = N, trailing = N+1, N+2, ...).
   */
  trailingSlides?: ReactNode[];
  /**
   * Per-image CSS `object-position` (focal point), aligned to `images` by index.
   * Only applied under `objectFit="cover"`; defaults to `'50% 50%'` (center).
   */
  imagePositions?: Array<string | undefined>;
  /** Extra classes applied to each slide <img> (e.g. object-top). */
  imageClassName?: string;
  className?: string;
  /** Extra classes on the dot row (e.g. bottom offset above footer controls). */
  dotsClassName?: string;
  slideInnerClassName?: string;
  slideInnerStyle?: CSSProperties;
};

const DRAG_CLICK_THRESHOLD_PX = 8;

function isClickAllowed(api: CarouselApi | undefined, didDragRef: MutableRefObject<boolean>): boolean {
  if (!api) return false;
  const extended = api as CarouselApi & { clickAllowed?: () => boolean };
  if (typeof extended.clickAllowed === 'function') {
    return extended.clickAllowed();
  }
  return !didDragRef.current;
}

export function ImageGalleryCarousel({
  images,
  alt = 'Gallery image',
  objectFit = 'contain',
  showArrows = 'desktop-only',
  renderOverlay,
  onSlideTap,
  onSlideChange,
  onImageLoad,
  onImageError,
  startIndex = 0,
  trailingSlides,
  imagePositions,
  imageClassName,
  className,
  dotsClassName,
  slideInnerClassName,
  slideInnerStyle,
}: ImageGalleryCarouselProps) {
  const trailing = useMemo(() => trailingSlides ?? [], [trailingSlides]);
  const slideCount = images.length + trailing.length;
  const canNavigate = slideCount > 1;
  const isCover = objectFit === 'cover';
  const didDragRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const clampedStartIndex = useMemo(() => {
    if (slideCount === 0) return 0;
    return Math.min(Math.max(0, startIndex), slideCount - 1);
  }, [startIndex, slideCount]);

  const [selectedIndex, setSelectedIndex] = useState(clampedStartIndex);

  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'center',
    loop: canNavigate,
    watchDrag: canNavigate,
    startIndex: clampedStartIndex,
  });

  const updateSelectedIndex = useCallback(() => {
    if (!emblaApi) return;
    const index = emblaApi.selectedScrollSnap();
    setSelectedIndex(index);
    onSlideChange?.(index);
  }, [emblaApi, onSlideChange]);

  useEffect(() => {
    if (!emblaApi) return;
    updateSelectedIndex();
    emblaApi.on('select', updateSelectedIndex);
    emblaApi.on('reInit', updateSelectedIndex);
    return () => {
      emblaApi.off('select', updateSelectedIndex);
      emblaApi.off('reInit', updateSelectedIndex);
    };
  }, [emblaApi, updateSelectedIndex]);

  useEffect(() => {
    emblaApi?.reInit();
  }, [emblaApi, slideCount, canNavigate]);

  // Reset to the first slide when the slide set changes. Keyed off the image
  // URLs plus the trailing-slide count so appending a TikTok slide re-runs the
  // reset/startIndex math instead of being ignored.
  const slidesKey = `${images.join('|')}#${trailing.length}`;
  const imagesKeyRef = useRef(slidesKey);

  useEffect(() => {
    if (slidesKey === imagesKeyRef.current) return;
    imagesKeyRef.current = slidesKey;
    setSelectedIndex(0);
    emblaApi?.scrollTo(0, true);
  }, [slidesKey, emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    setSelectedIndex(clampedStartIndex);
    emblaApi.scrollTo(clampedStartIndex, true);
  }, [clampedStartIndex, emblaApi]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    didDragRef.current = false;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const start = pointerStartRef.current;
    if (!start || didDragRef.current) return;
    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    if (dx > DRAG_CLICK_THRESHOLD_PX || dy > DRAG_CLICK_THRESHOLD_PX) {
      didDragRef.current = true;
    }
  }, []);

  const handlePointerUp = useCallback(() => {
    pointerStartRef.current = null;
  }, []);

  const handleSlideClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!onSlideTap || !isClickAllowed(emblaApi, didDragRef)) return;
      const index = emblaApi?.selectedScrollSnap() ?? selectedIndex;
      onSlideTap(index);
    },
    [emblaApi, onSlideTap, selectedIndex],
  );

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  const arrowVisibility = cn(
    'absolute top-1/2 z-20 flex h-11 min-h-[44px] w-11 min-w-[44px] -translate-y-1/2 items-center justify-center rounded-full border border-border/50 bg-card/90 text-foreground backdrop-blur-sm transition-all hover:bg-card md:h-10 md:min-h-0 md:w-10 md:min-w-0',
    showArrows === 'never' && 'hidden',
    showArrows === 'desktop-only' && 'hidden md:flex',
    showArrows === 'always' && 'flex',
  );

  const objectFitClass = isCover ? 'object-cover' : 'object-contain';

  if (slideCount === 0) {
    return (
      <div className={cn('relative flex h-full w-full items-center justify-center bg-black', className)}>
        <img src="/placeholder.svg" alt={alt} className={cn('max-h-full max-w-full', objectFitClass)} />
      </div>
    );
  }

  return (
    <div
      className={cn('relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-black', className)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div ref={emblaRef} className="h-full min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full">
          {images.map((src, index) => (
            <div
              key={`${src}-${index}`}
              className="relative flex h-full min-h-0 w-full shrink-0 grow-0 basis-full items-center justify-center"
            >
              <button
                type="button"
                className={cn(
                  'flex h-full w-full items-center justify-center',
                  onSlideTap && 'cursor-pointer',
                )}
                onClick={onSlideTap ? handleSlideClick : undefined}
                aria-label={onSlideTap ? 'Photo actions' : undefined}
              >
                <div
                  className={cn(
                    'relative flex items-center justify-center',
                    isCover ? 'h-full w-full' : 'max-h-full max-w-full',
                    slideInnerClassName,
                  )}
                  style={slideInnerStyle}
                >
                  <img
                    src={src}
                    alt={images.length > 1 ? `${alt} (${index + 1} of ${images.length})` : alt}
                    className={cn(
                      'block',
                      isCover ? 'h-full w-full' : 'max-h-full max-w-full',
                      objectFitClass,
                      imageClassName,
                    )}
                    style={isCover ? { objectPosition: imagePositions?.[index] ?? '50% 50%' } : undefined}
                    draggable={false}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      onImageLoad?.(index, { w: img.naturalWidth, h: img.naturalHeight });
                    }}
                    onError={(e) => {
                      if (onImageError) {
                        onImageError(index, src);
                      } else {
                        e.currentTarget.src = '/placeholder.svg';
                      }
                    }}
                  />
                  {renderOverlay ? (
                    <div className="absolute inset-0 z-10 pointer-events-none">
                      <div className="pointer-events-auto">{renderOverlay(index)}</div>
                    </div>
                  ) : null}
                </div>
              </button>
            </div>
          ))}
          {trailing.map((node, i) => (
            <div
              key={`trailing-${i}`}
              className="relative flex h-full min-h-0 w-full shrink-0 grow-0 basis-full items-center justify-center"
            >
              {node}
            </div>
          ))}
        </div>
      </div>

      {canNavigate && showArrows !== 'never' && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              scrollPrev();
            }}
            className={cn(arrowVisibility, 'left-4')}
            aria-label="Previous image"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              scrollNext();
            }}
            className={cn(arrowVisibility, 'right-4')}
            aria-label="Next image"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}

      {canNavigate && (
        <div
          className={cn(
            'absolute left-1/2 z-20 flex -translate-x-1/2 gap-2',
            dotsClassName ?? 'bottom-4',
          )}
        >
          {Array.from({ length: slideCount }, (_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                emblaApi?.scrollTo(idx);
              }}
              className={cn(
                'h-2 rounded-full transition-all',
                idx === selectedIndex ? 'w-4 bg-malachite-600' : 'w-2 bg-card/50 hover:bg-card/70',
              )}
              aria-label={`Go to slide ${idx + 1}`}
              aria-current={idx === selectedIndex ? 'true' : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
