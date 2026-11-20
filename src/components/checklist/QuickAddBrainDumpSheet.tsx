import { type RefObject } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from "@/components/ui/drawer";

interface QuickAddBrainDumpSheetProps {
  open: boolean;
  /** false → dismiss (parent runs its close/reset). */
  onOpenChange: (open: boolean) => void;
  /** Commit every non-empty line (auto-categorized + deduped upstream). */
  onCommit: () => void;
  value: string;
  onChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
}

/**
 * Quick-add "brain dump" notepad shared by ChecklistGroupBoard and
 * ChecklistReadinessView (previously duplicated verbatim in both). Mobile: a
 * near-full-height vaul Drawer (swipe the header down to dismiss; Radix supplies
 * the focus trap, aria-modal, and Escape). Desktop: a centered Dialog. One item
 * per line; Done commits.
 */
export function QuickAddBrainDumpSheet({
  open,
  onOpenChange,
  onCommit,
  value,
  onChange,
  textareaRef,
}: QuickAddBrainDumpSheetProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const doneButton = (
    <Button
      type="button"
      haptic="light"
      onClick={onCommit}
      className="rounded-full bg-malachite-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-malachite-900 dark:bg-malachite-800 dark:hover:bg-malachite-900"
    >
      {t("checklist:v2.done")}
    </Button>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent hideDefaultHandle className="h-[90dvh] rounded-t-3xl border-0 bg-background">
          {/* Draggable header: X dismisses, Done commits, drag it down to close. */}
          <div className="flex shrink-0 cursor-grab touch-none items-center justify-between gap-2 border-b border-border px-3 py-3 active:cursor-grabbing">
            <DrawerClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
                aria-label={t("checklist:v2.close")}
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </Button>
            </DrawerClose>
            <DrawerTitle className="text-sm font-semibold text-foreground">
              {t("checklist:v2.quickAddTitle")}
            </DrawerTitle>
            {doneButton}
          </div>
          <p className="px-4 pt-3 text-xs text-muted-foreground">{t("checklist:v2.quickAddHint")}</p>
          <textarea
            ref={textareaRef}
            data-vaul-no-drag
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t("checklist:v2.quickAddPlaceholder")}
            aria-label={t("checklist:v2.quickAddTitle")}
            className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-base leading-7 text-foreground outline-none placeholder:text-muted-foreground"
          />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("checklist:v2.quickAddTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t("checklist:v2.quickAddHint")}</p>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("checklist:v2.quickAddPlaceholder")}
          aria-label={t("checklist:v2.quickAddTitle")}
          className="min-h-[220px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:border-malachite-600 focus:ring-1 focus:ring-malachite-600/30 placeholder:text-muted-foreground"
        />
        <DialogFooter>{doneButton}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
