import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

// shadcn Bubble (Radix variant), adapted for Tailwind 3.4 + @radix-ui/react-slot.
// The default color skin is intentionally NOT shipped — DormCheck drives the
// surface via `bubbleSurfaceClass` (malachite) on BubbleContent, so Bubble here
// is a thin structural wrapper (alignment + width) that keeps the shadcn
// data-slot contract.

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-group"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    />
  )
}

function Bubble({
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="bubble"
      data-align={align}
      className={cn(
        "group/bubble relative flex w-fit min-w-0 flex-col gap-1 data-[align=end]:self-end",
        className
      )}
      {...props}
    />
  )
}

function BubbleContent({
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot : "div"

  return (
    <Comp
      data-slot="bubble-content"
      className={cn(
        "w-fit max-w-full min-w-0 overflow-hidden break-words",
        className
      )}
      {...props}
    />
  )
}

export { BubbleGroup, Bubble, BubbleContent }
