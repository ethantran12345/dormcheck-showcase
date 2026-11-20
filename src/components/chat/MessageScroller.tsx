import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Native adaptation of shadcn's MessageScroller affordances (scroll-to-bottom
 * button + top edge fade) for a chat thread — WITHOUT pulling the `@shadcn/react`
 * package, which targets React 19 / Tailwind v4 and would regress this app's
 * iOS keyboard + safe-area handling (that logic stays in the parent panels).
 *
 * The scroll VIEWPORT is the ref target, so existing effects that read/write
 * `scrollTop`/`scrollHeight` (auto-stick, keyboard-open pinning) keep working
 * unchanged. All extra props (role, aria-*, style) are spread onto the viewport.
 */
export interface MessageScrollerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Classes for the scroll viewport (keep the panel's existing scroll classes here). */
  viewportClassName?: string;
  /** Show the top edge fade. Defaults to true. */
  fade?: boolean;
  /** Extra classes to position the jump-to-bottom button (e.g. clear the composer). */
  jumpButtonClassName?: string;
  /** Accessible label for the jump-to-bottom button. */
  jumpLabel?: string;
  /** px from the bottom past which the jump button appears. Defaults to 240. */
  jumpThreshold?: number;
}

export const MessageScroller = forwardRef<HTMLDivElement, MessageScrollerProps>(
  (
    {
      children,
      className,
      viewportClassName,
      fade = true,
      jumpButtonClassName,
      jumpLabel = 'Scroll to latest messages',
      jumpThreshold = 240,
      onScroll,
      ...viewportProps
    },
    ref
  ) => {
    const viewportRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => viewportRef.current as HTMLDivElement, []);

    const [showJump, setShowJump] = useState(false);

    const handleScroll = useCallback(
      (e: React.UIEvent<HTMLDivElement>) => {
        const el = viewportRef.current;
        if (el) {
          const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          setShowJump(distanceFromBottom > jumpThreshold);
        }
        onScroll?.(e);
      },
      [jumpThreshold, onScroll]
    );

    const jumpToBottom = useCallback(() => {
      const el = viewportRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, []);

    return (
      <div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
        <div ref={viewportRef} onScroll={handleScroll} className={viewportClassName} {...viewportProps}>
          {children}
        </div>

        {fade && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-5 bg-gradient-to-b from-card to-transparent"
          />
        )}

        {showJump && (
          <button
            type="button"
            onClick={jumpToBottom}
            aria-label={jumpLabel}
            className={cn(
              'absolute right-4 bottom-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border/50 bg-card/90 text-foreground shadow-overlay backdrop-blur-xl transition-transform hover:bg-card active:scale-95 supports-[backdrop-filter]:bg-card/70',
              jumpButtonClassName
            )}
          >
            <ChevronDown className="h-5 w-5" strokeWidth={2.2} />
          </button>
        )}
      </div>
    );
  }
);

MessageScroller.displayName = 'MessageScroller';
