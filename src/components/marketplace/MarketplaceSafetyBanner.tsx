import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, X } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SafetyTipsDialog } from '@/components/marketplace/SafetyTipsDialog';

const STORAGE_KEY = 'dc-marketplace-safety-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, 'true');
  } catch {
    // ignore storage errors (private mode, quota exceeded)
  }
}

/**
 * Dismissible in-person trading safety notice on the marketplace feed. Persists
 * dismissal in localStorage so it stays hidden across reloads. Opens the shared
 * SafetyTipsDialog. Closes the Pitt Digital Security commitment (visible safety
 * notice in the marketplace before pilot go-live).
 */
export function MarketplaceSafetyBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [tipsOpen, setTipsOpen] = useState(false);

  const handleDismiss = () => {
    setDismissed(true);
    writeDismissed();
  };

  if (dismissed) return null;

  return (
    <>
      <Alert
        data-testid="marketplace-safety-banner"
        className="mb-4 flex items-center gap-3 border-border bg-muted pr-2"
      >
        <span className="shrink-0">
          <ShieldCheck className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <p className="min-w-0 flex-1 text-sm text-foreground">
          {t('marketplace:safetyBanner.text')}{' '}
          <button
            type="button"
            onClick={() => setTipsOpen(true)}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {t('marketplace:safetyBanner.tipsLink')}
          </button>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleDismiss}
          aria-label={t('marketplace:safetyBanner.dismiss')}
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </Button>
      </Alert>
      <SafetyTipsDialog open={tipsOpen} onOpenChange={setTipsOpen} />
    </>
  );
}

export default MarketplaceSafetyBanner;
