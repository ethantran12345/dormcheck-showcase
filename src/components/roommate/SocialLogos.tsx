import { cn } from '@/lib/utils';

/** Instagram and Snapchat logos using provided official icons */

export function InstagramLogo({ className }: { className?: string }) {
  return (
    <img
      src="/icons/instagram.png"
      alt=""
      className={cn('object-contain', className)}
      aria-hidden
    />
  );
}

export function SnapchatLogo({ className }: { className?: string }) {
  return (
    <img
      src="/icons/snapchat.png"
      alt=""
      className={cn('object-contain', className)}
      aria-hidden
    />
  );
}
