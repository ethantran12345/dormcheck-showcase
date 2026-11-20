import * as React from "react";

import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

/**
 * Form-heavy modal that renders as a bottom sheet (vaul Drawer) on mobile
 * (<768px) and a centered Dialog on md+. Short confirm-style dialogs should
 * keep using Dialog directly.
 */

const ResponsiveModalContext = React.createContext(false);

interface ResponsiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

function ResponsiveModal({ open, onOpenChange, children }: ResponsiveModalProps) {
  const isMobile = useIsMobile();
  const Root = isMobile ? Drawer : Dialog;
  return (
    <ResponsiveModalContext.Provider value={isMobile}>
      <Root open={open} onOpenChange={onOpenChange}>
        {children}
      </Root>
    </ResponsiveModalContext.Provider>
  );
}

interface ResponsiveModalContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Extra classes applied only to the desktop DialogContent (e.g. sm:max-w-lg). */
  dialogClassName?: string;
}

const ResponsiveModalContent = React.forwardRef<HTMLDivElement, ResponsiveModalContentProps>(
  ({ className, dialogClassName, children, ...props }, ref) => {
    const isMobile = React.useContext(ResponsiveModalContext);
    if (isMobile) {
      return (
        <DrawerContent ref={ref} className={cn("px-4 pt-1", className)} {...props}>
          {children}
        </DrawerContent>
      );
    }
    return (
      <DialogContent
        ref={ref}
        className={cn("max-h-[90dvh] overflow-y-auto", className, dialogClassName)}
        {...props}
      >
        {children}
      </DialogContent>
    );
  },
);
ResponsiveModalContent.displayName = "ResponsiveModalContent";

function ResponsiveModalHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = React.useContext(ResponsiveModalContext);
  return isMobile ? <DrawerHeader {...props} className={cn("px-0", props.className)} /> : <DialogHeader {...props} />;
}

function ResponsiveModalFooter(props: React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = React.useContext(ResponsiveModalContext);
  return isMobile ? <DrawerFooter {...props} className={cn("px-0", props.className)} /> : <DialogFooter {...props} />;
}

function ResponsiveModalTitle(props: React.ComponentPropsWithoutRef<typeof DialogTitle>) {
  const isMobile = React.useContext(ResponsiveModalContext);
  return isMobile ? <DrawerTitle {...props} /> : <DialogTitle {...props} />;
}

function ResponsiveModalDescription(props: React.ComponentPropsWithoutRef<typeof DialogDescription>) {
  const isMobile = React.useContext(ResponsiveModalContext);
  return isMobile ? <DrawerDescription {...props} /> : <DialogDescription {...props} />;
}

export {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalFooter,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
};
