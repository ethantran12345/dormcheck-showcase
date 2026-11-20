import { User } from 'lucide-react';
import { AvatarFallback } from '@/components/ui/avatar';
import { getFirstNameInitial } from '@/lib/profileDisplay';
import { cn } from '@/lib/utils';

const sizeMap = {
  xs: { icon: 'h-3.5 w-3.5', text: 'text-[10px]' },
  sm: { icon: 'h-4 w-4', text: 'text-xs' },
  md: { icon: 'h-5 w-5', text: 'text-sm' },
  lg: { icon: 'h-8 w-8', text: 'text-lg' },
  xl: { icon: 'h-12 w-12', text: 'text-3xl' },
} as const;

export type ProfileAvatarFallbackSize = keyof typeof sizeMap;

export interface ProfileAvatarFallbackProps {
  name: string;
  size?: ProfileAvatarFallbackSize;
  className?: string;
}

/**
 * Neutral slate gradient fallback for round avatars (chat, popovers, match modal).
 */
export function ProfileAvatarFallback({
  name,
  size = 'md',
  className,
}: ProfileAvatarFallbackProps) {
  const initial = getFirstNameInitial(name);
  const { icon: iconCls, text: textCls } = sizeMap[size];
  return (
    <AvatarFallback
      className={cn(
        'rounded-full border-0 bg-gradient-to-br from-muted to-muted/80',
        className
      )}
    >
      {initial ? (
        <span className={cn('font-semibold text-muted-foreground', textCls)} aria-hidden>
          {initial}
        </span>
      ) : (
        <User className={cn('shrink-0 text-muted-foreground/40', iconCls)} strokeWidth={1.5} aria-hidden />
      )}
    </AvatarFallback>
  );
}
