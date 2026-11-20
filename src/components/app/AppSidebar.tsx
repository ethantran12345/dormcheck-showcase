import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import {
  Home,
  CalendarDays,
  ClipboardCheck,
  Truck,
  ShoppingBag,
  Building2,
  Users,
  ChevronDown,
  ChevronLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Bookmark,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { activeIconProps } from "@/lib/navIcon";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { SHOW_STUDENT_BUSINESSES } from "@/lib/featureFlags";
import { useNavShell } from "@/contexts/NavShellContext";
import { useBookmarks } from "@/contexts/BookmarksContext";
import { BOOKMARK_ICONS } from "@/lib/bookmarks";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUniversity } from "@/contexts/UniversityContext";
import { useAdminUniversitySilo } from "@/contexts/AdminUniversityContext";
import { RoommatePresenceChip } from "@/components/roommates/RoommatePresenceChip";
import {
  resolveSettingsSection,
  visibleSettingsSections,
} from "@/components/settings/settingsSections";
import {
  getAllNavSections,
  type NavGroupKey,
  type NavSectionGroup,
} from "@/components/nav/navSections";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { SubTabList } from "@/components/app/SidebarSubTabs";
import { RailFlyout, RailLink, RailSoonItem, RailTooltip, railLinkClass } from "@/components/app/SidebarRail";
import { cn } from "@/lib/utils";
import { useGlobalSearch } from "@/contexts/GlobalSearchContext";
import { Button } from "@/components/ui/button";
import { ShortcutKeys } from "@/components/shortcuts/ShortcutKeys";
import { useShowKeyboardHints } from "@/components/shortcuts/useShowKeyboardHints";

/**
 * The desktop door to the command palette. Before this the sidebar had no search
 * at all, so Cmd/Ctrl+K was discoverable only by accident (critique 2026-10-11).
 * The key hint comes from the shortcut registry and shows only to a fine pointer.
 */
function SidebarSearchButton({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const { openSearch } = useGlobalSearch();
  const showHints = useShowKeyboardHints();
  const label = t("misc:search.trigger");
  if (collapsed) {
    return (
      <RailTooltip label={label} shortcut={showHints ? <ShortcutKeys id="openPalette" /> : undefined}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(e) => openSearch({ returnFocusTo: e.currentTarget })}
          aria-label={t("misc:search.openSearch")}
          aria-keyshortcuts="Meta+K Control+K"
          className={cn(railLinkClass(false), "[&_svg]:size-5")}
        >
          <Search aria-hidden />
        </Button>
      </RailTooltip>
    );
  }
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={(e) => openSearch({ returnFocusTo: e.currentTarget })}
      aria-keyshortcuts="Meta+K Control+K"
      className="mb-2 h-auto w-full justify-start gap-2.5 rounded-lg border border-sidebar-border bg-background px-3 py-1.5 text-[13px] font-semibold text-muted-foreground hover:bg-accent focus-visible:ring-malachite-600 focus-visible:ring-offset-1 [&_svg]:size-[18px] [&_svg]:text-muted-foreground"
    >
      <Search aria-hidden />
      <span className="truncate">{label}</span>
      {showHints && <ShortcutKeys id="openPalette" className="ml-auto" />}
    </Button>
  );
}

/**
 * Web-native left sidebar, the signed-in web *desktop* primary nav (spec §3 +
 * desktop-nav-spec.md). Rendered by `LayoutWrapper` only for signed-in web at
 * `md+` (it is `hidden md:flex`, handing off from `BottomNav` at 768px);
 * mobile web keeps `BottomNav` and native keeps `NativeTopBar` + `BottomNav`,
 * both untouched.
 *
 * Entries whose page has sub-tabs (Checklist, Marketplace, Housing, Roommates)
 * disclose them inline, driven by `getAllNavSections()` - the same model the
 * mobile NavActionMenu reads - so the sidebar owns sub-tab switching on
 * desktop (the in-page pill bars hide at `md+` inside the app shell). A
 * collapse toggle swaps to a 64px icon rail with hover/focus flyouts;
 * the preference persists via NavShellContext (`dc_sidebar_collapsed`).
 * Phase-1-gated surfaces (Housing, Roommates) render as disabled "Soon" items
 * rather than disappearing, so the roadmap stays legible.
 */
type NavEntry = {
  /**
   * i18next key at definition (e.g. `misc:nav.myHome`). `renderEntry`/`renderSoon`
   * resolve it to display text before handing the entry to leaf components.
   */
  label: string;
  to: string;
  icon: LucideIcon;
  /** Active when the current path matches (prefix match). */
  match: (pathname: string) => boolean;
  /** Sub-tab group key in navSections, when the page has sub-tabs. */
  groupKey?: NavGroupKey;
};

const HOME: NavEntry = {
  label: "misc:nav.myHome",
  to: "/my-home",
  icon: Home,
  match: (p) => p === "/my-home",
};

// Sections mirror the mobile bottom-nav tabs (Home / Housing / Checklist /
// Market) so users switching between desktop and mobile find pages in the
// same cluster. Every page keeps its entry - only the grouping changed.
const SCHEDULE: NavEntry = {
  // Schedule's one canonical nav home (same target as the My Home widget).
  // Deliberately a flat top-level row with no `groupKey`: /schedule left the
  // Housing cluster on 2026-08-27 (see navSections `isHousingPath`), so it is no
  // longer a sub-tab of anything. Its own sub-actions live in the mobile ⊞
  // launcher via `buildScheduleGroup`.
  label: "misc:nav.schedule",
  to: "/schedule",
  icon: CalendarDays,
  match: (p) => p === "/schedule",
};

const CHECKLIST_SECTION: NavEntry[] = [
  {
    label: "misc:nav.checklist",
    to: "/checklist",
    icon: ClipboardCheck,
    match: (p) => p === "/checklist",
    groupKey: "checklist",
  },
  {
    // Move In / Move Out - its own page/route now (split out of Checklist), with
    // Move In / Move Out as its sub-tabs (buildLogisticsGroup).
    label: "misc:nav.logistics",
    to: "/logistics",
    icon: Truck,
    match: (p) => p.startsWith("/logistics"),
    groupKey: "logistics",
  },
];

// With Student Businesses hidden (SHOW_STUDENT_BUSINESSES=false) the marketplace
// group has a single sub-tab - Student Market - so the disclosure would nest a
// page under a synonym of itself. Flatten it to a plain top-level "Student
// Market" row; only when the flag restores the second sub-tab does the
// "Marketplace" disclosure (groupKey) earn its keep again.
const MARKETPLACE: NavEntry = {
  label: SHOW_STUDENT_BUSINESSES ? "misc:nav.marketplace" : "misc:nav.studentMarket",
  to: "/marketplace",
  icon: ShoppingBag,
  match: (p) => p.startsWith("/marketplace"),
  ...(SHOW_STUDENT_BUSINESSES ? { groupKey: "marketplace" as const } : {}),
};

// Messages intentionally has NO sidebar entry on desktop - it lives in the
// floating top-right cluster (AppShellTopRight), Mercury-style.

const HOUSING: NavEntry = {
  label: "misc:nav.housing",
  to: "/housing",
  icon: Building2,
  // /subleases is a Housing sub-tab (buildHousingGroup), so the top entry
  // highlights and its disclosure group auto-opens there like any other.
  match: (p) =>
    p.startsWith("/housing") || p.startsWith("/campus") || p.startsWith("/gallery") ||
    p.startsWith("/subleases"),
  groupKey: "housing",
};

// Community has no standalone sidebar entry - it lives as a sub-tab of the
// Housing disclosure group (buildHousingGroup), so it isn't listed twice.

const ROOMMATES: NavEntry = {
  label: "misc:nav.roommates",
  to: "/roommates",
  icon: Users,
  match: (p) => p.startsWith("/roommates"),
  groupKey: "roommates",
};

const ALL_ENTRIES: NavEntry[] = [
  HOME,
  HOUSING,
  ROOMMATES,
  SCHEDULE,
  ...CHECKLIST_SECTION,
  MARKETPLACE,
];

/**
 * Mercury-style section break: hairline divider + small uppercase label
 * (expanded), or just a short centered divider on the collapsed rail.
 */
function SectionBreak({ collapsed, label }: { collapsed: boolean; label: string }) {
  if (collapsed) {
    return <div aria-hidden className="mx-auto my-2 h-px w-8 bg-border" />;
  }
  return (
    <div className="mt-2 border-t border-border px-2.5 pb-0.5 pt-2 text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
      {label}
    </div>
  );
}

function NavItem({
  entry,
  active,
  showUnreadDot = false,
  onNavigate,
}: {
  entry: NavEntry;
  active: boolean;
  /** Red unread indicator (unused today - Messages lives in AppShellTopRight). */
  showUnreadDot?: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const Icon = entry.icon;
  return (
    <Link
      to={entry.to}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={showUnreadDot ? t("misc:sidebar.unread", { label: entry.label }) : undefined}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1",
        active
          ? "bg-malachite-50 text-malachite-800 dark:bg-malachite-900/40 dark:text-malachite-300"
          : "text-muted-foreground hover:bg-accent",
      )}
    >
      <span className="relative">
        <Icon
          className={cn("h-[18px] w-[18px] transition-colors", active ? "text-malachite-600" : "text-muted-foreground")}
          {...activeIconProps(active)}
        />
        {showUnreadDot && (
          <span
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-sidebar"
            aria-hidden
          />
        )}
      </span>
      <span className="truncate">{entry.label}</span>
    </Link>
  );
}

/** Disabled Phase-1 "Soon" surface, visible but not navigable. */
function SoonItem({ entry }: { entry: NavEntry }) {
  const { t } = useTranslation();
  const Icon = entry.icon;
  return (
    <div
      aria-disabled="true"
      className="flex cursor-default items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-muted-foreground/70"
    >
      <Icon className="h-[18px] w-[18px] text-muted-foreground/50" />
      {entry.label}
      <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-extrabold tracking-[0.05em] text-muted-foreground/70">
        {t("misc:sidebar.soon")}
      </span>
    </div>
  );
}

/**
 * Nav row with an inline sub-tab disclosure. The link navigates (and expands);
 * the sibling chevron button toggles expansion without navigating - a separate
 * control, never a button nested in a link.
 */
function DisclosureItem({
  entry,
  active,
  group,
  expanded,
  onToggle,
  onNavigate,
}: {
  entry: NavEntry;
  active: boolean;
  group: NavSectionGroup;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const listId = `sidebar-subtabs-${group.key}`;
  return (
    <Collapsible open={expanded}>
      <div className="flex items-center gap-0.5">
        <NavItem entry={entry} active={active} onNavigate={onNavigate} />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={t(
            expanded ? "misc:sidebar.collapseSections" : "misc:sidebar.expandSections",
            { label: entry.label },
          )}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1"
        >
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", !expanded && "-rotate-90")}
            aria-hidden
          />
        </button>
      </div>
      <CollapsibleContent>
        <SubTabList group={group} listId={listId} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A single bookmarked-page row: a nav link (icon + label, active when it owns
 * the current route) with a remove control revealed on hover/focus.
 */
function BookmarkRow({
  path,
  label,
  Icon,
  active,
  onRemove,
}: {
  path: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="group/bm relative flex items-center">
      <Link
        to={path}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1.5 pl-3 pr-8 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1",
          active
            ? "bg-malachite-50 text-malachite-800 dark:bg-malachite-900/40 dark:text-malachite-300"
            : "text-muted-foreground hover:bg-accent",
        )}
      >
        <Icon
          className={cn("h-[18px] w-[18px] transition-colors", active ? "text-malachite-600" : "text-muted-foreground")}
          aria-hidden
          {...activeIconProps(active)}
        />
        <span className="truncate">{label}</span>
      </Link>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("misc:sidebar.removeBookmark", { label })}
        className="absolute right-1 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 group-hover/bm:opacity-100"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/**
 * "Bookmarks" section (Mercury-style) below Community: a header + the user's
 * pinned pages, added from each page's title toggle. The list owns its own
 * vertical scroll so a long list never breaks the fixed header/collapse control
 * (the aside itself is overflow-hidden). Collapsed rail: icon links only.
 */
function BookmarksSection({ collapsed, pathname }: { collapsed: boolean; pathname: string }) {
  const { t } = useTranslation();
  const { bookmarks, remove } = useBookmarks();

  return (
    <div className={cn("mt-1 flex min-h-0 flex-1 flex-col", collapsed && "w-full items-center")}>
      {collapsed ? (
        <SectionBreak collapsed label={t("misc:sidebar.bookmarks")} />
      ) : (
        <div className="mt-2 flex items-center justify-between border-t border-border px-2.5 pb-0.5 pt-2">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
            {t("misc:sidebar.bookmarks")}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={t("misc:sidebar.howToAddBookmarks")}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
              >
                <Bookmark className="h-3.5 w-3.5" aria-hidden />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("misc:sidebar.bookmarkHint")}</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* With no bookmarks the hint renders OUTSIDE the scroll box: on a short
          window the flex-1 box shrank until the hint overflowed, leaving a
          scrollable region with nothing focusable in it (axe
          scrollable-region-focusable, a hard fail in the weekly crawl). With
          bookmarks, the box scrolls and its links are the focusable content. */}
      {bookmarks.length === 0 ? (
        !collapsed && (
          <p className="shrink-0 px-2.5 pt-1 text-[12px] leading-snug text-muted-foreground">
            {t("misc:sidebar.noBookmarks")}
          </p>
        )
      ) : (
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          collapsed ? "flex flex-col items-center gap-1 pt-1" : "flex flex-col gap-0.5",
        )}
      >
        {bookmarks.map((b) => {
              const Icon = BOOKMARK_ICONS[b.icon] ?? Bookmark;
              const active = pathname === b.path;
              return collapsed ? (
                <RailLink key={b.path} to={b.path} label={b.label} Icon={Icon} active={active} />
              ) : (
                <BookmarkRow
                  key={b.path}
                  path={b.path}
                  label={b.label}
                  Icon={Icon}
                  active={active}
                  onRemove={() => remove(b.path)}
                />
              );
            })}
      </div>
      )}
    </div>
  );
}

/** The nav group key owning the current route, if any. */
function currentGroupKey(pathname: string): NavGroupKey | null {
  const entry = ALL_ENTRIES.find((e) => e.groupKey && e.match(pathname));
  return entry?.groupKey ?? null;
}

export function AppSidebar() {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  const { showHousing, showRoommates, showBrowseSublease, showSchedule } = useFeatureFlags();
  const { collapsed, setCollapsed } = useNavShell();
  const { university } = useUniversity();
  const { effectiveIsAdmin } = useAdminUniversitySilo();

  // On /settings AND /account the sidebar *becomes* the settings sub-nav
  // (Mercury pattern): one left nav, not two. It always renders expanded -
  // section labels don't reduce to icons well - so the collapse pref is ignored
  // here. /account is the same account surface, so it swaps to the settings
  // rail too instead of the main app nav (recovery map #21).
  const isSettings = pathname.startsWith("/settings") || pathname.startsWith("/account");

  // `showSchedule` belongs in the deps: it was already read inside and missing
  // here, and it now decides whether the Schedule GROUP exists at all rather than
  // just whether one row appears, so a stale memo would strand the whole group.
  const groups = useMemo(
    () => getAllNavSections(pathname, search, { showHousing, showRoommates, showBrowseSublease, showSchedule }),
    [pathname, search, showHousing, showRoommates, showBrowseSublease, showSchedule],
  );
  const groupByKey = useMemo(
    () => new Map(groups.map((g) => [g.key, g])),
    [groups],
  );

  // Accordion: at most ONE disclosure group open at a time, so the sidebar's
  // worst-case height is bounded and it never needs to scroll (the aside is
  // overflow-hidden). The current route's group opens on navigation.
  const [expandedKey, setExpandedKey] = useState<NavGroupKey | null>(() =>
    currentGroupKey(pathname),
  );
  useEffect(() => {
    const key = currentGroupKey(pathname);
    if (key) setExpandedKey(key);
  }, [pathname]);

  const toggleGroup = (key: NavGroupKey) =>
    setExpandedKey((prev) => (prev === key ? null : key));
  const expandGroup = (key: NavGroupKey) => setExpandedKey(key);

  const renderEntry = (rawEntry: NavEntry, opts?: { showUnreadDot?: boolean }) => {
    // Resolve the entry's i18n key to display text.
    const label = t(rawEntry.label);
    const entry = { ...rawEntry, label };
    const active = entry.match(pathname);
    const group = entry.groupKey ? groupByKey.get(entry.groupKey) : undefined;
    if (collapsed) {
      if (group) {
        return (
          <RailFlyout
            key={entry.to}
            to={entry.to}
            label={entry.label}
            Icon={entry.icon}
            active={active}
            group={group}
          />
        );
      }
      return (
        <RailLink
          key={entry.to}
          to={entry.to}
          label={entry.label}
          Icon={entry.icon}
          active={active}
          showUnreadDot={opts?.showUnreadDot}
        />
      );
    }
    if (group) {
      return (
        <DisclosureItem
          key={entry.to}
          entry={entry}
          active={active}
          group={group}
          expanded={expandedKey === group.key}
          onToggle={() => toggleGroup(group.key)}
          onNavigate={() => expandGroup(group.key)}
        />
      );
    }
    return (
      <NavItem key={entry.to} entry={entry} active={active} showUnreadDot={opts?.showUnreadDot} />
    );
  };

  const renderSoon = (rawEntry: NavEntry) => {
    const entry = { ...rawEntry, label: t(rawEntry.label) };
    return collapsed ? (
      <RailSoonItem key={entry.to} label={entry.label} Icon={entry.icon} />
    ) : (
      <SoonItem key={entry.to} entry={entry} />
    );
  };

  if (isSettings) {
    const activeSettingsSection = resolveSettingsSection(
      new URLSearchParams(search).get("section"),
      effectiveIsAdmin,
    );
    return (
      <aside className="fixed bottom-0 left-0 top-0 z-[1000] hidden w-[220px] flex-col overflow-hidden border-r border-sidebar-border bg-sidebar px-3 py-3 md:flex">
        <div className="mb-3 shrink-0 px-2.5">
          <Link
            to="/my-home"
            className="flex items-center gap-2 rounded-lg text-xl leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1"
            aria-label={t("misc:sidebar.brandHome")}
          >
            <img
              src="/dormcheck-logo-new.png"
              alt=""
              draggable={false}
              className="h-7 w-7 shrink-0 select-none object-contain"
              onError={(e) => {
                e.currentTarget.src = "/dormcheck-logo.png";
              }}
            />
            <span className="brand-wordmark text-lg">DormCheck</span>
          </Link>
          <p className="mt-1 truncate text-xs font-semibold text-muted-foreground">
            {university.name}
          </p>
        </div>

        {/* Back to the app - Mercury's "‹ Dashboard". */}
        <Link
          to="/my-home"
          className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1"
        >
          <ChevronLeft className="h-[18px] w-[18px] text-muted-foreground" aria-hidden />
          <span className="truncate">{t("misc:nav.dashboard")}</span>
        </Link>

        <nav aria-label={t("common:labels.settings")} className="flex flex-col gap-0.5">
          <SectionBreak collapsed={false} label={t("common:labels.settings")} />
          {visibleSettingsSections(effectiveIsAdmin).map((section) => {
            const Icon = section.icon;
            const active = section.id === activeSettingsSection;
            return (
              <Link
                key={section.id}
                to={`/settings?section=${section.id}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-0 items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1",
                  active
                    ? "bg-malachite-50 text-malachite-800 dark:bg-malachite-900/40 dark:text-malachite-300"
                    : "text-muted-foreground hover:bg-accent",
                )}
              >
                <Icon
                  className={cn("h-[18px] w-[18px]", active ? "text-malachite-600" : "text-muted-foreground")}
                  aria-hidden
                />
                <span className="truncate">{t(section.labelKey)}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        // Full viewport height (the desktop app shell has no top bar - this
        // sidebar carries the brand). overflow-hidden: the sidebar NEVER
        // scrolls; the disclosure accordion + compact rows bound its height.
        "fixed bottom-0 left-0 top-0 z-[1000] hidden flex-col overflow-hidden border-r border-sidebar-border bg-sidebar py-3 md:flex",
        collapsed ? "w-16 items-center px-2" : "w-[220px] px-3",
      )}
    >
      <div className={cn("mb-3 shrink-0", collapsed ? "px-0" : "px-2.5")}>
        <Link
          to="/my-home"
          className={cn(
            "flex items-center gap-2 rounded-lg text-xl leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1",
            collapsed && "justify-center",
          )}
          aria-label={t("misc:sidebar.brandHome")}
        >
          <img
            src="/dormcheck-logo-new.png"
            alt=""
            draggable={false}
            className="h-7 w-7 shrink-0 select-none object-contain"
            onError={(e) => {
              e.currentTarget.src = "/dormcheck-logo.png";
            }}
          />
          {!collapsed && <span className="brand-wordmark text-lg">DormCheck</span>}
        </Link>
        {!collapsed && (
          <p className="mt-1 truncate text-xs font-semibold text-muted-foreground">
            {university.name}
          </p>
        )}
      </div>
      <div className={cn("shrink-0", collapsed ? "mb-2 flex justify-center" : "")}>
        <SidebarSearchButton collapsed={collapsed} />
      </div>
      <nav
        aria-label={t("misc:sidebar.primaryNav")}
        className={cn("flex flex-col", collapsed ? "items-center gap-1" : "gap-0.5")}
      >
        {renderEntry(HOME)}

        <SectionBreak collapsed={collapsed} label={t("misc:sections.housing")} />
        {showHousing ? renderEntry(HOUSING) : renderSoon(HOUSING)}
        {showRoommates ? renderEntry(ROOMMATES) : renderSoon(ROOMMATES)}
        {/* Schedule follows its own flag - no "Soon" row when a school turns it
            off, since the route stays live for direct links either way. */}
        {showSchedule && renderEntry(SCHEDULE)}

        <SectionBreak collapsed={collapsed} label={t("misc:sections.checklist")} />
        {CHECKLIST_SECTION.map((entry) => renderEntry(entry))}

        <SectionBreak collapsed={collapsed} label={t("misc:sections.market")} />
        {renderEntry(MARKETPLACE)}
      </nav>

      <BookmarksSection collapsed={collapsed} pathname={pathname} />

      {/* Confirmed-roommate presence: renders nothing when there's no accepted group. */}
      <RoommatePresenceChip variant="sidebar" collapsed={collapsed} className="mt-1 w-full" />

      {/* Bottom holds ONLY the collapse toggle - account, admin, and profile
          live in the top-right ProfileMenu, so the sidebar stays lean. */}
      <div
        className={cn(
          "mt-auto border-t border-sidebar-border pt-2",
          collapsed && "flex w-full flex-col items-center",
        )}
      >
        {collapsed ? (
          <RailTooltip label={t("misc:sidebar.expandSidebar")}>
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label={t("misc:sidebar.expandSidebar")}
              className={cn(railLinkClass(false), "mt-1")}
            >
              <PanelLeftOpen className="h-5 w-5" aria-hidden />
            </button>
          </RailTooltip>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label={t("misc:sidebar.collapseSidebar")}
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-1"
          >
            <PanelLeftClose className="h-[18px] w-[18px] text-muted-foreground" aria-hidden />
            {t("misc:sidebar.collapse")}
          </button>
        )}
      </div>
    </aside>
  );
}
