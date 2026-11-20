import * as React from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * AdaptiveOverlay — one overlay API that renders a mobile surface under 768px and a
 * centered Dialog at md+ (Credenza pattern). Width-driven only (useIsMobile). Both
 * branches are @radix-ui/react-dialog- or vaul-based, so open/onOpenChange semantics match.
 *
 * `mobileVariant` picks the mobile surface:
 *   - "sheet"  (default) — radix Sheet; byte-identical to today's Sheet call sites.
 *   - "drawer"           — vaul Drawer; byte-identical to today's Drawer call sites,
 *                          preserving swipe-to-dismiss, `shouldScaleBackground` and the
 *                          drag pill (which only exists on the mobile branch, so it never
 *                          renders at md+). Use for call sites migrating off `ui/drawer`.
 *
 * Either way, desktop is a centered Dialog with no drag handle, retiring the
 * bottom-sheet-on-desktop tell without changing iOS behavior.
 */

type MobileVariant = "sheet" | "drawer";

interface AdaptiveOverlayCtx {
  isMobile: boolean;
  variant: MobileVariant;
}

const AdaptiveOverlayContext = React.createContext<AdaptiveOverlayCtx>({
  isMobile: false,
  variant: "sheet",
});
const useAdaptive = () => React.useContext(AdaptiveOverlayContext);

type RootProps = React.ComponentProps<typeof Dialog> & {
  /** Mobile surface: radix Sheet (default) or vaul Drawer. */
  mobileVariant?: MobileVariant;
  /** Drawer-only: scale the page behind the sheet (vaul). Ignored on desktop / sheet variant. */
  shouldScaleBackground?: boolean;
};

const AdaptiveOverlay = ({
  children,
  mobileVariant = "sheet",
  shouldScaleBackground,
  ...props
}: RootProps) => {
  const isMobile = useIsMobile();
  const value = React.useMemo<AdaptiveOverlayCtx>(
    () => ({ isMobile, variant: mobileVariant }),
    [isMobile, mobileVariant],
  );

  let content: React.ReactNode;
  if (!isMobile) {
    content = <Dialog {...props}>{children}</Dialog>;
  } else if (mobileVariant === "drawer") {
    content = (
      <Drawer shouldScaleBackground={shouldScaleBackground} {...props}>
        {children}
      </Drawer>
    );
  } else {
    content = <Sheet {...props}>{children}</Sheet>;
  }

  return (
    <AdaptiveOverlayContext.Provider value={value}>{content}</AdaptiveOverlayContext.Provider>
  );
};

const AdaptiveOverlayTrigger = (props: React.ComponentProps<typeof DialogTrigger>) => {
  const { isMobile, variant } = useAdaptive();
  const Trigger = !isMobile ? DialogTrigger : variant === "drawer" ? DrawerTrigger : SheetTrigger;
  return <Trigger {...props} />;
};

const AdaptiveOverlayClose = (props: React.ComponentProps<typeof DialogClose>) => {
  const { isMobile, variant } = useAdaptive();
  const Close = !isMobile ? DialogClose : variant === "drawer" ? DrawerClose : SheetClose;
  return <Close {...props} />;
};

interface AdaptiveOverlayContentProps extends React.ComponentPropsWithoutRef<typeof DialogContent> {
  /** Sheet side used on the "sheet" mobile branch only. */
  side?: React.ComponentProps<typeof SheetContent>["side"];
  /** Extra classes applied on the mobile branch only. */
  mobileClassName?: string;
  /** Extra classes applied on the desktop Dialog branch only. */
  desktopClassName?: string;
  /** Drawer-only (mobile "drawer" variant): keep z above BottomNav/NativeTopBar. */
  priority?: boolean;
  /** Drawer-only: skip the dimmed overlay (map-under-sheet). */
  noOverlay?: boolean;
  /** Drawer-only: hide the centered drag pill. */
  hideDefaultHandle?: boolean;
  /** Class for the dimmed overlay (Drawer/Dialog). */
  overlayClassName?: string;
}

const AdaptiveOverlayContent = React.forwardRef<HTMLDivElement, AdaptiveOverlayContentProps>(
  (
    {
      side = "bottom",
      className,
      mobileClassName,
      desktopClassName,
      priority,
      noOverlay,
      hideDefaultHandle,
      overlayClassName,
      ...props
    },
    ref,
  ) => {
    const { isMobile, variant } = useAdaptive();
    if (!isMobile) {
      return (
        <DialogContent
          ref={ref}
          className={cn(className, desktopClassName)}
          overlayClassName={overlayClassName}
          {...props}
        />
      );
    }
    if (variant === "drawer") {
      return (
        <DrawerContent
          ref={ref}
          className={cn(className, mobileClassName)}
          priority={priority}
          noOverlay={noOverlay}
          hideDefaultHandle={hideDefaultHandle}
          overlayClassName={overlayClassName}
          {...props}
        />
      );
    }
    return (
      <SheetContent ref={ref} side={side} className={cn(className, mobileClassName)} {...props} />
    );
  },
);
AdaptiveOverlayContent.displayName = "AdaptiveOverlayContent";

const AdaptiveOverlayHeader = (props: React.HTMLAttributes<HTMLDivElement>) => {
  const { isMobile, variant } = useAdaptive();
  const Header = !isMobile ? DialogHeader : variant === "drawer" ? DrawerHeader : SheetHeader;
  return <Header {...props} />;
};

const AdaptiveOverlayFooter = (props: React.HTMLAttributes<HTMLDivElement>) => {
  const { isMobile, variant } = useAdaptive();
  const Footer = !isMobile ? DialogFooter : variant === "drawer" ? DrawerFooter : SheetFooter;
  return <Footer {...props} />;
};

const AdaptiveOverlayTitle = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof DialogTitle>
>((props, ref) => {
  const { isMobile, variant } = useAdaptive();
  const Title = !isMobile ? DialogTitle : variant === "drawer" ? DrawerTitle : SheetTitle;
  return <Title ref={ref} {...props} />;
});
AdaptiveOverlayTitle.displayName = "AdaptiveOverlayTitle";

const AdaptiveOverlayDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof DialogDescription>
>((props, ref) => {
  const { isMobile, variant } = useAdaptive();
  const Description = !isMobile
    ? DialogDescription
    : variant === "drawer"
      ? DrawerDescription
      : SheetDescription;
  return <Description ref={ref} {...props} />;
});
AdaptiveOverlayDescription.displayName = "AdaptiveOverlayDescription";

export {
  AdaptiveOverlay,
  AdaptiveOverlayTrigger,
  AdaptiveOverlayClose,
  AdaptiveOverlayContent,
  AdaptiveOverlayHeader,
  AdaptiveOverlayFooter,
  AdaptiveOverlayTitle,
  AdaptiveOverlayDescription,
};
