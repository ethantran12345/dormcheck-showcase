import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HelpCircle, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ReadinessRescoreNote } from "./ReadinessRescoreNote";
import type { ChecklistReadiness } from "./checklistHelpers";

const BUDGET_STORAGE_PREFIX = "checklist_list_budget_";

function readBudget(listId: string): number | null {
  try {
    const raw = localStorage.getItem(`${BUDGET_STORAGE_PREFIX}${listId}`);
    if (raw == null || raw === "") return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeBudget(listId: string, amount: number | null): void {
  try {
    const key = `${BUDGET_STORAGE_PREFIX}${listId}`;
    if (amount == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(amount));
  } catch {
    /* ignore quota / private mode */
  }
}

export type ChecklistReadinessSummaryProps = {
  /** Weighted readiness for the whole personal list. */
  readiness: ChecklistReadiness;
  /** Sum of prices on still-need items (drives the Est. total + budget bar). */
  estimatedCost: number;
  /** Personal list id for the budget localStorage key; omit to hide budget. */
  listId?: string | null;
  loading?: boolean;
  /** "banner" = mobile full-bleed card; "rail" = desktop sidebar card. Styling only. */
  variant?: "banner" | "rail";
  /** Optional list-actions control (the `⋯` menu) shown beside the readiness %. */
  actionsSlot?: ReactNode;
};

/**
 * Consolidated personal-checklist summary: ONE readiness bar, one muted stats
 * line (Got / Packed / Est / priced), and an inline budget link. No standalone
 * buttons - shared by the mobile full-bleed banner (ChecklistSummaryZone) and
 * the desktop sidebar rail (ChecklistReadinessView) so the numbers have a single
 * source.
 */
export function ChecklistReadinessSummary({
  readiness,
  estimatedCost,
  listId,
  loading = false,
  variant = "banner",
  actionsSlot,
}: ChecklistReadinessSummaryProps) {
  const { t } = useTranslation();
  const showBudget = !!listId;
  const [budget, setBudget] = useState<number | null>(() =>
    showBudget && listId ? readBudget(listId) : null,
  );
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [editBudgetValue, setEditBudgetValue] = useState("");
  const budgetInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showBudget || !listId) {
      setBudget(null);
      setIsEditingBudget(false);
      return;
    }
    setBudget(readBudget(listId));
    setIsEditingBudget(false);
  }, [listId, showBudget]);

  useEffect(() => {
    if (isEditingBudget) budgetInputRef.current?.focus();
  }, [isEditingBudget]);

  const commitBudgetEdit = useCallback(() => {
    if (!listId) return;
    const trimmed = editBudgetValue.trim();
    if (trimmed === "") {
      writeBudget(listId, null);
      setBudget(null);
    } else {
      const parsed = Number.parseFloat(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setIsEditingBudget(false);
        return;
      }
      writeBudget(listId, parsed);
      setBudget(parsed);
    }
    setIsEditingBudget(false);
  }, [editBudgetValue, listId]);

  const startBudgetEdit = useCallback((current: number | null) => {
    setEditBudgetValue(current != null ? String(current) : "");
    setIsEditingBudget(true);
  }, []);

  const overBy =
    budget != null && estimatedCost > budget ? estimatedCost - budget : null;
  const leftAmount =
    budget != null && estimatedCost <= budget ? budget - estimatedCost : null;

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 shadow-raised">
        <div className="space-y-2">
          <div className="h-3 w-28 rounded bg-muted animate-pulse" />
          <div className="h-2.5 w-full rounded-full bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-4 shadow-raised",
        variant === "rail" && "lg:p-3.5",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1 text-sm font-medium text-foreground">
          {t("checklist:v2.readinessLabel")}
          <Popover>
            <PopoverTrigger asChild>
              {/* Button primitive, not a raw <button> (lint:primitives RULE A).
                  Sized down off `icon` so it sits on the label's baseline, with
                  a before:-inset pseudo-element restoring a ~40px touch target
                  the glyph itself is too small to provide. */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("checklist:v2.readinessHelpAria")}
                className="relative h-5 w-5 shrink-0 rounded-full before:absolute before:-inset-2.5 before:content-[''] hover:bg-transparent [&_svg]:text-muted-foreground hover:[&_svg]:text-foreground"
              >
                <HelpCircle className="h-4 w-4" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-4 text-left">
              <p className="text-sm font-semibold text-foreground">
                {t("checklist:v2.readinessHelpTitle")}
              </p>
              <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                <li className="flex justify-between gap-3">
                  <span>{t("checklist:v2.readinessHelpAcquired")}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-foreground">60%</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span>{t("checklist:v2.readinessHelpPacked")}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-foreground">40%</span>
                </li>
              </ul>
              <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                {t("checklist:v2.readinessHelpSimple")}
              </p>
            </PopoverContent>
          </Popover>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-lg font-bold tabular-nums text-foreground">
            {readiness.readiness}%
          </span>
          {actionsSlot}
        </span>
      </div>
      <div
        className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={readiness.readiness}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("checklist:v2.readinessAria", { percent: readiness.readiness })}
      >
        <div
          className="h-full rounded-full bg-malachite-600 transition-[width] duration-300 ease-out"
          style={{ width: `${readiness.readiness}%` }}
        />
      </div>

      {/* One plain next-step line replaces the dense accounting readout. */}
      <p className="mt-2 text-xs text-muted-foreground">
        {readiness.needCount > 0
          ? t("checklist:v2.itemsLeft", { count: readiness.needCount })
          : t("checklist:v2.readyToMove")}
      </p>

      {showBudget ? (
        <div className="mt-2.5 border-t border-border/70 pt-2.5">
          {isEditingBudget ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t("checklist:summary.budgetLabel")}
              </span>
              <input
                ref={budgetInputRef}
                type="number"
                min={0}
                step={1}
                inputMode="decimal"
                value={editBudgetValue}
                onChange={(e) => setEditBudgetValue(e.target.value)}
                onBlur={commitBudgetEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitBudgetEdit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setIsEditingBudget(false);
                  }
                }}
                className="h-8 w-24 rounded-lg border border-border bg-background px-2.5 text-sm tabular-nums text-foreground outline-none focus:border-malachite-600 focus:ring-1 focus:ring-malachite-600/30"
                aria-label={t("checklist:summary.spendingBudgetAria")}
              />
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => startBudgetEdit(budget)}
              // [&_svg]:size-3 keeps the 12px pencil off the base [&_svg]:size-4.
              className="inline-flex h-auto items-center gap-1 rounded-none p-0 text-xs font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground [&_svg]:size-3"
            >
              {budget == null
                ? t("checklist:summary.setBudget")
                : t("checklist:v2.budgetAmount", { amount: budget.toFixed(2) })}
              <Pencil className="h-3 w-3 opacity-60" strokeWidth={2} aria-hidden />
            </Button>
          )}

          {/* Budget bar only while editing or over budget - stays out of the way otherwise. */}
          {budget != null && budget > 0 && (isEditingBudget || overBy != null) ? (
            <div className="mt-1.5">
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={Math.min(Math.round((estimatedCost / budget) * 100), 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("checklist:summary.budgetUsedAria")}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-300 ease-out"
                  style={{
                    width: `${Math.min((estimatedCost / budget) * 100, 100)}%`,
                    backgroundColor: overBy != null ? "#d97706" : "#03C03C",
                  }}
                />
              </div>
              <div className="mt-1 flex justify-between text-xs tabular-nums text-muted-foreground">
                <span>
                  {t("checklist:summary.budgetOf", {
                    spent: estimatedCost.toFixed(2),
                    total: budget.toFixed(2),
                  })}
                </span>
                <span
                  className={cn(
                    overBy != null && "font-medium text-amber-600 dark:text-amber-300",
                  )}
                >
                  {overBy != null
                    ? t("checklist:summary.over", { amount: overBy.toFixed(2) })
                    : t("checklist:summary.left", { amount: (leftAmount ?? 0).toFixed(2) })}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Last in the card, under the number it is about. It self-suppresses for
          anyone whose score did not move, so this renders nothing most of the
          time. */}
      <ReadinessRescoreNote hasNightOne={false} />
    </div>
  );
}
