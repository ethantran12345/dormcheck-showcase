import { useTranslation } from "react-i18next";
import { Check, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ChecklistItem } from "@/types";

/**
 * Pure presentational pieces of a checklist item row, extracted from
 * `ChecklistPage.tsx`. These take props only (no page state / hooks), so they
 * are safe to share and test in isolation.
 */

/** Secondary hint when the same item name exists on the other list (personal ↔ group). */
export function ChecklistCrossListIndicator(props: {
  variant: "also-in-group" | "also-in-personal";
  groupLabel?: string;
}) {
  const { t } = useTranslation();
  if (props.variant === "also-in-group") {
    const label = props.groupLabel ?? t("checklist:item.groupDefaultLabel");
    return (
      <span
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-400"
        title={t("checklist:item.alsoInGroup", { label })}
        aria-label={t("checklist:item.alsoInGroup", { label })}
      >
        <Users className="h-3 w-3" strokeWidth={2} aria-hidden />
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
      title={t("checklist:item.alsoOnPersonalList")}
      aria-label={t("checklist:item.alsoOnPersonalList")}
    >
      <User className="h-3 w-3" strokeWidth={2} aria-hidden />
    </span>
  );
}

/** Circular checkbox that cycles an item between "need to buy" and "packed". */
export function ChecklistItemStatusButton({
  item,
  readonly,
  onCycle,
}: {
  item: ChecklistItem;
  readonly: boolean;
  onCycle: () => void;
}) {
  const { t } = useTranslation();
  const s = item.status ?? (item.is_checked ? "packed" : "need");
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      // Keep the inner check at 14px: Button's base cva sets `[&_svg]:size-4`, whose
      // descendant selector out-specifies the icon's own h-3.5 — restore it here.
      className={cn(
        "h-9 w-9 shrink-0 rounded-full hover:bg-transparent [&_svg]:size-3.5",
        readonly && "cursor-default opacity-50"
      )}
      onClick={(e) => {
        e.stopPropagation();
        if (!readonly) onCycle();
      }}
      disabled={readonly}
      aria-label={
        s === "packed"
          ? t("checklist:item.packedAriaLabel")
          : t("checklist:item.needToBuyAriaLabel")
      }
    >
      {s === "packed" ? (
        <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-malachite-600 bg-malachite-800 text-white shadow-raised">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      ) : (
        <span className="block h-6 w-6 rounded-full border-2 border-border bg-card" aria-hidden />
      )}
    </Button>
  );
}

/** Square product thumbnail for Shop-Essentials rows; opens the product detail. */
export function ChecklistShopThumbnail({
  src,
  label,
  disabled,
  onOpen,
}: {
  src: string;
  label: string;
  disabled?: boolean;
  onOpen: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border bg-card p-0.5 hover:bg-card sm:h-12 sm:w-12"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onOpen();
      }}
      aria-label={`View ${label}`}
    >
      <img src={src} alt="" className="h-full w-full object-contain" loading="lazy" />
    </Button>
  );
}

/** "Buy on Amazon" affiliate badge link shown on Shop-Essentials rows. */
export function ChecklistAmazonLink({ href }: { href: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer sponsored"
      className="shrink-0 rounded-md border border-[#FF9900]/20 bg-[#FF9900]/10 px-2 py-0.5 text-[10px] font-medium text-[#FF9900] transition-colors hover:bg-[#FF9900] hover:text-white"
      onClick={(e) => e.stopPropagation()}
    >
      {t("checklist:item.buyOnAmazon")}
    </a>
  );
}
