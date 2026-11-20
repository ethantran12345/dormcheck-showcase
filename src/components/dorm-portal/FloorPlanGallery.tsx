import { useState, useEffect, useMemo } from 'react';
import { ZoomIn, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { ImageGalleryCarousel } from '@/components/ImageGalleryCarousel';
import type { FloorPlanImage } from '@/lib/floorplanUtils';

interface FloorPlanGalleryProps {
  floorPlans: FloorPlanImage[];
  buildingName: string;
  subBuildingLetter?: string;
  className?: string;
}

export function FloorPlanGallery({
  floorPlans,
  buildingName,
  subBuildingLetter,
  className,
}: FloorPlanGalleryProps) {
  const { t } = useTranslation();
  const [zoomDialogOpen, setZoomDialogOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const floorPlanUrls = useMemo(() => floorPlans.map((plan) => plan.url), [floorPlans]);

  // Prevent body scroll when modal is open. Must sit above the early return below —
  // hooks cannot run conditionally (react-hooks/rules-of-hooks).
  useEffect(() => {
    if (zoomDialogOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [zoomDialogOpen]);

  if (floorPlans.length === 0) {
    return null;
  }

  const displayName = subBuildingLetter
    ? `${buildingName} ${subBuildingLetter}`
    : buildingName;

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setZoomDialogOpen(true);
  };

  // Compact layout with fixed height container
  return (
    <>
      <div className={cn('glass-card p-4', className)}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-foreground">{t('housing:portal.floorPlan.heading')}</span>
          <button
            type="button"
            onClick={() => openLightbox(currentImageIndex)}
            className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
          >
            <ZoomIn className="w-3 h-3" />
            {t('housing:portal.floorPlan.clickToEnlarge')}
          </button>
        </div>

        {/* Main Image Container - Fixed Height */}
        <div
          className="w-full h-[400px] rounded-xl overflow-hidden cursor-pointer hover:opacity-90 transition-opacity border border-border bg-muted flex items-center justify-center"
          onClick={() => openLightbox(currentImageIndex)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openLightbox(currentImageIndex);
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={t('housing:portal.floorPlan.openGalleryAriaLabel')}
        >
          <img
            src={floorPlans[currentImageIndex].url}
            alt={`${displayName} ${floorPlans[currentImageIndex].label}`}
            className="max-w-full max-h-full object-contain"
            loading="lazy"
          />
        </div>

        {/* Thumbnails for Multiple Images - Clearly labeled and directly below */}
        {floorPlans.length > 1 && (
          <div className="mt-4 flex gap-3 justify-center flex-wrap">
            {floorPlans.map((plan, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setCurrentImageIndex(index)}
                className={cn(
                  'relative flex flex-col items-center gap-2 transition-all group',
                  currentImageIndex === index && 'scale-105'
                )}
              >
                <div
                  className={cn(
                    'relative w-20 h-20 rounded-lg overflow-hidden border-2 transition-all',
                    currentImageIndex === index
                      ? 'border-primary shadow-raised'
                      : 'border-border opacity-70 hover:opacity-100 hover:border-border'
                  )}
                >
                  <img
                    src={plan.url}
                    alt={`Plan ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
                <span
                  className={cn(
                    'text-xs font-semibold transition-colors',
                    currentImageIndex === index
                      ? 'text-primary'
                      : 'text-muted-foreground group-hover:text-foreground'
                  )}
                >
                  {t('housing:portal.floorPlan.planNumber', { number: index + 1 })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox/Modal for Full-Screen View */}
      <Dialog open={zoomDialogOpen} onOpenChange={setZoomDialogOpen}>
        <DialogContent className="max-w-[90vw] max-h-[80vh] w-[90vw] h-auto p-0 bg-transparent border-0 shadow-none grid grid-rows-[1fr] [&>button]:hidden">
          <button
            type="button"
            onClick={() => setZoomDialogOpen(false)}
            className="absolute top-4 right-4 z-30 h-8 w-8 rounded-full bg-black/80 hover:bg-black/90 text-white flex items-center justify-center transition-colors"
            aria-label={t('common:actions.close')}
          >
            <X className="h-4 w-4" />
          </button>

          <div className="absolute top-4 left-4 z-30 bg-black/80 text-white px-3 py-1.5 rounded-lg pointer-events-none">
            <span className="text-sm font-medium">
              {displayName} - {t('housing:portal.floorPlan.planNumber', { number: lightboxIndex + 1 })}
            </span>
          </div>

          <div className="relative flex h-[min(80vh,720px)] min-h-[320px] w-full items-center justify-center overflow-hidden p-4">
            <ImageGalleryCarousel
              key={`lightbox-${lightboxIndex}`}
              images={floorPlanUrls}
              alt={`${displayName} floor plan`}
              objectFit="contain"
              showArrows="desktop-only"
              startIndex={lightboxIndex}
              className="h-full w-full max-h-[calc(80vh-2rem)]"
              dotsClassName="bottom-2"
              slideInnerClassName="h-full w-full"
              onSlideChange={setLightboxIndex}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
