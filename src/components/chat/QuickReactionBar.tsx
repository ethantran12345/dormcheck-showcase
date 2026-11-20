import { Copy, Flag, Plus, Share } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The six one-tap reactions, in iMessage's order. Deliberately a short, fixed
 * set: the point of the long-press bar is that the common reaction is one tap
 * away, so the full picker stays behind the "+" rather than being the default.
 */
export const QUICK_REACTIONS = ['❤️', '👍', '👎', '😂', '‼️', '❓'] as const;

interface QuickReactionBarProps {
  /** Emoji the current user has already put on this message (rendered pressed). */
  mine: string[];
  onSelect: (emoji: string) => void;
  /** Opens the full emoji picker in place of this bar. */
  onMore: () => void;
  /** Message actions, rendered as a second row. Omitted actions render nothing. */
  onCopy?: () => void;
  onShare?: () => void;
  onReport?: () => void;
  className?: string;
}

/**
 * The floating row that a long-press (or the hover affordance) opens above a
 * bubble. It is a small, self-sized pill — NOT the full picker — so opening it
 * can't reflow the thread or collide with the keyboard, which is what made the
 * previous "long-press opens emoji-mart" behavior feel like the page jumped.
 */
export function QuickReactionBar({
  mine,
  onSelect,
  onMore,
  onCopy,
  onShare,
  onReport,
  className,
}: QuickReactionBarProps) {
  const { t } = useTranslation();
  const actions = [
    onCopy ? { key: 'copy', icon: Copy, label: t('messaging:actions.copy'), run: onCopy } : null,
    onShare ? { key: 'share', icon: Share, label: t('messaging:actions.share'), run: onShare } : null,
    onReport ? { key: 'report', icon: Flag, label: t('messaging:actions.report'), run: onReport } : null,
  ].filter(Boolean) as { key: string; icon: typeof Copy; label: string; run: () => void }[];

  return (
    <div
      className={cn(
        // ONE pill. The actions used to live in a second floating card beneath
        // this one, which read as two unrelated menus stacked on the thread —
        // the reactions and the actions are one gesture's worth of choices, so
        // they belong on one surface.
        'flex items-center gap-0.5 rounded-pill border border-border/60 bg-card/95 p-1 shadow-overlay backdrop-blur-xl supports-[backdrop-filter]:bg-card/80',
        className,
      )}
    >
      {QUICK_REACTIONS.map((emoji) => {
        const pressed = mine.includes(emoji);
        return (
          // `size="icon"` carries no padding (h-10 w-10 only), so the h-9 w-9
          // below wins through cn() and the tap target is unchanged.
          <Button
            key={emoji}
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onSelect(emoji)}
            aria-pressed={pressed}
            aria-label={t('messaging:reactions.quick', { emoji, defaultValue: `React with ${emoji}` })}
            className={cn(
              // Touch target first: 36px is the smallest that still reads as a
              // comfortable tap row inside a floating pill.
              'flex h-9 w-9 items-center justify-center rounded-pill text-xl leading-none transition-transform',
              'active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100',
              pressed && 'bg-malachite-100 dark:bg-malachite-900/50',
            )}
          >
            <span aria-hidden>{emoji}</span>
          </Button>
        );
      })}

      <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />

      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onMore}
        aria-label={t('messaging:reactions.add')}
        className="flex h-9 w-8 items-center justify-center rounded-pill transition-colors hover:bg-accent [&_svg]:size-5 [&_svg]:text-muted-foreground"
      >
        <Plus />
      </Button>

      {/* Message actions ride in the SAME pill as icon-only buttons — labelled
          for screen readers, never as a second card floating over the thread.
          An action the platform cannot perform is not passed in, so it is
          absent rather than present-and-dead. */}
      {actions.map((a) => (
        <Button
          key={a.key}
          type="button"
          variant="ghost"
          size="icon"
          onClick={a.run}
          aria-label={a.label}
          className="flex h-9 w-8 items-center justify-center rounded-pill transition-colors hover:bg-accent [&_svg]:size-[18px] [&_svg]:text-muted-foreground"
        >
          <a.icon aria-hidden />
        </Button>
      ))}
    </div>
  );
}
