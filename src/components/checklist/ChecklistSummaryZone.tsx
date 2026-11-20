import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ChecklistReadinessSummary } from "./ChecklistReadinessSummary";
import type { ChecklistReadiness } from "./checklistHelpers";

export type ChecklistSummaryZoneProps = {
  packedItems: number;
  totalItems: number;
  progress?: number;
  statusSummary: { need: number; packed: number };
  /**
   * Checklist v2 weighted readiness. When present the header renders the
   * consolidated "Move-in readiness" card (one bar + one muted stats line +
   * inline budget). Omitted on group lists (they keep the legacy header).
   */
  readiness?: ChecklistReadiness | null;
  totalEstimatedCost: number;
  remainingItems?: number;
  isGroupContext: boolean;
  /** Personal list id for budget localStorage key; omit on group lists. */
  listId?: string | null;
  loading: boolean;
  balancesSection?: ReactNode;
  /**
   * On desktop the personal summary moves into the ChecklistReadinessView left
   * rail, so hide this full-bleed banner at lg. Group lists keep it visible.
   */
  collapseOnDesktop?: boolean;
  /** List-actions `⋯` menu, shown on the personal readiness summary card. */
  actionsSlot?: ReactNode;
};

export function ChecklistSummaryZone({
  packedItems,
  totalItems,
  statusSummary,
  totalEstimatedCost,
  isGroupContext: _isGroupContext,
  listId,
  loading,
  readiness,
  collapseOnDesktop = false,
  actionsSlot,
}: ChecklistSummaryZoneProps) {
  const { t } = useTranslation();
  const progressValue =
    totalItems === 0 ? 0 : Math.round((packedItems / totalItems) * 100);

  return (
    <div
      className={cn(
        "w-full px-4 pt-2 pb-1 md:px-8 lg:px-12",
        collapseOnDesktop && "lg:hidden",
      )}
    >
      {readiness ? (
        <ChecklistReadinessSummary
          readiness={readiness}
          estimatedCost={totalEstimatedCost}
          listId={listId}
          loading={loading}
          variant="banner"
          actionsSlot={actionsSlot}
        />
      ) : (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-raised">
          {loading ? (
            <div className="space-y-2">
              <div className="h-3 w-28 rounded bg-muted animate-pulse" />
              <div className="h-2.5 w-full rounded-full bg-muted animate-pulse" />
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-foreground">
                  <span className="font-semibold tabular-nums">{packedItems}</span>
                  {t("checklist:summary.ofPacked", { count: totalItems, n: totalItems })}
                </span>
                <span
                  className="shrink-0 text-sm font-semibold tabular-nums"
                  style={{ color: "#0B702B" }}
                >
                  {t("checklist:summary.toPackCount", { count: statusSummary.need, n: statusSummary.need })}
                </span>
              </div>
              <div
                className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={progressValue}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("checklist:summary.progressLabel", { percent: progressValue, packed: packedItems, total: totalItems })}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-300 ease-out"
                  style={{ width: `${progressValue}%`, backgroundColor: "#03C03C" }}
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
