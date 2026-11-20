import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Shared Settings layout primitives. Every Settings section opens with a
 * `SettingsSectionHeader` (green icon chip + title + one-line description) and
 * groups its rows inside `SettingsCardGroup` cards, each with an optional
 * uppercase small-caps label - the Mercury idiom. The section is NOT wrapped in
 * an outer card: header + groups sit flat on the page background so there is a
 * single level of grouping (the row card), not a card-inside-a-card. Presentation
 * only; no data or behavior lives here.
 */

/** Uppercase small-caps label above a card group. Mirrors the Notifications idiom. */
export const SETTINGS_GROUP_LABEL_CLASS =
  'px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground';

interface SettingsSectionHeaderProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** `destructive` tints the icon chip red for the Danger Zone. */
  tone?: 'brand' | 'destructive';
}

export function SettingsSectionHeader({
  icon: Icon,
  title,
  description,
  tone = 'brand',
}: SettingsSectionHeaderProps) {
  return (
    <div className="flex items-start gap-3 px-1 pb-1">
      <div
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          tone === 'destructive' ? 'bg-destructive/10' : 'bg-malachite-600/10',
        )}
      >
        <Icon
          className={cn(
            'h-5 w-5',
            tone === 'destructive' ? 'text-destructive' : 'text-malachite-600',
          )}
          aria-hidden
        />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-base font-bold leading-tight text-foreground">{title}</h2>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

/**
 * Desktop-native section body. On mobile it is a plain vertical stack (unchanged
 * single-column drill-down). On `lg+` it flows its card groups into a balanced
 * two-column masonry so a section fills the width of the page instead of floating
 * in one narrow centered column - each group is kept whole (`break-inside-avoid`).
 * Use for sections that are a set of INDEPENDENT groups (Account, Appearance,
 * Privacy, Support, Admin); keep forms and time-ordered lists single-column.
 */
export function SettingsSectionBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'space-y-6 lg:columns-2 lg:gap-6 lg:space-y-0 [&>*]:break-inside-avoid lg:[&>*]:mb-6',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface SettingsCardGroupProps {
  /** Optional uppercase small-caps label rendered above the card. */
  label?: string;
  /** Draw a hairline between direct child rows (default). Off for single-block content. */
  divided?: boolean;
  /**
   * Mercury "Company Profile" idiom: drop the floating card entirely (no border,
   * background, radius, or shadow) so the rows sit flat on the page, separated
   * only by full-width hairlines with a top+bottom rule bounding the group. Rows
   * lose their card gutter (flush to the content column) and gain airier vertical
   * padding. Use on the desktop "content" pages (Profile, Account, Security);
   * keep the default card for navigational / grouped pages (Support, Admin).
   */
  flat?: boolean;
  /** Extra classes on the inner card (e.g. padding for non-row content). */
  className?: string;
  children: ReactNode;
}

/**
 * One grouped-list ROW - the Bevel idiom: a fixed left label and a right-aligned
 * value/control. Control-agnostic on purpose: the caller passes an inline text
 * input, a Select, a Switch, a static value, or a chevron as `children`, so every
 * Settings surface renders the SAME row chrome (height, padding, label weight)
 * and only the right-hand control differs. Sits as a direct child of a
 * `SettingsCardGroup` so the card's `divide-y` draws the hairline between rows.
 *
 * `align="start"` top-aligns the label for tall controls (multi-line / stacked).
 * `interactive` adds the tap highlight when the whole row is a drill-in (wrap the
 * row in a <button>/<Link> yourself and pass this for the hover/active feedback).
 */
export const SETTINGS_ROW_CLASS =
  'flex w-full gap-3 px-4 py-2.5 min-h-[52px] text-left';

/** Borderless, right-aligned inline control styling for an <Input>/<SelectTrigger>
 *  living on the right of a SettingsRow. The row IS the visual field; the control
 *  itself carries no box so the row reads as one clean line. */
export const SETTINGS_INLINE_CONTROL_CLASS =
  'h-auto min-h-0 w-full border-0 bg-transparent p-0 text-right text-sm text-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/60';

interface SettingsRowProps {
  label: ReactNode;
  /** Associates the label with a control for a11y (matches the control's id). */
  htmlFor?: string;
  /** Right-aligned value/control. */
  children?: ReactNode;
  /** Red required marker after the label. */
  required?: boolean;
  /** Top-align the label instead of centering (for tall / stacked controls). */
  align?: 'center' | 'start';
  className?: string;
}

export function SettingsRow({
  label,
  htmlFor,
  children,
  required,
  align = 'center',
  className,
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        SETTINGS_ROW_CLASS,
        align === 'center' ? 'items-center' : 'items-start',
        className,
      )}
    >
      <Label
        htmlFor={htmlFor}
        className={cn(
          'shrink-0 text-sm font-medium text-foreground',
          align === 'start' && 'pt-0.5',
        )}
      >
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      {children != null && (
        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
          {children}
        </div>
      )}
    </div>
  );
}

export function SettingsCardGroup({
  label,
  divided = true,
  flat = false,
  className,
  children,
}: SettingsCardGroupProps) {
  return (
    <div>
      {label && <p className={SETTINGS_GROUP_LABEL_CLASS}>{label}</p>}
      <div
        className={cn(
          flat
            ? // Mercury flat row-list: drop the card (no border/bg/shadow/radius),
              // leaving full-width hairlines that bound the group and separate its
              // rows. Rows keep their own padding, so content is inset from the
              // panel edge while the dividers span the full width - the Company
              // Profile look. Robust across rows with differing internal padding.
              cn(
                'border-y border-border/70',
                divided && 'divide-y divide-border/70',
              )
            : cn(
                // Bevel-style floating card: rounder corners, a full-strength
                // hairline, and a soft 3D shadow so each group lifts off the page.
                'overflow-hidden rounded-2xl border border-border bg-card shadow-raised',
                divided && 'divide-y divide-border/70',
              ),
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
