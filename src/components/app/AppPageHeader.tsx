import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { BookmarkToggle } from '@/components/app/BookmarkToggle';
import { getCreateAction } from '@/components/nav/navSections';

/**
 * Unified two-row page header for the desktop-web app shell (Mercury pattern).
 *
 *   row 1: page title (+ bookmark star) + subtitle   ·   primary action(s)
 *   row 2: {children} - the <PageToolbar> (scoped search + Filters) or sub-tab
 *          chips, present only on pages that need them.
 *
 * Every logged-in app page renders through this so the title, the single green
 * CTA, and the toolbar line up identically everywhere. The row sits in normal
 * flow below the shell's `pt-12` gap, so the primary action clears the fixed
 * top-right pill (messages/bell/profile) instead of colliding with it - the
 * bug this component exists to kill. The bell lives ONLY in that pill; never
 * add a notification control to a page toolbar.
 */
type AppPageHeaderProps = {
  title: string;
  subtitle?: ReactNode;
  /** Mercury bookmark star next to the title (desktop web only, self-hides). */
  bookmark?: boolean;
  /** Override the bookmarked title (e.g. a specific dorm name). */
  bookmarkTitle?: string;
  /**
   * Right-side title-row actions. When omitted, the page's create action
   * (navSections.getCreateAction) auto-renders as the single green primary
   * button, keeping this CTA in sync with the bottom-nav FAB. Pass `null` for
   * no action, or a node for custom/secondary actions (e.g. Schedule's
   * "Change home" + "Add class").
   */
  actions?: ReactNode;
  /** Row 2: the page toolbar or sub-tab chips. */
  children?: ReactNode;
  className?: string;
};

export function AppPageHeader({
  title,
  subtitle,
  bookmark,
  bookmarkTitle,
  actions,
  children,
  className,
}: AppPageHeaderProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const createAction = getCreateAction(pathname);
  let resolvedActions: ReactNode = actions;
  if (actions === undefined && createAction) {
    const { Icon, labelKey, to } = createAction;
    resolvedActions = (
      <Button
        onClick={() => navigate(to)}
        // KEEP: the surface's single primary create CTA (desktop header)
        // P8.5 desktop density: 44px is the FINGER target and stays the baseline for
        // touch; a pointer at lg+ doesn't need it, so the control tightens to 40px.
        className="h-11 shrink-0 gap-2 rounded-full bg-malachite-800 px-4 font-semibold text-white hover:bg-malachite-900 lg:h-10"
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span>{t(labelKey)}</span>
      </Button>
    );
  }

  return (
    <header className={cn('w-full pt-1 md:pt-2', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-2xl font-bold leading-tight text-foreground">{title}</h1>
            {bookmark && <BookmarkToggle title={bookmarkTitle} />}
          </div>
          {/* Identity P6 — subtitle rhythm. This line is running text, not a UI label,
              so it gets prose treatment: `leading-relaxed` (text-sm's stock 1.43 leading
              reads cramped once it wraps) and its own ~65ch measure. That max-w is an
              intrinsic TEXT measure on a caption, NOT a page container - see the contract
              in ui/page-container.tsx; without it a one-line subtitle stretched the full
              1152px of a `wide` screen and every app header read at the same flat density. */}
          {subtitle && (
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {resolvedActions && (
          <div className="flex shrink-0 items-center gap-2">{resolvedActions}</div>
        )}
      </div>
      {/* P8.5: row 2 sits closer to the title at lg+ (the phone gap is thumb-scaled). */}
      {children && <div className="mt-4 lg:mt-3">{children}</div>}
    </header>
  );
}
