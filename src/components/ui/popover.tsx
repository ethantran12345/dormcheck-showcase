import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";
import { useKeyboardOpen } from "@/hooks/useKeyboardInset";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

/** Current software-keyboard height in px (set on <html> by useKeyboardInset). */
function readKeyboardHeightPx(): number {
  if (typeof document === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--keyboard-height");
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, collisionPadding, ...props }, ref) => {
  // Radix positions the popover against the *window*, which on native iOS does not
  // shrink when the software keyboard appears - so a popover with an input can land
  // under the keyboard. When the keyboard is open, reserve its height as bottom
  // collision padding so radix shifts/flips the popover above it. No-op otherwise.
  const keyboardOpen = useKeyboardOpen();
  const resolvedCollisionPadding = React.useMemo(() => {
    if (!keyboardOpen) return collisionPadding;
    const kb = readKeyboardHeightPx();
    if (kb <= 0) return collisionPadding;
    const base = typeof collisionPadding === "number" ? collisionPadding : 8;
    return { top: base, left: base, right: base, bottom: kb + base };
  }, [keyboardOpen, collisionPadding]);

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={resolvedCollisionPadding}
        className={cn(
          "z-[10100] w-72 rounded-card border bg-popover p-4 text-popover-foreground shadow-overlay outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
