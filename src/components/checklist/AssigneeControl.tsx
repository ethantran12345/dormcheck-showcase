import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, UserPlus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiPost } from "@/lib/apiPost";
import { getInitials } from "@/lib/identity";
import { cn } from "@/lib/utils";
import type { ChecklistItem } from "@/types";

export type AssigneeMember = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
};

/**
 * Single-assignee control for group checklist items ("you bring the microwave").
 * Unassigned: UserPlus trigger; assigned: the assignee's avatar chip. Either opens
 * a member picker ("You" pinned first) writing checklist_items.assigned_to, which
 * the whole group sees via the existing checklist realtime channel.
 */
export function AssigneeControl({
  item,
  groupMembers,
  currentUserId,
  memberLabels,
  readonly,
  onAssign,
  inline = false,
}: {
  item: ChecklistItem;
  groupMembers: AssigneeMember[];
  currentUserId: string;
  /** Disambiguated display labels keyed by user_id (built by the caller). */
  memberLabels: Map<string, string>;
  readonly: boolean;
  onAssign: (userId: string | null) => void;
  /** Render the picker body without a Popover wrapper (mobile action sheet). */
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const assignee = item.assigned_to
    ? groupMembers.find((m) => m.user_id === item.assigned_to) ?? null
    : null;
  const assignedToMe = item.assigned_to === currentUserId;

  const label = (m: AssigneeMember) =>
    m.user_id === currentUserId ? t("checklist:assignee.you") : memberLabels.get(m.user_id) ?? t("checklist:assignee.studentFallback");

  // "You" pinned first, everyone else in caller order.
  const orderedMembers = [
    ...groupMembers.filter((m) => m.user_id === currentUserId),
    ...groupMembers.filter((m) => m.user_id !== currentUserId),
  ];

  const pick = (userId: string | null) => {
    onAssign(userId);
    // Email nudge to a roommate you assigned (never on self-assign/unassign).
    // Fire-and-forget: the assignment itself already landed via onAssign.
    if (userId && userId !== currentUserId) {
      void apiPost("/api/notify-checklist-assigned", { itemId: item.id, assigneeId: userId }).catch((err) =>
        console.error("notify-checklist-assigned failed", err),
      );
    }
    setOpen(false);
  };

  const pickerBody = (
    <div className="space-y-1">
      <p className={cn("font-medium text-foreground", inline ? "text-xs text-muted-foreground" : "text-sm")}>
        {t("checklist:assignee.whosBringing")}
      </p>
      <div className="flex flex-col">
        {orderedMembers.map((m) => {
          const isAssignee = item.assigned_to === m.user_id;
          return (
            <Button
              key={m.user_id}
              type="button"
              variant="ghost"
              disabled={readonly}
              aria-pressed={isAssignee}
              onClick={() => pick(isAssignee ? null : m.user_id)}
              className="flex h-auto items-center justify-start gap-2 rounded-md px-2 py-1.5 text-left text-sm font-normal text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <Avatar className="h-6 w-6 border border-border">
                <AvatarImage src={m.avatar_url ?? undefined} alt="" />
                <AvatarFallback className="bg-muted text-[8px] text-muted-foreground">
                  {getInitials(m.full_name ?? "")}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate">{label(m)}</span>
              {isAssignee ? <Check className="h-4 w-4 shrink-0 text-foreground" strokeWidth={2} /> : null}
            </Button>
          );
        })}
      </div>
      {item.assigned_to ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start px-2 text-sm text-muted-foreground"
          disabled={readonly}
          onClick={() => pick(null)}
        >
          {t("checklist:assignee.unassign")}
        </Button>
      ) : null}
    </div>
  );

  if (inline) return pickerBody;

  const trigger = assignee ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={readonly}
      aria-label={
        assignedToMe
          ? t("checklist:assignee.youBringingAriaLabel", { item: item.item })
          : t("checklist:assignee.memberBringingAriaLabel", { member: label(assignee), item: item.item })
      }
      className="h-6 w-6 rounded-full p-0 hover:bg-transparent"
    >
      <Avatar className={cn("h-6 w-6 border", assignedToMe ? "border-border" : "border-border")}>
        <AvatarImage src={assignee.avatar_url ?? undefined} alt="" />
        <AvatarFallback className="bg-muted text-[8px] text-muted-foreground">
          {getInitials(assignee.full_name ?? "")}
        </AvatarFallback>
      </Avatar>
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={readonly}
      aria-label={t("checklist:assignee.assignAriaLabel", { item: item.item })}
      className="h-auto w-auto rounded p-1 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground [&_svg]:size-3.5"
    >
      <UserPlus strokeWidth={2} />
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {assignee
            ? assignedToMe
              ? t("checklist:assignee.youBringingThis")
              : t("checklist:assignee.memberBringingThis", { member: label(assignee) })
            : t("checklist:assignee.assignToRoommate")}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-56 p-2">
        {pickerBody}
      </PopoverContent>
    </Popover>
  );
}
