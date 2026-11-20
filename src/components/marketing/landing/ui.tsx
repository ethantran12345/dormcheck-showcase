import { Link } from "react-router";
import { TYPE } from "@/components/marketing/landing/tokens";
import { cn } from "@/lib/utils";

/**
 * Shared visual language for the marketing site (one system, consolidated
 * 2026-07-12): serif display headlines on the tokens.ts type scale, tint
 * paper, malachite bands, pill CTAs (solid = malachite-800 for AA white text;
 * #03C03C stays accent-only).
 *
 * Shape/elevation follow the Phase 1.8 tiers by ROLE, not by size (Phase 2
 * item 2): `rounded-editorial` for page-level moment surfaces (the closing
 * box), `rounded-card` for standard marketing cards, `rounded-control` for
 * inner chips, `rounded-pill` for CTAs and badges. The hand-picked
 * `rounded-[22px]`/`rounded-[28px]` values these replaced were the reason the
 * marketing pages read as one undifferentiated radius. Shadows use the warm
 * `shadow-flat/raised/overlay` tokens — the arbitrary `rgba(15,23,42,…)` casts
 * they replaced were cool slate-900, the exact hue the warm re-anchor removed.
 */

export const WRAP = "mx-auto w-full max-w-[1160px] px-6";

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "text-[13px] font-extrabold uppercase tracking-[0.14em] text-malachite-800",
        className,
      )}
    >
      {children}
    </span>
  );
}

type CtaProps = {
  children: React.ReactNode;
  className?: string;
} & ({ to: string; href?: never } | { href: string; to?: never });

function CtaLink({ to, href, className, children }: CtaProps) {
  if (to) {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

export function PrimaryCta({ children, className, ...link }: CtaProps) {
  return (
    <CtaLink
      {...link}
      className={cn(
        "inline-flex items-center gap-2 rounded-pill bg-malachite-800 px-6 py-3.5 text-base font-extrabold text-white transition-all hover:-translate-y-px hover:bg-malachite-900 active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none",
        className,
      )}
    >
      {children}
    </CtaLink>
  );
}

export function GhostCta({ children, className, ...link }: CtaProps) {
  return (
    <CtaLink
      {...link}
      className={cn(
        "inline-flex items-center gap-2 rounded-pill border border-stone-900/10 bg-white px-6 py-3.5 text-base font-extrabold text-stone-900 transition-all hover:-translate-y-px hover:border-malachite-600 hover:text-malachite-800 active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none",
        className,
      )}
    >
      {children}
    </CtaLink>
  );
}

/** Small hero badge: malachite dot + a short truthful line. Optional link. */
export function HeroBadge({
  to,
  href,
  children,
  className,
}: {
  to?: string;
  href?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const cls = cn(
    "inline-flex items-center gap-2 rounded-pill bg-malachite-100 px-3.5 py-1.5 text-[12.5px] font-extrabold tracking-[0.02em] text-malachite-800",
    (to || href) && "transition-colors hover:bg-malachite-200 motion-reduce:transition-none",
    className,
  );
  const inner = (
    <>
      <span className="h-1.5 w-1.5 rounded-pill bg-malachite-600" aria-hidden="true" />
      {children}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cls}>
        {inner}
      </Link>
    );
  }
  if (href) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }
  return <span className={cls}>{inner}</span>;
}

/** Check-bulleted list used across marketing sections. */
export function CheckList({
  items,
  className,
  itemClassName,
  checkClassName = "text-malachite-700",
}: {
  items: string[];
  className?: string;
  itemClassName?: string;
  checkClassName?: string;
}) {
  return (
    <ul className={className}>
      {items.map((item) => (
        <li
          key={item}
          className={cn(
            "flex items-start gap-2.5 py-1.5 font-semibold text-stone-700",
            itemClassName,
          )}
        >
          <span className={cn("font-black", checkClassName)} aria-hidden="true">
            ✓
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * Standard section heading: eyebrow + serif H2 (tokens H2 size) + optional
 * lede. Replaces the hand-rolled header blocks across the marketing pages.
 */
export function SectionHead({
  eyebrow,
  title,
  align = "center",
  className,
  eyebrowClassName,
  children,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  align?: "center" | "left";
  className?: string;
  eyebrowClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "max-w-[640px]",
        align === "center" ? "mx-auto text-center" : "text-left",
        className,
      )}
    >
      {eyebrow && <Eyebrow className={eyebrowClassName}>{eyebrow}</Eyebrow>}
      <h2 className={cn("mt-3 font-serif font-semibold leading-[1.08] text-stone-900", TYPE.h2)}>
        {title}
      </h2>
      {children && <p className="mt-4 text-lg text-stone-700">{children}</p>}
    </div>
  );
}

/** Centered page header for interior marketing pages. */
export function PageHead({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[680px] pt-8 text-center md:pt-14">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className={cn("mt-3 font-serif font-semibold leading-[1.08] text-stone-900", TYPE.h2)}>
        {title}
      </h1>
      {children && <p className="mt-4 text-lg text-stone-700">{children}</p>}
    </div>
  );
}

/**
 * Boxed closing CTA, the one final-CTA treatment for every marketing page.
 * tone: tint (default paper box), malachite (soft green box), dark (deep green).
 */
export function ClosingCta({
  title,
  sub,
  tone = "tint",
  badge,
  children,
}: {
  title: React.ReactNode;
  sub: string;
  tone?: "tint" | "malachite" | "dark";
  /** optional small pill above the title (e.g. "Extension, not replacement") */
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="pb-24 pt-10 text-center">
      <div className={WRAP}>
        <div
          className={cn(
            "rounded-editorial px-8 py-16 md:py-20",
            tone === "tint" && "bg-tint-100",
            tone === "malachite" && "bg-malachite-50 shadow-raised",
            tone === "dark" && "bg-gradient-to-br from-malachite-900 to-malachite-950",
          )}
        >
          {badge && <div className="mb-4">{badge}</div>}
          <h2
            className={cn(
              "font-serif font-medium leading-[1.08]",
              TYPE.h2,
              tone === "dark" ? "text-white" : "text-stone-900",
            )}
          >
            {title}
          </h2>
          <p
            className={cn(
              "mx-auto mb-8 mt-4 max-w-[52ch] text-lg",
              tone === "dark" ? "text-white/85" : "text-stone-700",
            )}
          >
            {sub}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3.5">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** Hoverable feature card with an icon chip (interior pages). */
export function SiteCard({
  icon,
  title,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-3 rounded-card border border-stone-200 bg-white p-6 shadow-flat transition-all hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none",
        className,
      )}
    >
      <span className="grid h-11 w-11 place-items-center rounded-control bg-malachite-100 text-malachite-800" aria-hidden="true">
        {icon}
      </span>
      <h3 className="font-serif text-[19px] font-semibold leading-snug text-stone-900">{title}</h3>
      <div className="text-[14.5px] leading-relaxed text-stone-600">{children}</div>
    </div>
  );
}
