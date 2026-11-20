import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Building2, Home } from 'lucide-react';
import { safeImageSrc } from '@/lib/sanitize';
import { cn } from '@/lib/utils';

export interface BuildingPhotoBuilding {
  name: string;
  photoUrl: string | null;
  /** master_housing.floors; null hides the floors line. */
  floors: number | null;
}

/**
 * The hero's right-hand panel: the student's residence hall photo with a
 * "YOUR BUILDING" tag and a name/floors caption. With no dorm set it renders
 * the dashed empty frame instead (tapping it opens the housing editor). The
 * empty→photo swap cross-fades and scales the photo in - the visual anchor of
 * the fill-in transition.
 *
 * A ReadinessRing "50%" badge used to float over the photo. It was removed: a
 * bare percentage over a building photo reads as a property of the *building*,
 * not of the student's setup, and nothing on screen explained it. The same
 * progress is stated in words by the "Finish setting up - 2 of 4" strip below.
 */
export function BuildingPhoto({
  building,
  onSetDorm,
  className,
}: {
  building: BuildingPhotoBuilding | null;
  onSetDorm: () => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const photoSrc = building?.photoUrl ? safeImageSrc(building.photoUrl) : null;

  return (
    <div className={cn('relative aspect-[4/3] w-full overflow-hidden lg:w-80 lg:shrink-0', className)}>
      <AnimatePresence initial={false}>
        {building ? (
          <motion.div
            key="photo"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute inset-0 overflow-hidden rounded-card shadow-raised"
          >
            {photoSrc ? (
              <img
                src={photoSrc}
                alt={`${building.name} residence hall`}
                className="h-full w-full object-cover"
              />
            ) : (
              // Tasteful fallback for halls with no first-party photo yet.
              <div
                aria-hidden
                className="flex h-full w-full items-center justify-center bg-muted"
              >
                <Building2 className="h-14 w-14 text-muted-foreground/50" strokeWidth={1.5} />
              </div>
            )}
            <span className="absolute left-3 top-3 rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white backdrop-blur-sm">
              Your building
            </span>
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/5 to-transparent"
            />
            <div className="absolute bottom-3 left-3.5 pr-4 text-white">
              <p className="text-lg font-extrabold leading-tight tracking-tight">{building.name}</p>
              {building.floors ? (
                <p className="text-xs font-medium text-white/80">
                  {building.floors} {building.floors === 1 ? 'floor' : 'floors'}
                </p>
              ) : null}
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="empty"
            type="button"
            onClick={onSetDorm}
            initial={false}
            exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 rounded-card border-[1.5px] border-dashed border-border bg-muted/40 p-6 text-center transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
          >
            <Home className="h-11 w-11 text-muted-foreground/50" aria-hidden />
            <span className="max-w-52 text-[13px] font-semibold leading-snug text-muted-foreground">
              Set your dorm and your building appears here
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
