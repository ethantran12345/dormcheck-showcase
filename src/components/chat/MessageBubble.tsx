import { cn } from '@/lib/utils';
import { Bubble, BubbleContent } from '@/components/ui/bubble';

/**
 * The malachite bubble skin — the single source of truth for BOTH the DM
 * (ChatPanel) and group (GroupChatPanel) threads, so they stay visually
 * identical. Applied to a shadcn `BubbleContent` surface.
 *   outgoing: malachite-800 fill, white text, tail bottom-right
 *   incoming: muted fill, foreground text, tail bottom-left
 */
export function bubbleSurfaceClass(isMe: boolean) {
  return cn(
    'rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words',
    isMe ? 'bg-malachite-800 text-white rounded-br-md' : 'bg-muted text-foreground rounded-bl-md'
  );
}

interface MessageBubbleProps {
  content: string;
  isMe: boolean;
  className?: string;
}

export function MessageBubble({ content, isMe, className }: MessageBubbleProps) {
  return (
    <div className={cn('flex w-full', isMe ? 'justify-end' : 'justify-start')}>
      <Bubble align={isMe ? 'end' : 'start'} className="max-w-[75%]">
        <BubbleContent className={cn(bubbleSurfaceClass(isMe), className)}>{content}</BubbleContent>
      </Bubble>
    </div>
  );
}
