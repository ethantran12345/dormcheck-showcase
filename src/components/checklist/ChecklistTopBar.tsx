import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  CheckSquare,
  ClipboardPaste,
  FileDown,
  MoreVertical,
  Plus,
  RotateCcw,
  ShoppingBag,
  Users2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ChecklistTopBarGroup = {
  id: string;
  group_name?: string | null;
  is_owner?: boolean;
  owner_name?: string | null;
  collaborator_name?: string | null;
};

export type ChecklistTopBarMember = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

export function groupLabel(g: ChecklistTopBarGroup): string {
  return (
    g.group_name?.trim() ||
    (g.is_owner ? "My Group" : `${g.owner_name ?? "Unknown"} & ${g.collaborator_name ?? "Collaborator"}`)
  );
}

export type ChecklistTopBarProps = {
  hasGroups: boolean;
  groupsLoading: boolean;
  allGroups: ChecklistTopBarGroup[];
  isGroupContext: boolean;
  selectedGroupId: string | null;
  selectedGroupDisplayName: string | null;
  groupMembers: ChecklistTopBarMember[];
  groupDropdownOpen: boolean;
  onGroupDropdownOpenChange: (open: boolean) => void;
  onSelectPersonalList: () => void;
  onSelectGroup: (groupId: string) => void;
  onCreateNewList: () => void;
  onCollaborateFromPersonal: () => void;
  /** Personal-list "Split costs with a roommate" action; hidden when omitted. */
  onSplitCosts?: () => void;
  hasCheckedItems: boolean;
  hasShopEssentialsItems: boolean;
  onImportNotes: () => void;
  onExportPDF: () => void;
  onResetToDefault: () => void;
  onClearChecked: () => void;
  onClearShopEssentials: () => void;
  onInvite: () => void;
  onManageGroup: () => void;
  getInitials: (name: string | null | undefined) => string;
  /** Section collapse/expand controls (folded in from the old floating button). */
  canToggleSections?: boolean;
  allSectionsCollapsed?: boolean;
  onToggleAllSections?: () => void;
};

export function ChecklistTopBar({
  hasGroups,
  groupsLoading,
  allGroups,
  isGroupContext,
  selectedGroupId,
  selectedGroupDisplayName,
  groupMembers,
  groupDropdownOpen,
  onGroupDropdownOpenChange,
  onSelectPersonalList,
  onSelectGroup,
  onCreateNewList,
  onCollaborateFromPersonal,
  onSplitCosts,
  hasCheckedItems,
  hasShopEssentialsItems,
  onImportNotes,
  onExportPDF,
  onResetToDefault,
  onClearChecked,
  onClearShopEssentials,
  onInvite,
  onManageGroup,
  getInitials,
  canToggleSections = false,
  allSectionsCollapsed = false,
  onToggleAllSections,
}: ChecklistTopBarProps) {
  const { t } = useTranslation();
  const listLabel = selectedGroupDisplayName ?? t("checklist:topbar.personalList");
  const showMemberAvatars = isGroupContext && !!selectedGroupDisplayName && groupMembers.length > 0;

  return (
    <div className="mt-3 flex w-full items-center gap-2">
      {hasGroups ? (
        <DropdownMenu modal={false} open={groupDropdownOpen} onOpenChange={onGroupDropdownOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-10 min-w-0 flex-1 justify-between gap-2 border-border bg-card text-sm font-medium text-foreground hover:bg-accent"
              disabled={groupsLoading}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {showMemberAvatars ? (
                  <span className="flex shrink-0 items-center">
                    <span className="flex -space-x-2">
                      {groupMembers.slice(0, 4).map((member) => (
                        <Avatar
                          key={member.id}
                          className="h-7 w-7 border-2 border-background ring-1 ring-border"
                        >
                          <AvatarImage src={member.avatar_url ?? undefined} />
                          <AvatarFallback className="bg-muted text-[9px] text-muted-foreground">
                            {getInitials(member.full_name)}
                          </AvatarFallback>
                        </Avatar>
                      ))}
                    </span>
                    {groupMembers.length > 4 ? (
                      <span className="ml-1.5 text-[10px] font-medium text-muted-foreground">
                        +{groupMembers.length - 4}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <span className="min-w-0 truncate text-left">{listLabel}</span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-[min(calc(100vw-2rem),320px)] md:w-[220px]"
          >
            <DropdownMenuItem
              onClick={onSelectPersonalList}
              className={cn(!isGroupContext && "bg-accent text-foreground")}
            >
              {t("checklist:topbar.personalList")}
            </DropdownMenuItem>
            {allGroups.map((g) => {
              const label = groupLabel(g);
              const isActive = selectedGroupId === g.id;
              return (
                <DropdownMenuItem
                  key={g.id}
                  onClick={() => onSelectGroup(g.id)}
                  className={cn(isActive && "bg-orange-50/80 text-orange-900")}
                >
                  {label}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onCreateNewList}
              className="text-foreground focus:bg-accent focus:text-foreground"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("checklist:topbar.createNewList")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="outline"
          onClick={onCollaborateFromPersonal}
          className="h-10 min-w-0 flex-1 justify-between border-border bg-card text-foreground hover:bg-accent"
        >
          <span className="truncate">{t("checklist:topbar.personalList")}</span>
          <Users2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      )}

      <TooltipProvider>
        <Tooltip>
          <DropdownMenu modal={false}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0 border-border bg-card text-foreground hover:bg-accent"
                  aria-label={t("checklist:topbar.actions")}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {canToggleSections && onToggleAllSections ? (
            <>
              <DropdownMenuItem onClick={onToggleAllSections}>
                {allSectionsCollapsed ? (
                  <ChevronsUpDown className="mr-2 h-4 w-4" />
                ) : (
                  <ChevronsDownUp className="mr-2 h-4 w-4" />
                )}
                {allSectionsCollapsed ? t("checklist:topbar.expandAllSections") : t("checklist:topbar.collapseAllSections")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          {onSplitCosts ? (
            <>
              <DropdownMenuItem onClick={onSplitCosts}>
                <Users2 className="mr-2 h-4 w-4" />
                {t("checklist:page.splitCostsWithRoommate")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onClick={onImportNotes}>
            <ClipboardPaste className="mr-2 h-4 w-4" />
            {t("checklist:topbar.importNotes")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExportPDF}>
            <FileDown className="mr-2 h-4 w-4" />
            {t("checklist:topbar.exportPdf")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onResetToDefault}>
            <RotateCcw className="mr-2 h-4 w-4" />
            {t("checklist:topbar.resetToDefaultList")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onClearChecked} disabled={!hasCheckedItems}>
            <CheckSquare className="mr-2 h-4 w-4" />
            {t("checklist:topbar.clearAllChecked")}
          </DropdownMenuItem>
          {hasShopEssentialsItems ? (
            <DropdownMenuItem onClick={onClearShopEssentials}>
              <ShoppingBag className="mr-2 h-3.5 w-3.5" strokeWidth={2} />
              {t("checklist:topbar.clearShopEssentialsItems")}
            </DropdownMenuItem>
          ) : null}
          {isGroupContext ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onInvite}>
                <Users2 className="mr-2 h-4 w-4" />
                {t("checklist:actions.invite")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onManageGroup}>{t("checklist:topbar.manageGroup")}</DropdownMenuItem>
            </>
          ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <TooltipContent>{t("checklist:topbar.actions")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
