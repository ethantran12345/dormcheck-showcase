import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * (`!size-3`: a hint often sits inside a <Button>, whose `[&_svg]:size-4` would
 * otherwise win the cascade and blow the glyph up to 16px.)
 *
 * One physical key, drawn as a quiet keycap: card surface, hairline border with a
 * slightly heavier bottom edge for depth, muted Nunito. Never green: a hint
 * points at a key, not at an action, so it must not spend one of the screen's
 * three green moments (DESIGN.md, The Three Greens Rule).
 *
 * Render glyph keys (⌘, ↵, arrows) as a Lucide icon child with `aria-hidden`
 * and put the spoken name in `label`; letters can be plain text children.
 * Callers gate visibility with `useShowKeyboardHints()`: hints never render on
 * touch or in the native shell.
 */
const Kbd = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement> & { label?: string }>(
  ({ className, children, label, ...props }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-b-2 border-border bg-card px-1 font-sans text-xs font-semibold leading-none text-muted-foreground [&_svg]:!size-3 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      {label ? <span className="sr-only">{label}</span> : null}
    </kbd>
  ),
);
Kbd.displayName = "Kbd";

export { Kbd };
