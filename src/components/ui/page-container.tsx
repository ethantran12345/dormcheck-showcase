import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * THE CONTENT-WIDTH CONTRACT — Identity P2 (Renewal Build Queue item 12).
 * Sibling of the haptic contract in src/lib/haptics.ts: the rule lives HERE,
 * in the thing you have to import, not in a doc nobody opens.
 *
 * WHY THIS EXISTS. Before this file, 290 `max-w-*` utilities were spread across
 * src/**\/*.tsx in 16+ distinct values, and every screen picked its own reading
 * width by hand. 107 of those sat on an `mx-auto` page container — meaning the
 * app's measure visibly JUMPED as you moved between routes (2xl on Notifications,
 * 4xl on Activity, 5xl on Team, 6xl on Dashboard, screen-2xl on DormEdit, 7xl on
 * Marketplace). That is one of the strongest "assembled, not designed" tells, and
 * it is self-healing debt in reverse: a new screen invented a width because there
 * was nothing to inherit.
 *
 * THE RULE, in one line: a page's body width is a ROLE, not a number. Pick the
 * role; never retype the number.
 *
 *   NARROW  (max-w-lg,  512px) — a focused single-column flow. Invite accept,
 *                                shared-link landing, onboarding step, one form.
 *   CONTENT (max-w-2xl, 672px) — THE DEFAULT. A standard app screen's body: a
 *                                feed, a settings list, a detail page.
 *   PROSE   (max-w-3xl, 768px) — long-form reading. Legal, policy, a report.
 *                                Wider than CONTENT only because running text
 *                                wants ~70ch, not because it holds more UI.
 *   WIDE    (max-w-6xl, 1152px)— a dashboard or multi-column grid that genuinely
 *                                needs the room. Admin consoles, marketplace grids.
 *
 * Full-bleed is NOT a role — it is the absence of a container. Do not reach for
 * `<PageContainer width="none">`; just don't wrap.
 *
 * HOW TO USE IT. This component supplies `mx-auto w-full max-w-*` and NOTHING
 * else — padding, spacing and layout stay at the call site, because those really
 * do differ per screen and forcing them here would only push the drift somewhere
 * less visible.
 *
 *     <PageContainer as="main" width="content" className="px-4 py-6 space-y-5">
 *
 * WHEN YOU NEED SOMETHING ELSE. A responsive widen (`lg:max-w-[1440px]`) or a
 * bespoke measure is allowed — pass it in `className`, it wins via tailwind-merge
 * — but WRITE THE REASON IN THE FILE on the line above. An unexplained bespoke
 * width is exactly the drift this replaces. `npm run lint:widths` ratchets the
 * grandfathered ones so their number can only go down.
 *
 * WHAT THIS IS NOT FOR. Component intrinsic sizing is a different thing and is
 * correct as-is: a Dialog's `max-w-md`, a chat bubble's `max-w-[85%]`, an image's
 * `max-w-full`, a caption's `max-w-sm` text measure. Those are the size of a
 * THING. This component is only for the element that decides how wide a SCREEN
 * reads. Global chrome (TopNav, Footer) is likewise its own rail, not page body.
 */

export const PAGE_WIDTHS = {
  narrow: "max-w-lg",
  content: "max-w-2xl",
  prose: "max-w-3xl",
  wide: "max-w-6xl",
} as const;

export type PageWidth = keyof typeof PAGE_WIDTHS;

const pageContainerVariants = cva("mx-auto w-full", {
  variants: {
    width: PAGE_WIDTHS,
  },
  defaultVariants: {
    width: "content",
  },
});

type PageContainerElement = "div" | "main" | "header" | "section" | "article" | "footer" | "ul";

export interface PageContainerProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof pageContainerVariants> {
  /** Element to render. Defaults to `div`; use `main`/`header` where semantics call for it. */
  as?: PageContainerElement;
}

/**
 * The page content container. See the contract above: pick a ROLE, never a number.
 */
export const PageContainer = React.forwardRef<HTMLElement, PageContainerProps>(
  ({ as: Tag = "div", width, className, ...props }, ref) => {
    const Component = Tag as React.ElementType;
    return (
      <Component
        ref={ref}
        className={cn(pageContainerVariants({ width }), className)}
        {...props}
      />
    );
  },
);
PageContainer.displayName = "PageContainer";
