import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  /** Lucide glyph centered inside the default placeholder illustration. */
  icon?: LucideIcon;
  /**
   * Spot illustration - overrides the default placeholder. Use one of the
   * hand-authored set in `@/components/illustrations/DormIllustrations` (motif
   * rules live there and in docs/DECISIONS.md). Pass it on FIRST-RUN states
   * only: filtered-to-empty and zero-result search keep the plain glyph so the
   * three states never look like one.
   */
  illustration?: ReactNode;
  /** Headline - short, on-brand, no em dashes. */
  title: string;
  /** Optional supporting line under the headline. */
  description?: string;
  /** Optional CTA (a <Button>, link, etc.). */
  action?: ReactNode;
  className?: string;
}

/**
 * Reusable empty-state block: an on-brand placeholder illustration, a headline,
 * optional subtext, and an optional CTA. Platform-agnostic - renders identically
 * on web and iOS. Replaces the app's scattered inline "muted icon + text" empty
 * states with one component that carries a little personality (the clipping's
 * "custom illustrations for empty states" tip).
 */
export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {illustration ?? <PlaceholderIllustration Icon={Icon} />}
      <p className="mt-4 text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-xs text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Placeholder illustration: soft concentric neutral discs with the feature's
 * lucide glyph centered. Intentionally simple and lightweight - a stand-in
 * until a real illustration set lands in the `illustration` slot. Neutral by
 * design: this renders on every surface, so a green disc pair here is ambient
 * brand noise the 1.7 subtractive pass removes rather than an earned accent.
 */
function PlaceholderIllustration({ Icon }: { Icon?: LucideIcon }) {
  return (
    <div className="relative flex h-20 w-20 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 80 80" className="absolute inset-0 h-full w-full">
        <circle cx="40" cy="40" r="38" className="fill-muted" />
        <circle cx="40" cy="40" r="26" className="fill-border" />
      </svg>
      {Icon && (
        <Icon
          className="relative h-8 w-8 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
    </div>
  );
}
