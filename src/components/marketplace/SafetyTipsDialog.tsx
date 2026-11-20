import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useUniversity } from '@/contexts/UniversityContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SAFETY_CENTER_PATH } from '@/components/settings/settingsSections';

interface SafetyTipsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Shared in-person trading safety notice for the marketplace. Opened from the
 * feed banner (MarketplaceSafetyBanner) and from the "Safety tips" link in the
 * listing detail footer. Commitment made to Pitt Digital Security during the
 * vendor security review (visible safety notice before pilot go-live).
 */
export function SafetyTipsDialog({ open, onOpenChange }: SafetyTipsDialogProps) {
  const { t } = useTranslation();
  const { university } = useUniversity();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="safety-tips-dialog"
        className="max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t('misc:safety.title')}</DialogTitle>
          <DialogDescription>
            {t('misc:safety.intro', { school: university.shortName })}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-3 text-sm text-foreground">
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span>{t('misc:safety.meetPublic')}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span>{t('misc:safety.bringFriend')}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span>{t('misc:safety.inspect')}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span>{t('misc:safety.noMoney')}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span>{t('misc:safety.keepInApp')}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" />
            <span>{t('misc:safety.report')}</span>
          </li>
        </ul>
        <Link
          to={SAFETY_CENTER_PATH}
          onClick={() => onOpenChange(false)}
          className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
        >
          {t('misc:safety.safetyCenter')}
        </Link>
      </DialogContent>
    </Dialog>
  );
}

export default SafetyTipsDialog;
