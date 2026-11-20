import { cn } from '@/lib/utils';
import { Marker } from '@/components/ui/marker';

/**
 * iMessage-style "typing…" dots for a DM thread. Built on the shadcn Marker
 * primitive (role="status" so assistive tech announces it politely). The dot
 * bounce is gated behind `motion-safe` to respect `prefers-reduced-motion`.
 */
export function TypingIndicator({ className }: { className?: string }) {
  return (
    <Marker role="status" aria-label="typing" className={cn('px-1', className)}>
      <span className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 motion-safe:animate-bounce"
            style={{ animationDelay: `${i * 0.15}s`, animationDuration: '1s' }}
            aria-hidden
          />
        ))}
      </span>
    </Marker>
  );
}
