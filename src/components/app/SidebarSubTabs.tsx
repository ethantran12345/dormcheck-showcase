import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { NavSectionGroup } from "@/components/nav/navSections";
import { activeIconProps } from "@/lib/navIcon";
import { cn } from "@/lib/utils";

/**
 * A nav group's sub-tab links (+ optional primary create action). Shared by
 * the expanded sidebar's inline disclosure tree and the collapsed rail's
 * flyout popovers so both render the exact same group model.
 */
export function SubTabList({
  group,
  listId,
  inFlyout = false,
  onNavigate,
}: {
  group: NavSectionGroup;
  /** id referenced by the disclosure chevron's aria-controls (tree mode). */
  listId?: string;
  /** Flyout popovers skip the tree connector line / indent. */
  inFlyout?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ul
      id={listId}
      className={cn(
        "flex flex-col gap-0.5 py-0.5",
        !inFlyout && "ml-[22px] border-l border-border pl-2",
      )}
    >
      {/* Marketplace posts via its in-page header button on desktop, so skip the
          loud sidebar CTA there; other groups (e.g. Schedule) keep it. */}
      {group.primaryAction && group.key !== 'marketplace' && (
        <li>
          <Link
            to={group.primaryAction.to}
            onClick={onNavigate}
            className="mb-0.5 flex items-center gap-2 rounded-lg bg-malachite-800 px-2.5 py-2 text-[13px] font-extrabold text-white transition-colors hover:bg-malachite-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1"
          >
            <group.primaryAction.Icon className="h-4 w-4" aria-hidden />
            {t(group.primaryAction.labelKey)}
          </Link>
        </li>
      )}
      {group.items.map((item) => (
        <li key={item.id}>
          <Link
            to={item.to}
            onClick={onNavigate}
            aria-current={item.active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1",
              item.active
                ? "bg-malachite-50 text-malachite-800 dark:bg-malachite-900/40 dark:text-malachite-300"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <item.Icon
              className={cn("h-4 w-4 transition-colors", item.active ? "text-malachite-600" : "text-muted-foreground/70")}
              aria-hidden
              {...activeIconProps(item.active)}
            />
            {t(item.labelKey)}
          </Link>
        </li>
      ))}
    </ul>
  );
}
