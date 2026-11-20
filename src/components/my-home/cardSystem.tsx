import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The single card language for the whole My Home page. Every section — the
 * countdown hero, the setup journey, the at-a-glance tiles, and the dashboard
 * widgets — reaches for `MY_HOME_CARD` so radius, border, surface, and shadow
 * stay identical. State accents (a current-step ring, a done badge, a tinted
 * roommate card) layer *on top* of this base; the base itself never forks.
 *
 * Keep this the only place these four properties are defined for My Home. If a
 * card needs to look different, it earns that difference with an explicit extra
 * class next to `MY_HOME_CARD`, not a divergent copy of the base.
 */
export const MY_HOME_CARD = 'rounded-card border border-border bg-card shadow-flat';

/**
 * The "go to the full surface" link at the foot of a widget (view all messages,
 * view all listings). Secondary by role — the widget's own rows are what the
 * student came to interact with — but it is still an ACTION, and it used to be
 * `text-muted-foreground`, i.e. the single lowest-contrast thing on the card
 * (design-audit A-4). It now sits at `text-foreground` with semibold weight, so
 * it is the most available text in its block without spending a green.
 *
 * Deliberately NOT green. DESIGN.md budgets roughly three green moments per
 * screen and My Home already spends its primary-action green on the HomeHero
 * CTA; greening six widget footers would rebuild exactly the flattened noise the
 * Phase 1.7 subtractive pass removed. DESIGN.md's own answer for everything
 * below the primary action is "warm neutral surfaces and type weight", which is
 * what this is.
 */
export const WIDGET_FOOTER_LINK =
  'text-sm font-semibold text-foreground underline-offset-4 transition-colors hover:underline';

/**
 * The call to action inside a widget's EMPTY state. Different role from
 * `WIDGET_FOOTER_LINK`: when a widget has no content this is the only thing on
 * the card to act on, so it earns a real hit area and a hover wash rather than
 * reading as one more line of caption text.
 *
 * Deliberately NO border, which is the non-obvious part. The first draft of this
 * was a bordered pseudo-button, but `border-border` measures 1.24:1 against
 * `card` in light and 1.39:1 in dark — `.claude/rules/design-system.md` says in
 * terms that the hairline is "a decorative ~1.1:1 boundary, so don't rely on it
 * alone where a boundary is essential", and on a button the boundary IS the
 * affordance. No neutral fill clears the 3:1 bar in both themes either
 * (`bg-secondary` passes at 8.96:1 in light but collapses to 1.21:1 in dark;
 * `bg-muted` fails both at 1.09:1). Drawing a box that fails 3:1 would add a
 * conformance liability without adding conformance.
 *
 * So the control identifies itself the way WCAG 1.4.11 actually allows: by a
 * high-contrast text label (20.4:1 light, 15.7:1 dark) rather than by its
 * boundary, with `min-h-11` for the 44px touch target and a focus ring that does
 * clear 3:1 (4.27:1 light, 8.94:1 dark).
 */
export const WIDGET_EMPTY_CTA =
  'inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 py-2 ' +
  'text-sm font-semibold text-foreground transition-colors hover:bg-accent ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/**
 * The uniform section label above each block ("Finish setting up", "At a
 * glance", …): a small uppercase heading, a hairline rule that fills the row,
 * and an optional trailing counter. One component so the section rhythm is
 * identical everywhere instead of re-typed per section.
 */
export function SectionHeading({
  title,
  trailing,
  className,
}: {
  title: string;
  /** Optional right-aligned annotation, e.g. "2 of 4". */
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-center gap-2.5 px-0.5', className)}>
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <span aria-hidden className="h-px flex-1 bg-border" />
      {trailing != null ? (
        <span className="text-xs font-semibold text-muted-foreground">{trailing}</span>
      ) : null}
    </div>
  );
}
