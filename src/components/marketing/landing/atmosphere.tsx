import { useEffect, useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * The marketing site's shared "atmosphere" (2026-07, Duna-inspired pass): one
 * continuous, softly parallaxing green-on-cream field behind every marketing
 * page (`PAGE` + `AuroraField`), plus the `Drift` parallax helper. Everything
 * decorative is aria-hidden and pointer-events-none; everything animated is
 * transform/opacity only and goes fully static under prefers-reduced-motion.
 */

export { EASE } from "@/components/marketing/landing/tokens";

/* Static tiled SVG noise: the single cheap layer that keeps the soft gradients
   from reading as flat vector. Never animated. */
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")";

/* Blobs span the full page (percent tops), malachite tints + one warm cream +
   one faint cool sky tint. `rate` is the scroll-parallax drift in px over
   ~3000px of scroll; differing rates read as depth. */
const BLOBS: Array<{
  top: string;
  left?: string;
  right?: string;
  size: number;
  color: string;
  rate: number;
}> = [
  { top: "-2%", left: "-14%", size: 680, color: "hsl(140 86% 90% / 0.9)", rate: -60 },
  { top: "2%", right: "-12%", size: 640, color: "hsl(145 80% 82% / 0.6)", rate: -110 },
  { top: "22%", left: "-10%", size: 620, color: "hsl(48 90% 92% / 0.7)", rate: -40 },
  { top: "40%", right: "-14%", size: 700, color: "hsl(142 82% 88% / 0.7)", rate: -130 },
  { top: "62%", left: "-8%", size: 640, color: "hsl(200 80% 93% / 0.55)", rate: -70 },
  { top: "82%", right: "-10%", size: 620, color: "hsl(141 84% 89% / 0.75)", rate: -120 },
];

/* No filter:blur here on purpose: six page-spanning blurred layers hang the
   compositor. The radial-gradient's soft falloff does the blurring for free. */
function Blob({ blob }: { blob: (typeof BLOBS)[number] }) {
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 3000], [0, blob.rate]);
  return (
    <motion.div
      className="absolute rounded-full"
      style={{
        top: blob.top,
        left: blob.left,
        right: blob.right,
        width: blob.size,
        height: blob.size,
        background: `radial-gradient(circle, ${blob.color}, transparent 62%)`,
        willChange: "transform",
        y,
      }}
    />
  );
}

/**
 * The marketing canvas colour, painted on `<html>` for as long as a marketing
 * page is mounted.
 *
 * `PAGE` puts `bg-tint-50` on a DIV, and a div's background stops at the div.
 * The rubber-band area a browser (and the WKWebView) reveals when you scroll
 * past the top or bottom of the document is painted from the ROOT element's
 * background — which is the app's white — so overscrolling the landing page
 * flashed a white slab above the cream page. Painting `<html>` fixes it at the
 * source; the cleanup restores whatever was there so the app's own white
 * surfaces are untouched when you navigate off marketing.
 */
function useMarketingCanvas() {
  useEffect(() => {
    // The class (not an inline hex) so the colour still comes from the
    // `tint-50` token via `src/index.css` — see `.marketing-canvas` there.
    document.documentElement.classList.add("marketing-canvas");
    return () => document.documentElement.classList.remove("marketing-canvas");
  }, []);
}

/**
 * Page-spanning aurora field + grain. Render once at each marketing page root,
 * inside a `relative overflow-x-clip` wrapper (see `PAGE`).
 */
export function AuroraField() {
  const reduce = useReducedMotion();
  useMarketingCanvas();
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {BLOBS.map((blob, i) =>
        reduce ? (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              top: blob.top,
              left: blob.left,
              right: blob.right,
              width: blob.size,
              height: blob.size,
              background: `radial-gradient(circle, ${blob.color}, transparent 62%)`,
            }}
          />
        ) : (
          <Blob key={i} blob={blob} />
        ),
      )}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{ backgroundImage: GRAIN, backgroundRepeat: "repeat" }}
      />
    </div>
  );
}

/** Root classes for every marketing page: the atmosphere's positioning context. */
export const PAGE = "relative overflow-x-clip bg-tint-50 text-stone-900";

/**
 * Gentle scroll-linked parallax (a few px of y) for product visuals as they
 * pass through the viewport. Transform-only; static under reduced motion.
 */
export function Drift({
  children,
  className,
  distance = 14,
}: {
  children: ReactNode;
  className?: string;
  distance?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);

  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div ref={ref} className={cn("relative", className)} style={{ y }}>
      {children}
    </motion.div>
  );
}
