import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal';

/**
 * The sign-in gate for an account-based action taken from a surface a guest is
 * allowed to browse (App Store 5.1.1(v)).
 *
 * Deliberately a prompt, not a redirect. Bouncing a guest to /auth the instant
 * they tap "Message seller" reads as "you must register to use this app" — the
 * exact impression that got build 30 rejected. This explains what needs an
 * account, and leaves them where they were if they decline.
 *
 * `redirectTo` rides through to /auth so signing in returns them to the listing
 * they were looking at rather than dropping them on the home tab.
 */
export function SignInPromptDialog({
  open,
  onOpenChange,
  action,
  redirectTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the guest just tried to do, e.g. "message this seller". */
  action: string | null;
  redirectTo?: string;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const target = redirectTo
    ? `/auth?redirect=${encodeURIComponent(redirectTo)}`
    : '/auth';

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="sm:max-w-sm">
        <ResponsiveModalHeader>
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-pill bg-malachite-50 dark:bg-malachite-900/40">
            <Lock className="h-5 w-5 text-malachite-800 dark:text-malachite-300" aria-hidden="true" />
          </div>
          <ResponsiveModalTitle className="text-center">
            {t('common:auth.signInRequiredTitle', 'Sign in to continue')}
          </ResponsiveModalTitle>
          <ResponsiveModalDescription className="text-center">
            {t('common:auth.signInRequiredBody', {
              defaultValue:
                'Browsing is open to everyone. You need a free student account to {{action}}.',
              action: action ?? t('common:auth.signInRequiredFallbackAction', 'do that'),
            })}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <div className="flex flex-col gap-2 px-4 pb-4 sm:px-0 sm:pb-0">
          <Button
            className="h-11 w-full"
            onClick={() => {
              onOpenChange(false);
              navigate(target);
            }}
          >
            {t('auth:actions.signIn')}
          </Button>
          <Button
            variant="ghost"
            className="h-11 w-full"
            onClick={() => onOpenChange(false)}
          >
            {t('common:auth.keepBrowsing', 'Keep browsing')}
          </Button>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
