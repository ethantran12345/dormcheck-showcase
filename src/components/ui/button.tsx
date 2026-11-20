import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { haptic as hapticFeedback } from "@/lib/haptics";

const buttonVariants = cva(
  "group/button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-ios active:translate-y-0 active:scale-[0.97] active:shadow-none motion-reduce:transform-none motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:translate-y-0 disabled:scale-100 disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-current [&_svg]:transition-transform [&_svg]:duration-150 [&_svg]:ease-ios group-hover/button:[&_svg]:scale-[1.04] group-active/button:[&_svg]:scale-[0.94] motion-reduce:[&_svg]:transform-none motion-reduce:[&_svg]:transition-none",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:-translate-y-px hover:bg-primary/90 hover:shadow-raised [&_svg]:text-primary-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:-translate-y-px hover:bg-destructive/90 hover:shadow-raised [&_svg]:text-destructive-foreground",
        outline:
          "border border-input bg-background text-foreground hover:bg-muted/80 hover:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:-translate-y-px hover:bg-secondary/80 hover:shadow-raised [&_svg]:text-secondary-foreground",
        ghost: "hover:bg-muted/80 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline active:scale-100 [&_svg]:text-primary",
      },
      size: {
        default: "h-10 px-4 py-2",
        // No radius here: size must not re-decide shape. The base carries the
        // `control` tier (12) and these `rounded-md` (14) overrides silently
        // un-did it — a button's corner is set by what it IS, not how big it is.
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Opt-in native haptic on press (no-op on web). Reserve for commit actions
   * ("light"/"medium") and tab/toggle switches ("selection") — not every button.
   */
  haptic?: "light" | "medium" | "selection";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, haptic, onClick, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const handleClick = haptic
      ? (e: React.MouseEvent<HTMLButtonElement>) => {
          hapticFeedback[haptic]();
          onClick?.(e);
        }
      : onClick;
    // Merge className outside buttonVariants so tailwind-merge can resolve conflicts
    // (e.g. outline's text-foreground / border-input vs consumer text-malachite-600 / border-malachite-600).
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} onClick={handleClick} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
