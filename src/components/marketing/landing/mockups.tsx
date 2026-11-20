import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { GrowBar } from "@/components/marketing/landing/motion";
import { DUR, EASE } from "@/components/marketing/landing/tokens";

/**
 * Faithful in-page product mockups for the landing redesign. These mirror the
 * live app's card language (rounded-xl, border-stone-200, white, shadow-raised) and
 * real marketplace row anatomy (thumb + title + subline + bold price) so the
 * marketing page previews look like the actual product, not generic cards.
 * All content is static demo data; every mockup is decorative (aria-hidden is
 * applied by the parent where the same info is conveyed in text).
 */

export function ProductCard({
  icon,
  title,
  tag,
  tagTone = "muted",
  children,
  className,
}: {
  icon: string;
  title: string;
  tag: string;
  tagTone?: "muted" | "uni";
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "shrink-0 rounded-xl border border-stone-200 bg-white p-5 shadow-raised",
        className,
      )}
    >
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[15px] font-extrabold text-stone-900">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-malachite-100 text-xs text-malachite-800">
            {icon}
          </span>
          {title}
        </span>
        <span
          className={cn(
            "text-right text-[11.5px] font-extrabold uppercase tracking-wider",
            tagTone === "uni" ? "text-malachite-800" : "text-stone-500",
          )}
        >
          {tag}
        </span>
      </div>
      {children}
    </div>
  );
}

/** A truthful capability row for public marketing surfaces. It describes what
 * the product does without inventing a student, listing, conversation, or
 * activity count. */
export function CapabilityRow({
  label,
  detail,
}: {
  label: string;
  detail: string;
}) {
  return (
    <div className="border-t border-stone-900/10 px-2 py-3 first:border-t-0">
      <p className="text-[15px] font-extrabold text-stone-900">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold leading-relaxed text-stone-600">{detail}</p>
    </div>
  );
}

/**
 * A checklist row. `index` opts it into the band's scroll-in choreography: rows
 * arrive in sequence and, on a row that is already done, **the tick lands after
 * the row does**, so a static mockup reads as a list being worked through rather
 * than a screenshot. Everything is transform/opacity and goes inert under
 * prefers-reduced-motion.
 */
export function CheckRow({
  done,
  strike,
  label,
  pill,
  pillTone = "green",
  index,
}: {
  done?: boolean;
  strike?: boolean;
  label: string;
  pill?: ReactNode;
  pillTone?: "green" | "gray";
  index?: number;
}) {
  const reduce = useReducedMotion();
  const animate = !reduce && index != null;
  const delay = (index ?? 0) * 0.12;

  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 8 } : false}
      whileInView={animate ? { opacity: 1, y: 0 } : undefined}
      viewport={{ once: true, amount: 0.6 }}
      transition={{ duration: DUR.fast, ease: EASE, delay }}
      className="group/row flex items-center gap-3 rounded-control border-t border-dashed border-stone-900/10 px-2 py-2 text-[14.5px] font-semibold text-stone-700 transition-colors first:border-t-0 hover:bg-malachite-50/70 motion-reduce:transition-none"
    >
      <motion.span
        initial={animate && done ? { scale: 0.2, opacity: 0 } : false}
        whileInView={animate && done ? { scale: 1, opacity: 1 } : undefined}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: DUR.fast, ease: EASE, delay: delay + 0.22 }}
        className={cn(
          "grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full border-[1.5px] text-[10px] text-white",
          done ? "border-malachite-600 bg-malachite-600" : "border-stone-900/20",
        )}
      >
        {done ? "✓" : ""}
      </motion.span>
      <span className={cn(strike && "text-stone-500 line-through")}>{label}</span>
      {pill && (
        <span
          className={cn(
            "ml-auto rounded-full px-2.5 py-0.5 text-xs font-extrabold",
            pillTone === "green" ? "bg-malachite-50 text-malachite-800" : "bg-tint-100 text-stone-600",
          )}
        >
          {pill}
        </span>
      )}
    </motion.div>
  );
}

/** Progress bar; animates to width on first view (static under reduced motion). */
export function ProgressBar({ pct }: { pct: number }) {
  return <GrowBar pct={pct} />;
}

/* Real product photos (Unsplash, committed to public/landing/) so the
   marketplace mockups read as the actual app, not generated placeholders. */
const THUMB_PHOTOS: Record<string, string> = {
  fridge: "/landing/fridge.jpg",
  book: "/landing/textbook.jpg",
  futon: "/landing/futon.jpg",
  lamp: "/landing/lamp.jpg",
};

export function ListingRow({
  thumb,
  title,
  sub,
  price,
  sold,
}: {
  thumb: keyof typeof THUMB_PHOTOS;
  title: string;
  sub: string;
  price: string;
  sold?: boolean;
}) {
  return (
    <div className="group/listing flex items-center gap-3 rounded-control border-t border-stone-100 px-2 py-2 transition-colors first:border-t-0 hover:bg-tint-50 motion-reduce:transition-none">
      <span className="h-[46px] w-[46px] shrink-0 overflow-hidden rounded-[10px] border border-stone-200">
        <img
          src={THUMB_PHOTOS[thumb]}
          alt=""
          loading="lazy"
          draggable={false}
          className="h-full w-full object-cover transition-transform duration-500 group-hover/listing:scale-110 motion-reduce:transition-none"
        />
      </span>
      <div className="min-w-0">
        <div className="text-[14.5px] font-extrabold leading-tight text-stone-900">{title}</div>
        <div className="text-[12.5px] font-semibold text-stone-600">{sub}</div>
      </div>
      <span
        className={cn(
          "ml-auto text-[15px] font-black",
          sold ? "text-malachite-800" : "text-stone-900",
        )}
      >
        {price}
      </span>
    </div>
  );
}

/**
 * A chat bubble. With `index` the bubbles arrive one after another as the band
 * scrolls in — and they slide in from the side they belong to, so the thread
 * reads as a conversation happening rather than a screenshot of one.
 */
export function ChatMsg({
  me,
  children,
  index,
}: {
  me?: boolean;
  children: ReactNode;
  index?: number;
}) {
  const reduce = useReducedMotion();
  const animate = !reduce && index != null;
  return (
    <motion.div
      initial={animate ? { opacity: 0, x: me ? 16 : -16, scale: 0.97 } : false}
      whileInView={animate ? { opacity: 1, x: 0, scale: 1 } : undefined}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ duration: DUR.fast, ease: EASE, delay: (index ?? 0) * 0.16 }}
      className={cn(
        "mt-2 rounded-xl px-3.5 py-2 text-sm font-semibold text-stone-700 first:mt-0",
        me ? "bg-malachite-100" : "bg-tint-100",
      )}
    >
      {children}
    </motion.div>
  );
}
