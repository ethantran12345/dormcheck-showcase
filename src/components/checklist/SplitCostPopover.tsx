import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { PieChart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChecklistItem } from "@/types";
import type { GroupMember } from "./checklistTypes";
import {
  buildDisambiguatedMemberLabels,
  resolveGroupMemberLabel,
  scrollMobileSheetInputIntoView,
} from "./checklistHelpers";

/** Optional Split Cost popover: pie icon next to avatar, opens modal to configure split with custom %. */
function SplitCostPopover({
  item,
  groupMembers,
  readonly,
  onUpdateSplit,
  brandAccent,
  triggerClassName,
  triggerLabel,
  inline = false,
}: {
  item: ChecklistItem;
  groupMembers: GroupMember[];
  readonly: boolean;
  onUpdateSplit: (participantIds: string[], percentages: Record<string, number>) => void;
  brandAccent: string;
  /** Merged onto the trigger button (e.g. compact icon-only row actions). */
  triggerClassName?: string;
  /** Optional text next to the pie icon (e.g. full-width sheet row). */
  triggerLabel?: string;
  /** Render form body without Popover wrapper (mobile action sheet). */
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const participantIds = (item.split_participant_ids ?? []).filter(Boolean);
  const percentages = item.split_percentages ?? {};
  const splitActive = participantIds.length >= 2;

  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(participantIds.length >= 2 ? participantIds : []);
  const [pctInputs, setPctInputs] = useState<Record<string, number>>(() => {
    if (participantIds.length >= 2 && Object.keys(percentages).length > 0) {
      return participantIds.reduce((acc, id) => ({ ...acc, [id]: percentages[id] ?? 100 / participantIds.length }), {});
    }
    return {};
  });

  const panelOpen = inline || open;

  const memberLabels = useMemo(
    () =>
      buildDisambiguatedMemberLabels(
        groupMembers.map((m) => ({
          user_id: m.user_id,
          full_name: m.full_name,
        })),
      ),
    [groupMembers],
  );

  useEffect(() => {
    if (panelOpen) {
      const ids = participantIds.length >= 2 ? participantIds : [];
      setSelectedIds(ids);
      if (ids.length >= 2) {
        const hasCustom = ids.some((id) => percentages[id] != null);
        setPctInputs(
          hasCustom
            ? ids.reduce((acc, id) => ({ ...acc, [id]: percentages[id] ?? 100 / ids.length }), {})
            : ids.reduce((acc, id) => ({ ...acc, [id]: 100 / ids.length }), {})
        );
      } else {
        setPctInputs({});
      }
    }
  }, [panelOpen, participantIds.join(","), JSON.stringify(percentages)]);

  const closePanel = () => {
    if (!inline) setOpen(false);
  };

  const toggleMember = (userId: string) => {
    setSelectedIds((prev) => {
      const next = prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId];
      if (next.length >= 2) {
        const equal = 100 / next.length;
        setPctInputs(next.reduce((acc, id) => ({ ...acc, [id]: equal }), {}));
      } else {
        setPctInputs({});
      }
      return next;
    });
  };

  const totalPct = Object.values(pctInputs).reduce((s, v) => s + v, 0);
  const isValid = selectedIds.length >= 2 && Math.abs(totalPct - 100) < 0.01;

  const handleApply = () => {
    if (!isValid || selectedIds.length < 2) return;
    const pcts: Record<string, number> = {};
    selectedIds.forEach((id) => {
      pcts[id] = Math.round((pctInputs[id] ?? 100 / selectedIds.length) * 100) / 100;
    });
    const sum = Object.values(pcts).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 0.01) {
      const last = selectedIds[selectedIds.length - 1];
      pcts[last] = Math.round((100 - sum + (pcts[last] ?? 0)) * 100) / 100;
    }
    onUpdateSplit(selectedIds, pcts);
    closePanel();
  };

  const handleRemoveSplit = () => {
    onUpdateSplit([], {});
    closePanel();
  };

  const handlePctChange = (userId: string, val: number) => {
    const clamped = Math.max(0, Math.min(100, val));
    setPctInputs((prev) => {
      const next = { ...prev, [userId]: clamped };
      const others = selectedIds.filter((id) => id !== userId);
      if (others.length === 0) return next;
      if (others.length === 1) {
        next[others[0]] = 100 - clamped;
        return next;
      }
      const remainder = 100 - clamped;
      const perOther = remainder / others.length;
      others.forEach((id) => {
        next[id] = perOther;
      });
      return next;
    });
  };

  const formBody = (
    <div className="space-y-3">
      <span className={cn("font-medium text-foreground", inline ? "text-xs text-muted-foreground" : "text-sm")}>
        {t("checklist:split.title")}
      </span>
      <p className="text-xs text-muted-foreground">{t("checklist:split.description")}</p>
      <div className="flex flex-col gap-2">
        {groupMembers.map((m) => (
          <div key={m.user_id} className="flex items-center gap-2">
            <Checkbox
              id={`split-${item.id}-${m.user_id}`}
              checked={selectedIds.includes(m.user_id)}
              onCheckedChange={() => toggleMember(m.user_id)}
              disabled={readonly}
            />
            <label htmlFor={`split-${item.id}-${m.user_id}`} className="flex-1 cursor-pointer text-sm text-foreground">
              {memberLabels.get(m.user_id) ?? resolveGroupMemberLabel({ full_name: m.full_name })}
            </label>
            {selectedIds.includes(m.user_id) && (
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={selectedIds.includes(m.user_id) ? (pctInputs[m.user_id] ?? 100 / selectedIds.length) : 0}
                  onChange={(e) => handlePctChange(m.user_id, parseFloat(e.target.value) || 0)}
                  onFocus={inline ? (e) => scrollMobileSheetInputIntoView(e.currentTarget) : undefined}
                  className="h-8 w-14 text-right text-sm"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            )}
          </div>
        ))}
      </div>
      {selectedIds.length >= 2 && (
        <p className={cn("text-xs", Math.abs(totalPct - 100) < 0.01 ? "text-muted-foreground" : "text-amber-600")}>
          {t("checklist:split.total", { pct: totalPct.toFixed(1) })}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        {splitActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={handleRemoveSplit}
            disabled={readonly}
          >
            {t("checklist:split.remove")}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={handleApply}
          disabled={!isValid || readonly}
          className="ml-auto"
          style={{ backgroundColor: brandAccent }}
        >
          {t("checklist:split.apply")}
        </Button>
      </div>
    </div>
  );

  if (inline) {
    return formBody;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={readonly}
          // [&_svg]:size-3.5 keeps the 14px pie glyph off the base [&_svg]:size-4.
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full p-0 transition-colors [&_svg]:size-3.5",
            splitActive
              ? "bg-accent hover:bg-accent/80"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
            triggerClassName
          )}
          style={splitActive ? { color: brandAccent } : undefined}
          aria-label={t("checklist:split.ariaLabel")}
        >
          <PieChart className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {triggerLabel ? (
            <span className="min-w-0 truncate text-sm font-normal">{triggerLabel}</span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        {formBody}
      </PopoverContent>
    </Popover>
  );
}

export { SplitCostPopover };
