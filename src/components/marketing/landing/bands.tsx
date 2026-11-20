import { useRef, type ReactNode } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { TYPE } from "@/components/marketing/landing/tokens";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/ui/page-container";

/**
 * Full-bleed alternating bands (2026-08-04, Slack-inspired pass).
 *
 * The landing page used to be one cream sheet with a bento grid and a run of
 * bordered cards floating on it — every section the same width, the same
 * centred alignment, the same white rounded box. That is what read as "bento
 * box" rather than a designed page.
 *
 * The fix is structural, not decorative: **the section owns the full viewport
 * width and carries its own background**, dark and light alternate down the
 * page, and the copy/visual pair FLIPS side each band so the eye zig-zags
 * instead of tracking one centre line. The product visual deliberately bleeds
 * past the measure toward the outer edge — the page's `overflow-x-clip` (see
 * `PAGE` in atmosphere.tsx) crops it, so it can never produce a horizontal
 * scrollbar, including in the Capacitor WebView.
 *
 * Nothing here is a card: no border, no shadow, no radius on the section
 * itself. Elevation belongs to the product window inside, which is the one
 * thing that should look like a floating object.
 */

type Tone = "dark" | "cream" | "white" | "mint";

const BAND_BG: Record<Tone, string> = {
  // Deep green rather than near-black: the dark bands must still read as
  // DormCheck. A gradient (not a flat fill) keeps a 100vw surface from going
  // dead, and the two stops are adjacent scale steps so it stays one colour.
  // Vertical, not diagonal, and it SETTLES on the same step at both ends: the
  // curve wedges (BandCurve) are a flat fill, so a diagonal gradient — or one
  // that ends on a different step than the wedge — seams visibly at the join.
  //
  // Lightened 2026-08-04 from 950/900/950 on user feedback that the dark bands
  // read "too darkish and harsh". 950 (#003412) is nearly black-green; at full
  // viewport width that much of it is oppressive rather than rich. 900/800/900
  // keeps it unmistakably deep DormCheck green while letting the hue read as
  // green rather than as "very dark". Contrast is unaffected in practice —
  // white on malachite-800 is still ~5.9:1 — but re-measure in-page if this
  // moves again, because the eyebrow's malachite-300 has much less headroom.
  dark: "bg-gradient-to-b from-malachite-900 via-malachite-800 to-malachite-900 text-white",
  cream: "bg-tint-50 text-stone-900",
  white: "bg-white text-stone-900",
  mint: "bg-malachite-50 text-stone-900",
};

/**
 * The curved seam between a solid band and the page, as an SVG wedge.
 *
 * `M0 0 Q500 200 1000 0 Z` in a `viewBox="0 0 1000 100"` with
 * `preserveAspectRatio="none"` sits flush at y=0 at both page edges and reaches
 * the wedge's full height at the centre — so **the height IS the arc depth and
 * there is no extra fill anywhere.** That property is why this replaced an
 * overhanging `rounded-[50%]` ellipse, whose rim sat ~134px below the edge
 * across the whole width and left the band swimming in colour.
 *
 * Three placements, and which one you want is a question about WHICH SURFACE
 * bulges, not about the curve:
 *
 * - `edge="bottom"` hangs BELOW the band in the band's own colour, so the BAND
 *   bulges down into the page (convex). Needs a matching bottom margin to
 *   reserve it — nothing else stops it landing on the next section.
 * - `edge="bottom-inset"` sits INSIDE the band at its bottom in the NEXT
 *   section's colour, so the PAGE arcs up into the band (concave). This is what
 *   slack.com uses mid-page, and it needs bottom padding for clearance rather
 *   than a margin, because nothing escapes the box.
 * - `edge="top"` sits INSIDE the band at its top in the PREVIOUS section's
 *   colour, so the page above dips down into the band. Needs top padding.
 */
export function BandCurve({
  edge,
  fill,
  height = 72,
}: {
  edge: "top" | "bottom" | "bottom-inset";
  /** Tailwind fill-* class: the colour of whichever surface is doing the bulging. */
  fill: string;
  height?: number;
}) {
  const inset = edge === "bottom-inset";
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1000 100"
      preserveAspectRatio="none"
      style={{ height }}
      className={cn(
        "pointer-events-none absolute inset-x-0 w-full",
        edge === "bottom" && "top-full",
        edge === "top" && "top-0",
        inset && "bottom-0",
        fill,
      )}
    >
      {/* Both quadratics reach the far edge of the box at their midpoint, which
          is why the wedge's HEIGHT is exactly the arc's depth: control points at
          ±200/-100 are chosen so B(0.5) lands on 100 / 0 respectively. */}
      <path d={inset ? "M0 100 Q500 -100 1000 100 Z" : "M0 0 Q500 200 1000 0 Z"} />
    </svg>
  );
}

/** Full-bleed section. Renders at viewport width and paints its own tone. */
export function Band({
  tone = "cream",
  id,
  className,
  children,
  label,
  curveBottom,
  curveBottomInset,
  curveTop,
}: {
  tone?: Tone;
  id?: string;
  className?: string;
  children: ReactNode;
  label?: string;
  /** Wedge hanging below in the band's colour (band bulges down). Adds the margin. */
  curveBottom?: string;
  /** Wedge inside the bottom in the NEXT section's colour (page arcs up). Adds clearance. */
  curveBottomInset?: string;
  /** Wedge inside the top in the PREVIOUS section's colour, plus clearance. */
  curveTop?: string;
}) {
  return (
    <section
      id={id}
      aria-label={label}
      className={cn(
        /* Mobile rhythm is 64px, not the desktop 104 scaled down by nothing.
           `py-20` (80px top AND bottom) put 160px of empty band between two
           sections on a 390px-wide phone — a fifth of the screen spent on air
           each time, four times down the page. Slack's mobile sections sit at
           roughly this 64px. Desktop is unchanged: at 1280 the wide measure
           needs the bigger gap to keep sections apart. */
        "relative scroll-mt-24 py-16 md:py-[104px]",
        // A curve must escape the box, so the band can only clip when it has none.
        curveBottom ? "mb-[72px]" : "overflow-hidden",
        /* Clearance for a wedge only has to exceed the wedge's own 72px; the
           rest was padding on top of padding. */
        curveTop && "pt-[104px] md:pt-[148px]",
        curveBottomInset && "pb-[104px] md:pb-[148px]",
        BAND_BG[tone],
        className,
      )}
    >
      {curveTop && <BandCurve edge="top" fill={curveTop} />}
      {curveBottom && <BandCurve edge="bottom" fill={curveBottom} />}
      {curveBottomInset && <BandCurve edge="bottom-inset" fill={curveBottomInset} />}
      {/* No top-edge fade. A 180px cream-to-green ramp was tried here to soften
          where the first dark band meets the hero; it read as a smear rather
          than a transition, and washed out the top third of the band's own
          content. A band's top edge is a clean, solid line — the hero simply
          carries enough bottom air (`pb-24 md:pb-32`) that the line lands below
          the fold instead of through it. */}
      {children}
    </section>
  );
}

/**
 * Scroll-linked entrance for a product visual: it rises, settles, and drifts a
 * few px as it crosses the viewport. Transform/opacity only (compositor-safe),
 * and completely inert under prefers-reduced-motion.
 */
export function Rise({
  children,
  className,
  distance = 60,
}: {
  children: ReactNode;
  className?: string;
  distance?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const y = useTransform(scrollYProgress, [0, 1], [distance, 0]);
  const opacity = useTransform(scrollYProgress, [0, 0.55], [0, 1]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.965, 1]);

  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div ref={ref} className={className} style={{ y, opacity, scale }}>
      {children}
    </motion.div>
  );
}

/**
 * The floating product panel the visuals live in — a browser/app window, not a
 * marketing card.
 *
 * **It is ALWAYS light, including on the dark bands, and that is deliberate.**
 * The first version gave the dark band a translucent `bg-white/[0.06]` window
 * so the panel would "belong" to its band. It rendered our real product
 * mockups — which are built for a white surface, with `text-stone-700` rows and
 * hairline `stone-100` dividers — as dark text on a dark green field. Unreadable,
 * and unreadable in exactly the place we were showing the product off.
 *
 * A light panel on a dark band is also what every product page doing this well
 * does (Slack, Linear, Vercel): the dark band is the STAGE, the light window is
 * the thing on it. The contrast between them is the point, not a mistake to
 * blend away.
 */
export function AppWindow({
  title,
  meta,
  bleed,
  className,
  children,
}: {
  title: string;
  meta?: string;
  /**
   * Accepted and IGNORED. The panels used to run off the page edge; two rounds
   * of user review killed the idea outright, and the prop is kept only so the
   * call sites read honestly about intent. History, because it is the kind of
   * thing that gets re-added: bleeding by 12vw sliced the row pills in half;
   * pulling the bleed to 5vw and adding it back as inner padding stopped the
   * slicing but left a dead white gutter down the side of every card, which
   * read as a broken, unfinished panel. **A product mockup whose rows anchor
   * content to both edges cannot be cropped and cannot be inset — it has to sit
   * whole.** The asymmetry the bleed was buying now comes from the band's
   * 0.86/1.14 column ratio and the side flip, which cost nothing.
   */
  bleed?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  void bleed;
  return (
    <div
      aria-hidden="true"
      className={cn(
        /* The panel lifts a little under the cursor. It is decorative and not
           focusable, so this is atmosphere rather than affordance — but a page
           where nothing at all responds to the pointer reads as a picture of a
           product instead of a product. */
        "group/window w-full overflow-hidden rounded-editorial bg-white shadow-overlay ring-1 ring-inset ring-stone-900/5 transition-transform duration-500 hover:-translate-y-1 motion-reduce:transition-none",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-stone-100 px-5 py-3.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <i className="h-2.5 w-2.5 rounded-pill bg-stone-200" />
          <i className="h-2.5 w-2.5 rounded-pill bg-stone-200" />
          <i className="h-2.5 w-2.5 rounded-pill bg-stone-200" />
        </span>
        <span className="ml-1.5 text-[13px] font-extrabold text-stone-800">{title}</span>
        {/* stone-500, not stone-400. This sits on the panel's `bg-white` at
            11px, which WCAG counts as normal text (large = 18.66px bold), so it
            needs 4.5:1. stone-400 (#a8a29e) is 2.45:1 and axe flagged it serious
            on the landing crawl — the 2026-08-16 audit's only P0. stone-500
            (#78716c) is 4.80:1 and still reads as the de-emphasised meta label
            it is. */}
        {meta && (
          <span className="ml-auto shrink-0 text-[11px] font-extrabold uppercase tracking-[0.1em] text-stone-500">
            {meta}
          </span>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/**
 * One band of the alternating run: a copy column and a product visual that
 * swap sides via `flip`.
 *
 * Two things do the heavy lifting and are easy to undo by accident:
 * 1. **The visual bleeds outward** (`md:-mr-[12vw]` / `md:-ml-[12vw]`) so the
 *    band uses the whole page width instead of stopping at a 1160px measure.
 *    Removing that is what makes it collapse back into a centred card.
 * 2. **The copy column sticks** while the visual scrolls past on desktop —
 *    Slack's core move. It needs the band to be taller than the copy, which is
 *    why the visual is oversized rather than fitted.
 */
export function SplitBand({
  tone = "cream",
  eyebrow,
  title,
  body,
  bullets,
  footer,
  visual,
  flip,
  id,
  curveBottom,
  curveBottomInset,
  curveTop,
}: {
  tone?: Tone;
  eyebrow: string;
  title: ReactNode;
  body: string;
  bullets?: string[];
  footer?: ReactNode;
  visual: ReactNode;
  flip?: boolean;
  id?: string;
  curveBottom?: string;
  curveBottomInset?: string;
  curveTop?: string;
}) {
  const dark = tone === "dark";
  return (
    <Band
      tone={tone}
      id={id}
      curveBottom={curveBottom}
      curveBottomInset={curveBottomInset}
      curveTop={curveTop}
    >
      {/* 1240px, not the `wide` role (1152px): the landing rides its own editorial
          rail, set with the band curves and mockup widths. Bespoke override. */}
      <PageContainer width="wide" className="grid max-w-[1240px] items-center gap-8 px-6 md:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] md:gap-16">
        <div className={cn("md:sticky md:top-32", flip && "md:order-2")}>
          <span
            className={cn(
              "text-[13px] font-extrabold uppercase tracking-[0.14em]",
              dark ? "text-malachite-300" : "text-malachite-800",
            )}
          >
            {eyebrow}
          </span>
          <h2
            className={cn(
              "mt-3.5 font-serif font-semibold leading-[1.06] tracking-[-0.01em]",
              TYPE.h2,
              dark ? "text-white" : "text-stone-900",
            )}
          >
            {title}
          </h2>
          <p
            className={cn(
              "mt-5 max-w-[44ch] text-[17px] leading-relaxed",
              dark ? "text-white/70" : "text-stone-600",
            )}
          >
            {body}
          </p>
          {bullets && (
            <ul className="mt-6 space-y-3 md:mt-7 md:space-y-3.5">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-[3px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-pill text-[10px] font-black",
                      dark ? "bg-malachite-600 text-malachite-950" : "bg-malachite-100 text-malachite-800",
                    )}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  <span
                    className={cn(
                      "text-[15px] font-semibold",
                      dark ? "text-white/80" : "text-stone-700",
                    )}
                  >
                    {b}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {footer && <div className="mt-8">{footer}</div>}
        </div>

        {/* NO bleed. See AppWindow's `bleed` prop for why the edge-crop was
            abandoned twice. The band still reads asymmetric because the columns
            are 0.86/1.14 and the sides flip per band. */}
        <Rise className={cn(flip && "md:order-1", "min-w-0")}>
          {visual}
        </Rise>
      </PageContainer>
    </Band>
  );
}
