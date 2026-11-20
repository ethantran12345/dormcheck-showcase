import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { supabaseThumbUrl } from '@/lib/imageTransform';
import {
  DeskLampIllustration,
  KeyLanyardIllustration,
  MovingBoxIllustration,
  RoomDoorIllustration,
} from '@/components/illustrations/DormIllustrations';

/**
 * THE photo treatment for user-uploaded listing images (Product Identity Spec,
 * tell 5). Student photos arrive at every ratio and exposure; a grid only reads
 * as designed if one component decides all of these, every time:
 *
 *  1. Fixed aspect per context. `aspectClassName` sizes the well before a byte
 *     arrives and the image is absolutely positioned inside it, so photos landing
 *     late cannot reflow their neighbours. Pass `h-full w-full` when a parent
 *     already owns the box (the detail gallery).
 *  2. `object-cover` crop, centred. (Taste Library, imgix: entropy cropping
 *     chases dorm clutter, so centre beats "smart".)
 *  3. Scrim ONLY where text sits on the photo (`scrim="bottom" | "top"`). A photo
 *     with nothing on it is never darkened.
 *  4. Corners come from the card shape tier via `className` (`rounded-t-card`,
 *     `rounded-card`), never an arbitrary radius.
 *  5. Blur-up: a ~20px transform of the same photo paints first and the real one
 *     crossfades over it (`motion-reduce` removes the fade).
 *  6. A DESIGNED no-photo / broken-photo state: a muted well with one of the
 *     identity illustrations, named by the image's alt text. Never a grey box,
 *     never a browser broken-image glyph, never a stock or generated photo.
 *  7. Lazy by default; `priority` for the one hero photo on screen.
 */

/** Width of the low-quality placeholder transform, in px. */
const LQIP_WIDTH = 20;

export type ListingImageKind = 'item' | 'sublease' | 'service' | 'business';

const FALLBACK_ART: Record<ListingImageKind, ComponentType<{ className?: string }>> = {
  item: MovingBoxIllustration,
  sublease: KeyLanyardIllustration,
  service: DeskLampIllustration,
  business: RoomDoorIllustration,
};

export interface ListingImageProps {
  /** Original (already-sanitized) image URL. Null/empty renders the no-photo state. */
  src: string | null | undefined;
  alt: string;
  /** Transform width for the real image — ~2x the rendered CSS width. */
  thumbWidth?: number;
  quality?: number;
  /** Aspect-ratio lock for the well. Must be set, or the box can't be reserved. */
  aspectClassName?: string;
  /** Extra classes on the well (shape tier, background, ring…). */
  className?: string;
  /** Extra classes on the <img> itself (e.g. `md:object-contain` in the gallery). */
  imgClassName?: string;
  /** Darken the edge text sits on. Omit when nothing overlays the photo. */
  scrim?: 'bottom' | 'top';
  /** Which drawing the no-photo state uses. */
  kind?: ListingImageKind;
  /** Load eagerly — only for the single hero photo in view. */
  priority?: boolean;
  /** Overlays positioned against the well (badges, save button, actions). */
  children?: ReactNode;
  /**
   * Intent hooks for the well element — spread `usePrefetchOnIntent()` here to
   * warm the detail screen's chunk on hover / on entering the viewport.
   */
  wellRef?: (node: HTMLElement | null) => void;
  onPointerEnter?: () => void;
  onFocus?: () => void;
}

export function ListingImage({
  src,
  alt,
  thumbWidth = 400,
  quality = 70,
  aspectClassName = 'aspect-square',
  className,
  imgClassName,
  scrim,
  kind = 'item',
  priority = false,
  children,
  wellRef,
  onPointerEnter,
  onFocus,
}: ListingImageProps) {
  const original = src || '';
  const thumb = original ? supabaseThumbUrl(original, { width: thumbWidth, quality }) : null;
  const lqip = original ? supabaseThumbUrl(original, { width: LQIP_WIDTH, quality: 30 }) : null;
  const candidates = original ? (thumb ? [thumb, original] : [original]) : [];

  const [loaded, setLoaded] = useState(false);
  // Reset both the fade and the fallback chain when the source itself changes.
  const [state, setState] = useState<{ key: string; step: number }>({ key: original, step: 0 });
  const step = state.key === original ? state.step : 0;
  const failed = candidates.length === 0 || step >= candidates.length;
  const resolved = failed ? null : candidates[step];

  const imgRef = useRef<HTMLImageElement | null>(null);
  // `onLoad` is not sufficient on its own: a cached image can finish before React
  // attaches the handler, and the fade-in event never arrives — a blank card, not
  // a slow one. Checking the element's own decode state after every src change
  // closes that hole.
  useEffect(() => {
    const node = imgRef.current;
    if (node && (node.complete || node.naturalWidth > 0)) setLoaded(true);
  }, [resolved]);

  const Art = FALLBACK_ART[kind];

  return (
    <div
      ref={wellRef}
      onPointerEnter={onPointerEnter}
      onFocus={onFocus}
      className={cn('relative overflow-hidden bg-muted', aspectClassName, className)}
    >
      {failed ? (
        <div
          // Named by the photo's alt so the listing still has an image name; a
          // decorative photo (alt="") keeps its fallback decorative too.
          {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}
          data-testid="listing-image-fallback"
          className="absolute inset-0 flex items-center justify-center"
        >
          <Art className="h-1/2 max-h-40 w-1/2 max-w-40" />
        </div>
      ) : (
        <>
          {lqip && !loaded && (
            <img
              src={lqip}
              alt=""
              aria-hidden="true"
              // scale-110 hides the soft edges blur() leaves at the box boundary.
              className="absolute inset-0 h-full w-full scale-110 object-cover blur-lg"
              draggable={false}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
            />
          )}
          <img
            ref={imgRef}
            // Non-null here: `failed` is false, so a candidate resolved.
            src={resolved as string}
            alt={alt}
            className={cn(
              'absolute inset-0 h-full w-full select-none object-cover object-center',
              'transition-opacity duration-500 ease-ios motion-reduce:transition-none',
              // With no blurred layer to blend FROM, hiding the image until `load` is
              // just a delayed appearance over an empty well.
              loaded || !lqip ? 'opacity-100' : 'opacity-0',
              imgClassName,
            )}
            onLoad={() => setLoaded(true)}
            onError={() => {
              setLoaded(false);
              setState({ key: original, step: step + 1 });
            }}
            draggable={false}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
          />
        </>
      )}
      {scrim && !failed && (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-0 h-1/2 from-black/55 to-transparent',
            scrim === 'bottom' ? 'bottom-0 bg-gradient-to-t' : 'top-0 bg-gradient-to-b',
          )}
        />
      )}
      {children}
    </div>
  );
}
