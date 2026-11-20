"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import useEmblaCarousel from "embla-carousel-react";
import { WheelGesturesPlugin } from "embla-carousel-wheel-gestures";
import { cn } from "@/lib/utils";

interface HorizontalScrollCarouselProps {
  children: React.ReactNode;
  className?: string;
  slideClassName?: string;
}

/** Horizontal carousel with mouse-wheel scroll, drag/swipe, and optional nav arrows. */
export function HorizontalScrollCarousel({
  children,
  className,
  slideClassName,
}: HorizontalScrollCarouselProps) {
  const [isDragging, setIsDragging] = React.useState(false);
  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      align: "start",
      containScroll: false,
      dragFree: true,
      duration: 28,
    },
    [WheelGesturesPlugin({ forceWheelAxis: "x" })]
  );
  const [canScrollPrev, setCanScrollPrev] = React.useState(false);
  const [canScrollNext, setCanScrollNext] = React.useState(true);

  const onSelect = React.useCallback(() => {
    if (!emblaApi) return;
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  React.useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  const scrollPrev = React.useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = React.useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  const handlePointerDown = React.useCallback(() => setIsDragging(true), []);
  const handlePointerUp = React.useCallback(() => setIsDragging(false), []);

  const slides = React.Children.toArray(children);

  return (
    <div className={cn("relative w-full", className)}>
      {/* Minimalist nav arrows: white circles, brand accent hover border - left & right */}
      <div className="absolute left-0 top-1/2 z-20 flex -translate-y-1/2 -translate-x-2 md:translate-x-0">
        <button
          type="button"
          onClick={scrollPrev}
          disabled={!canScrollPrev}
          aria-label="Scroll previous"
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card shadow-raised",
            "transition-all duration-200 hover:border-malachite-600 hover:shadow-overlay",
            "disabled:pointer-events-none disabled:opacity-30"
          )}
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
      </div>
      <div className="absolute right-0 top-1/2 z-20 flex -translate-y-1/2 translate-x-2 md:translate-x-0">
        <button
          type="button"
          onClick={scrollNext}
          disabled={!canScrollNext}
          aria-label="Scroll next"
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card shadow-raised",
            "transition-all duration-200 hover:border-malachite-600 hover:shadow-overlay",
            "disabled:pointer-events-none disabled:opacity-30"
          )}
        >
          <ChevronRight className="h-5 w-5 text-foreground" />
        </button>
      </div>

      {/* Embla viewport: mouse-wheel horizontal, drag, touch swipe */}
      <div
        ref={emblaRef}
        className={cn(
          "overflow-hidden cursor-grab active:cursor-grabbing",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          isDragging && "cursor-grabbing"
        )}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div className="flex pl-8 pr-8">
          {slides.map((child, index) => (
            <div
              key={index}
              className={cn(
                "min-w-0 shrink-0 pl-5",
                slideClassName ?? "min-w-[280px] basis-[280px] md:min-w-[320px] md:basis-[320px]"
              )}
            >
              {child}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
