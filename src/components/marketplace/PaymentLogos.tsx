import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';
import type { MarketplacePaymentMethod } from '@/lib/marketplacePaymentMethods';
import { DollarSign } from 'lucide-react';

/**
 * Third-party payment brand marks (Venmo / Cash App / Zelle) rendered as inline
 * SVG app-icon badges so the "Accepted payments" chips show the recognizable
 * brand, not just a word. Colors are each brand's OFFICIAL hex (not DormCheck
 * tokens) — this file is exempt in scripts/check-colors.mjs as brand data.
 * Icons are decorative (aria-hidden); the adjacent text label names them.
 */

type LogoProps = { className?: string };

/** Rounded-square badge with a centered white glyph — shared shell for all three. */
function BrandBadge({ fill, glyph, className }: { fill: string; glyph: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('shrink-0', className)} aria-hidden focusable="false">
      <rect width="24" height="24" rx="6" fill={fill} />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Nunito, system-ui, sans-serif"
        fontSize="15"
        fontWeight="700"
        fill="#ffffff"
      >
        {glyph}
      </text>
    </svg>
  );
}

/** Venmo — official "Venmo Blue" app-icon badge. */
export function VenmoLogo({ className }: LogoProps) {
  return <BrandBadge fill="#008CFF" glyph="V" className={className} />;
}

/** Cash App — official green badge with the signature dollar sign. */
export function CashAppLogo({ className }: LogoProps) {
  return <BrandBadge fill="#00D632" glyph="$" className={className} />;
}

/** Zelle — official purple badge with the stylized Z. */
export function ZelleLogo({ className }: LogoProps) {
  return <BrandBadge fill="#6D1ED4" glyph="Z" className={className} />;
}

/**
 * Plain in-person cash — no brand, so a neutral coin glyph keeps the chip row
 * visually consistent with the branded methods.
 */
export function CashLogo({ className }: LogoProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground',
        className,
      )}
      aria-hidden
    >
      <DollarSign className="h-3 w-3" strokeWidth={2.5} />
    </span>
  );
}

/** Map a payment method key to its brand mark. */
export const PAYMENT_METHOD_LOGOS: Record<MarketplacePaymentMethod, ComponentType<LogoProps>> = {
  venmo: VenmoLogo,
  zelle: ZelleLogo,
  cash: CashLogo,
};
