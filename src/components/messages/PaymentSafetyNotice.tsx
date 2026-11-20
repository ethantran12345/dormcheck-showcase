import { ShieldAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * In-thread scam interstitial (P0.7): shown when the conversation mentions
 * deposits or off-platform payment rails. Dismissible per conversation per
 * session (ChatPanel owns the state).
 */
export function PaymentSafetyNotice({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="note"
      aria-label={t('messaging:safety.noticeLabel')}
      className="mx-auto mb-2 flex max-w-[95%] items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      <p className="flex-1 text-xs leading-snug text-amber-900">{t('messaging:safety.paymentWarning')}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('messaging:safety.dismissLabel')}
        className="shrink-0 rounded-full p-1 text-amber-700 transition-colors hover:bg-amber-100"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}
