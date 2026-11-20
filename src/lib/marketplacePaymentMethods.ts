export const MARKETPLACE_PAYMENT_METHODS = ['zelle', 'venmo', 'cash'] as const;
export type MarketplacePaymentMethod = (typeof MARKETPLACE_PAYMENT_METHODS)[number];

export const MARKETPLACE_PAYMENT_METHOD_LABELS: Record<MarketplacePaymentMethod, string> = {
  zelle: 'Zelle',
  venmo: 'Venmo',
  cash: 'Cash',
};

export function isMarketplacePaymentMethod(value: string): value is MarketplacePaymentMethod {
  return (MARKETPLACE_PAYMENT_METHODS as readonly string[]).includes(value);
}

export function normalizePaymentMethods(
  methods: string[] | null | undefined,
): MarketplacePaymentMethod[] {
  const out: MarketplacePaymentMethod[] = [];
  for (const raw of methods ?? []) {
    const key = raw.trim().toLowerCase();
    if (isMarketplacePaymentMethod(key) && !out.includes(key)) {
      out.push(key);
    }
  }
  return out;
}

export function formatPaymentMethodLabel(method: string): string {
  const key = method.trim().toLowerCase();
  if (isMarketplacePaymentMethod(key)) {
    return MARKETPLACE_PAYMENT_METHOD_LABELS[key];
  }
  return method;
}

export function togglePaymentMethod(
  current: MarketplacePaymentMethod[],
  method: MarketplacePaymentMethod,
): MarketplacePaymentMethod[] {
  return current.includes(method) ? current.filter((m) => m !== method) : [...current, method];
}
