import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  MARKETPLACE_PAYMENT_METHODS,
  MARKETPLACE_PAYMENT_METHOD_LABELS,
  togglePaymentMethod,
  type MarketplacePaymentMethod,
} from '@/lib/marketplacePaymentMethods';

interface PaymentMethodsFieldProps {
  value: MarketplacePaymentMethod[];
  onChange: (next: MarketplacePaymentMethod[]) => void;
  className?: string;
  idPrefix?: string;
}

export function PaymentMethodsField({
  value,
  onChange,
  className,
  idPrefix = 'payment-method',
}: PaymentMethodsFieldProps) {
  const { t } = useTranslation();
  return (
    <div className={cn('space-y-2', className)}>
      <Label className="text-sm font-medium text-foreground">{t('marketplace:paymentMethods.label')}</Label>
      <p className="text-xs text-muted-foreground">{t('marketplace:paymentMethods.selectAll')}</p>
      <div className="flex flex-wrap gap-2">
        {MARKETPLACE_PAYMENT_METHODS.map((method) => {
          const selected = value.includes(method);
          return (
            <button
              key={method}
              type="button"
              id={`${idPrefix}-${method}`}
              onClick={() => onChange(togglePaymentMethod(value, method))}
              className={cn(
                'inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                selected
                  ? 'border-border bg-foreground text-background'
                  : 'border-border bg-card text-foreground hover:bg-accent',
              )}
              aria-pressed={selected}
            >
              {MARKETPLACE_PAYMENT_METHOD_LABELS[method]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
