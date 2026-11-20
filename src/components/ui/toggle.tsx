import * as React from "react";
import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// shadcn Toggle, vendored for Tailwind 3.4 + @radix-ui/react-toggle (the current
// registry ships Tailwind v4 classes + the unified `radix-ui` package, neither of
// which this repo uses — same adaptation as src/components/ui/bubble.tsx).
// Conventions mirror button.tsx: same focus-visible ring, disabled treatment, and
// the `[&_svg]` sizing. The `brand` variant is DormCheck's segmented-control skin
// (malachite-800 "on" fill for AA on light) that Tranche 3's chip/segmented sweeps
// will reuse; `default`/`outline` keep the neutral shadcn behavior.
const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-control text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-transparent hover:bg-muted hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        outline:
          "border border-input bg-transparent hover:bg-muted hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        brand:
          "bg-card text-foreground hover:bg-accent data-[state=on]:bg-malachite-800 data-[state=on]:text-white dark:data-[state=on]:bg-malachite-800 dark:data-[state=on]:text-white",
      },
      size: {
        default: "h-10 min-w-10 px-3",
        sm: "h-9 min-w-9 px-2.5",
        lg: "h-11 min-w-11 px-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> &
    VariantProps<typeof toggleVariants>
>(({ className, variant, size, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size, className }))}
    {...props}
  />
));

Toggle.displayName = TogglePrimitive.Root.displayName;

export { Toggle, toggleVariants };
