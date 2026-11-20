import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import type { NavSectionGroup } from "@/components/nav/navSections";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SubTabList } from "@/components/app/SidebarSubTabs";
import { activeIconProps } from "@/lib/navIcon";
import { cn } from "@/lib/utils";

const CLOSE_DELAY_MS = 120;

export const railLinkClass = (active: boolean) =>
  cn(
    "relative flex h-11 w-11 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1",
    active ? "bg-malachite-50 text-malachite-800" : "text-muted-foreground hover:bg-muted",
  );

/** Icon-only rail row with a plain label tooltip (no sub-tab group). */
export function RailLink({
  to,
  label,
  Icon,
  active,
  showUnreadDot = false,
}: {
  to: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  showUnreadDot?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={to}
          aria-current={active ? "page" : undefined}
          aria-label={showUnreadDot ? `${label} (unread)` : label}
          className={railLinkClass(active)}
        >
          <Icon className="h-[18px] w-[18px] transition-colors" aria-hidden {...activeIconProps(active)} />
          {showUnreadDot && (
            <span
              className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white"
              aria-hidden
            />
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Disabled Phase-1 "Soon" rail row - visible, not navigable, no flyout. */
export function RailSoonItem({ label, Icon }: { label: string; Icon: LucideIcon }) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          aria-disabled="true"
          aria-label={t("misc:sidebar.comingSoon", { label })}
          className="flex h-11 w-11 cursor-default items-center justify-center rounded-lg text-muted-foreground/50"
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">{t("misc:sidebar.comingSoonTooltip", { label })}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Rail row whose icon opens a flyout of the group's sub-tabs. Opens on hover
 * (with a close delay so the pointer can cross into the popover) and on
 * keyboard focus - never hover-only (WCAG). Click still navigates to the
 * entry's main route.
 */
export function RailFlyout({
  to,
  label,
  Icon,
  active,
  group,
}: {
  to: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  group: NavSectionGroup;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const openNow = () => {
    cancelClose();
    setOpen(true);
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  /** Close when focus leaves both the trigger and the flyout (keyboard path). */
  const onBlurCapture = (e: React.FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) closeSoon();
  };

  const shared = {
    onMouseEnter: openNow,
    onMouseLeave: closeSoon,
    onFocusCapture: openNow,
    onBlurCapture,
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div {...shared}>
        <PopoverTrigger asChild>
          <Link
            to={to}
            aria-current={active ? "page" : undefined}
            aria-label={label}
            className={railLinkClass(active)}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </Link>
        </PopoverTrigger>
      </div>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={4}
        className="w-56 p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
        {...shared}
      >
        <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
          {t(group.titleKey)}
        </div>
        <SubTabList group={group} inFlyout onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** Rail-mode wrapper for pinned bottom controls that only need a tooltip. */
export function RailTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  /** Optional key hint (e.g. `<ShortcutKeys id="openPalette" />`); callers gate it to desktop pointers. */
  shortcut?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className={shortcut ? "flex items-center gap-2" : undefined}>
        {label}
        {shortcut}
      </TooltipContent>
    </Tooltip>
  );
}
