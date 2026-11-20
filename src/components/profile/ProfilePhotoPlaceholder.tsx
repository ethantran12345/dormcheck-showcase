import { User } from 'lucide-react';
import { getFirstNameInitial } from '@/lib/profileDisplay';
import { cn } from '@/lib/utils';

export interface ProfilePhotoPlaceholderProps {
  /** Display name used for the first initial when available */
  name: string;
  className?: string;
}

/**
 * Full-bleed placeholder for missing or failed profile photos (e.g. roommate cards).
 * Gradient + first initial, or User silhouette when no initial applies.
 */
export function ProfilePhotoPlaceholder({ name, className }: ProfilePhotoPlaceholderProps) {
  const initial = getFirstNameInitial(name);
  return (
    <div
      role="img"
      aria-label={name.trim() ? `No photo for ${name}` : 'No profile photo'}
      className={cn(
        'flex h-full w-full min-h-0 min-w-0 items-center justify-center bg-gradient-to-br from-muted to-muted/80',
        className
      )}
    >
      {initial ? (
        <span className="select-none text-4xl font-semibold text-muted-foreground" aria-hidden>
          {initial}
        </span>
      ) : (
        <User
          className="h-16 w-16 shrink-0 text-muted-foreground/40 min-[480px]:h-20 min-[480px]:w-20"
          strokeWidth={1.25}
          aria-hidden
        />
      )}
    </div>
  );
}
