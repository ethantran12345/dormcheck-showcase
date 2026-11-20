import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Full-surface "could not load" state with a retry. Used where a read the whole
 * page depends on failed (offline, server error), so the student sees what
 * happened and one thing to do, instead of a skeleton that never resolves.
 */
export function AppLoadFailed({ onRetry, busy = false }: { onRetry: () => void; busy?: boolean }) {
  const { t } = useTranslation('common');
  return (
    <div role="alert" className="flex min-h-[60vh] items-center justify-center bg-background">
      <EmptyState
        icon={WifiOff}
        title={t('loadFailed.title')}
        description={t('loadFailed.body')}
        action={
          <Button type="button" onClick={onRetry} disabled={busy}>
            {t('loadFailed.retry')}
          </Button>
        }
      />
    </div>
  );
}
