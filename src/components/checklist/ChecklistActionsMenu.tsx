import {
  CheckSquare,
  ClipboardPaste,
  FileDown,
  MoreVertical,
  RotateCcw,
  ShoppingBag,
  Users2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * List-level actions menu, extracted from the old ChecklistTopBar so the actions
 * survive its removal on the personal readiness view - now surfaced as a compact
 * `⋯` on the readiness summary card (mobile banner + desktop rail). Reuses the
 * existing `checklist:topbar.*` / `checklist:actions.*` copy (no new strings).
 */
export type ChecklistActionsMenuProps = {
  hasCheckedItems: boolean;
  hasShopEssentialsItems: boolean;
  onImportNotes: () => void;
  onExportPDF: () => void;
  onResetToDefault: () => void;
  onClearChecked: () => void;
  onClearShopEssentials: () => void;
  /** Group lists add Invite + Manage; hidden on the personal list. */
  isGroupContext: boolean;
  onInvite: () => void;
  onManageGroup: () => void;
  /** Personal-list "Split costs with a roommate"; hidden when omitted. */
  onSplitCosts?: () => void;
  /** Confirmed-roommate-group create flow; hidden when omitted. */
  onConfirmRoommates?: () => void;
  className?: string;
};

export function ChecklistActionsMenu({
  hasCheckedItems,
  hasShopEssentialsItems,
  onImportNotes,
  onExportPDF,
  onResetToDefault,
  onClearChecked,
  onClearShopEssentials,
  isGroupContext,
  onInvite,
  onManageGroup,
  onSplitCosts,
  onConfirmRoommates,
  className,
}: ChecklistActionsMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600",
            className,
          )}
          aria-label={t("checklist:topbar.actions")}
        >
          <MoreVertical className="h-4 w-4" strokeWidth={2} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {onConfirmRoommates ? (
          <>
            {/* Roommate confirmation lives on the My Roommates page, not here -
                route there and auto-open the confirm flow (?confirm=1) rather
                than popping the modal over Shop Essentials. */}
            <DropdownMenuItem onSelect={() => navigate("/roommates/us?confirm=1")}>
              <Users2 className="mr-2 h-4 w-4" />
              {t("checklist:topbar.confirmRoommates")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {onSplitCosts ? (
          <>
            <DropdownMenuItem onSelect={onSplitCosts}>
              <Users2 className="mr-2 h-4 w-4" />
              {t("checklist:page.splitCostsWithRoommate")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={onImportNotes}>
          <ClipboardPaste className="mr-2 h-4 w-4" />
          {t("checklist:topbar.importNotes")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onExportPDF}>
          <FileDown className="mr-2 h-4 w-4" />
          {t("checklist:topbar.exportPdf")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onResetToDefault}>
          <RotateCcw className="mr-2 h-4 w-4" />
          {t("checklist:topbar.resetToDefaultList")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onClearChecked} disabled={!hasCheckedItems}>
          <CheckSquare className="mr-2 h-4 w-4" />
          {t("checklist:topbar.clearAllChecked")}
        </DropdownMenuItem>
        {hasShopEssentialsItems ? (
          <DropdownMenuItem onSelect={onClearShopEssentials}>
            <ShoppingBag className="mr-2 h-3.5 w-3.5" strokeWidth={2} />
            {t("checklist:topbar.clearShopEssentialsItems")}
          </DropdownMenuItem>
        ) : null}
        {isGroupContext ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onInvite}>
              <Users2 className="mr-2 h-4 w-4" />
              {t("checklist:actions.invite")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onManageGroup}>
              {t("checklist:topbar.manageGroup")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
