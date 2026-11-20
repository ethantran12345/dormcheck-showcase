import { Toaster as Sonner, toast } from "sonner";
import { useTheme } from "@/contexts/ThemeContext";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme}
      position="bottom-center"
      mobileOffset={{ bottom: "7rem" }}
      className="toaster group sonner-responsive"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-overlay",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          // Malachite success accent; destructive error accent. Left rule + icon tint,
          // theme-token-driven so dark mode follows for free.
          success:
            "group-[.toaster]:border-l-4 group-[.toaster]:border-l-malachite-600 [&_[data-icon]]:text-malachite-600",
          error:
            "group-[.toaster]:border-l-4 group-[.toaster]:border-l-destructive [&_[data-icon]]:text-destructive",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
