import { lazy, Suspense, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal';
import { cn } from '@/lib/utils';
import { QuickReactionBar } from '@/components/chat/QuickReactionBar';
import type { AggregatedReaction } from '@/lib/reactionAggregation';

const EmojiPicker = lazy(() => import('@/components/chat/EmojiPicker'));

/**
 * Bottom room a bubble must reserve when it carries reactions. The chip hangs
 * ~12px below the bubble, so without this it would sit on top of the timestamp
 * / "Read" footer that follows it.
 * Apply to the RELATIVE BUBBLE BOX (not the message row) at the call site, so
 * the reserved gap lands between the bubble and its footer.
 */
export const reactionOverlapClass = 'mb-4';

export interface MessageReactionsProps {
  reactions: AggregatedReaction[];
  onToggle: (emoji: string) => void;
  /** Controlled picker open state (lifted so a long-press on the bubble can open it). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Match the bubble's alignment: 'end' = my messages (right), 'start' = theirs. */
  align?: 'start' | 'end';
  theme: 'light' | 'dark';
  /** Copies the message text. Omitted (no button) when there is nothing to copy. */
  onCopy?: () => void;
  /** Native share sheet. Only wired when the platform actually has one. */
  onShare?: () => void;
  /** Opens the report flow for this message. Absent on a message with no
   *  moderation handle (an optimistic row has no server `report_uuid` yet). */
  onReport?: () => void;
  className?: string;
}

// Renders the reaction pills for one message plus the "add reaction" affordance.
// The affordance button is invisible until the parent message is hovered
// (desktop) or the picker is open; on mobile the picker is opened by a long-press
// wired up in the panel, so the button staying hidden there is intentional.
//
// LAYOUT: the pills hang OFF the bubble's bottom edge (shadcn `Bubble` marker
// idiom) rather than sitting in the message's vertical flow — so a reaction
// reads as belonging to its bubble instead of as a third stacked row under it.
// That makes this component `absolute`: **the call site must render it inside a
// `relative` bubble wrapper** and reserve ~10px of bottom room when the message
// has reactions (see `reactionOverlapClass`).
export function MessageReactions({
  reactions,
  onToggle,
  open,
  onOpenChange,
  align = 'start',
  theme,
  onCopy,
  onShare,
  onReport,
  className,
}: MessageReactionsProps) {
  const { t } = useTranslation();
  // The full picker is a sheet with its OWN lifecycle: opening it closes the
  // quick bar, so it must NOT be reset when `open` goes false — that would
  // dismiss the sheet the instant it was asked for.
  const [showFullPicker, setShowFullPicker] = useState(false);

  return (
    <>
    <div
      className={cn(
        // The chip straddles the bubble's INWARD-FACING bottom corner — the one
        // pointing at the middle of the thread, never the one pointing at the
        // screen edge. Incoming bubbles hang it bottom-right, outgoing
        // bottom-left, so an outgoing reaction never crowds the phone's right
        // edge. Extra pills grow outward, away from the bubble.
        'pointer-events-none absolute -bottom-3 z-10 flex items-center gap-1',
        align === 'end' ? '-left-3' : '-right-3',
        className,
      )}
    >
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggle(r.emoji)}
          aria-pressed={r.reactedByMe}
          aria-label={t('messaging:reactions.pill', { emoji: r.emoji, count: r.count })}
          className={cn(
            // A round sticker, not a chip: the 2px `border-card` is a HALO in
            // the thread's own background color, which is what buys the gap
            // between the emoji and the bubble it overlaps. Sized so a single
            // emoji sits in a circle and a count widens it into a pill.
            'pointer-events-auto inline-flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-pill border-2 border-card px-1 text-xs leading-none shadow-raised transition-colors',
            r.reactedByMe
              ? 'bg-malachite-50 text-malachite-800 dark:bg-malachite-900/50 dark:text-malachite-200'
              : 'bg-muted text-muted-foreground hover:bg-accent',
          )}
        >
          <span aria-hidden className="text-sm leading-none">{r.emoji}</span>
          {r.count > 1 && <span className="tabular-nums font-medium">{r.count}</span>}
        </button>
      ))}
    </div>

      {/* The hover affordance is its OWN absolute box, beside the bubble on the
          outward side and vertically centred. Sharing the pills' flex row is
          what previously pushed the emoji off the corner: the button is
          invisible at rest but still consumed 32px of that row's width. */}
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('messaging:reactions.add')}
            className={cn(
              'absolute top-1/2 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-pill border-2 border-card bg-muted text-muted-foreground shadow-raised opacity-0 transition-opacity hover:bg-accent focus-visible:opacity-100 group-hover/message:opacity-100',
              align === 'end' ? '-left-9' : '-right-9',
              open && 'opacity-100',
            )}
          >
            <SmilePlus className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className="w-auto border-none bg-transparent p-0 shadow-none"
        >
          {/* Long-press lands on the quick bar, never the full picker — a
              350px panel inside a 390px thread is what made this feel like the
              page lurched. The picker is one deliberate tap further in. */}
          {open && (
            <QuickReactionBar
              mine={reactions.filter((r) => r.reactedByMe).map((r) => r.emoji)}
              onSelect={(emoji) => {
                onToggle(emoji);
                onOpenChange(false);
              }}
              onMore={() => {
                onOpenChange(false);
                // Dismiss the software keyboard FIRST. Without this the sheet
                // opens above a keyboard that is still up, stacking two
                // full-width surfaces — the picker has to REPLACE the keyboard
                // the way the iOS emoji keyboard does, not sit on top of it.
                (document.activeElement as HTMLElement | null)?.blur?.();
                setShowFullPicker(true);
              }}
              onCopy={onCopy}
              onShare={onShare}
              onReport={onReport}
            />
          )}
        </PopoverContent>
      </Popover>

      {/* The full picker is a SHEET, not a floating panel. As a popover it is a
          ~350px panel anchored to a bubble, so near the top of a thread it
          spilled off-screen — the same reason iOS presents the emoji keyboard
          from the bottom edge instead of over the message. */}
      <ResponsiveModal open={showFullPicker} onOpenChange={setShowFullPicker}>
        <ResponsiveModalContent dialogClassName="sm:max-w-sm">
          <ResponsiveModalHeader className="sr-only">
            <ResponsiveModalTitle>{t('messaging:reactions.add')}</ResponsiveModalTitle>
          </ResponsiveModalHeader>
          <Suspense fallback={<div className="h-80" aria-hidden />}>
            {showFullPicker && (
              <div className="flex justify-center [&_.EmojiPickerReact]:!w-full">
                <EmojiPicker
                  theme={theme}
                  onSelect={(emoji) => {
                    onToggle(emoji);
                    setShowFullPicker(false);
                  }}
                />
              </div>
            )}
          </Suspense>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </>
  );
}
