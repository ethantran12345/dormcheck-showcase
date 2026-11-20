import { cn } from '@/lib/utils';

/**
 * TikTok brand glyph, monochrome (`currentColor`) so it sits in the same
 * treatment as the Lucide icons around it. Not available in lucide-react —
 * this is one of the few genuinely custom marks the design rules allow.
 * Instagram's mark IS in lucide-react; import `Instagram` from there instead.
 */
export function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn('h-4 w-4', className)}
    >
      <path d="M16.5 1.5h-3.3v14.2a2.7 2.7 0 1 1-2.7-2.7c.28 0 .55.04.8.12V9.75a6 6 0 1 0 5.2 5.95V8.63a7.8 7.8 0 0 0 4.5 1.44V6.78a4.5 4.5 0 0 1-4.5-4.5v-.78Z" />
    </svg>
  );
}
