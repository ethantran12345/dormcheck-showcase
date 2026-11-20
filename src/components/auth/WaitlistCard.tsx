import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation, Trans } from 'react-i18next';
import { activeUniversities } from '@/config/universities';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { submitWaitlist } from '@/lib/waitlist';
import { emailDomain, storeWaitlistRef } from '@/lib/waitlistGrowth';
import { toast } from 'sonner';

type WaitlistCardProps = {
  /** Email the student typed on the auth form - prefilled and editable here. */
  email: string;
  /**
   * School name resolved from the email domain via the reference directory
   * (naming only, never authorizes sign-in). Personalizes the heading and
   * prefills the school field; null keeps the generic card.
   */
  resolvedSchoolName?: string | null;
  /** Return to the sign-in / sign-up form. */
  onBack: () => void;
};

/**
 * Shown in place of the auth form when the entered email is a valid address
 * whose domain is not an active university (any non-active domain, including
 * consumer domains like gmail). Captures demand instead of dead-ending signup.
 * The hard DB signup gate is untouched - this never calls signUp.
 */
export function WaitlistCard({ email, resolvedSchoolName, onBack }: WaitlistCardProps) {
  const { t } = useTranslation();
  const [waitlistEmail, setWaitlistEmail] = useState(email);
  const [schoolName, setSchoolName] = useState(resolvedSchoolName ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // Read the live schools from the registry instead of naming them in the copy:
  // the string said "we're live at the University of Pittsburgh" for a month
  // after CMU launched, and would go stale again on the next activation.
  // Joined with locale-supplied separators rather than Intl.ListFormat, which
  // isn't in this project's ES2020 lib.
  const liveSchools = useMemo(() => {
    const names = activeUniversities().map((u) => u.name);
    if (names.length <= 1) return names[0] ?? '';
    const separator = t('onboarding:waitlist.schoolsSeparator');
    const finalSeparator = t('onboarding:waitlist.schoolsFinalSeparator');
    return names.slice(0, -1).join(separator) + finalSeparator + names[names.length - 1];
  }, [t]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const doneHeadingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the card heading on the state swap (WCAG focus management).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useEffect(() => {
    if (done) doneHeadingRef.current?.focus();
  }, [done]);

  const navigate = useNavigate();
  // /waitlist lives in the marketing zone, which the native shell does not
  // mount - on native keep the plain done card instead of the status page.
  const isNative = Capacitor.isNativePlatform();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    const result = await submitWaitlist(waitlistEmail, schoolName);
    setIsSubmitting(false);
    if (result.ok) {
      const domain = emailDomain(waitlistEmail);
      if (!isNative && domain) {
        // Hand the joined student to the growth page. The email travels via
        // sessionStorage only - never in the URL (the URL is shareable).
        storeWaitlistRef({ domain, email: waitlistEmail.trim().toLowerCase() });
        navigate(`/waitlist?school=${encodeURIComponent(domain)}`);
        return;
      }
      setDone(true);
    } else if ('message' in result) {
      // strictNullChecks off → else doesn't narrow; key off the failure member.
      toast.error(result.message);
    }
  };

  if (done) {
    return (
      <div className="rounded-xl border border-malachite-200 bg-malachite-50 p-6 text-center dark:border-malachite-800 dark:bg-malachite-950/30">
        <h2
          ref={doneHeadingRef}
          tabIndex={-1}
          className="font-display text-xl font-bold text-foreground outline-none"
        >
          {t('onboarding:waitlist.doneTitle')}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('onboarding:waitlist.doneDescription')}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mt-5 rounded-full bg-muted px-5 font-semibold text-foreground hover:bg-muted/70 hover:text-foreground"
        >
          {t('common:actions.backToSignIn')}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="font-display text-xl font-bold text-foreground outline-none"
      >
        {resolvedSchoolName
          ? t('onboarding:waitlist.headingResolved', { schoolName: resolvedSchoolName })
          : t('onboarding:waitlist.headingGeneric')}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t('onboarding:waitlist.description', { schools: liveSchools })}
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div className="space-y-1">
          <Label htmlFor="waitlist-email">{t('onboarding:waitlist.emailLabel')}</Label>
          <Input
            id="waitlist-email"
            type="email"
            value={waitlistEmail}
            onChange={(e) => setWaitlistEmail(e.target.value)}
            className="w-full h-11 text-base bg-card border-border focus-visible:border-malachite-600 focus-visible:ring-malachite-600"
            required
            autoComplete="email"
            inputMode="email"
            disabled={isSubmitting}
          />
        </div>
        {/* School already resolved from the email domain: submit it silently
            and keep the form to the one field that matters. */}
        {!resolvedSchoolName && (
          <div className="space-y-1">
            <Label htmlFor="waitlist-school">
              <Trans i18nKey="onboarding:waitlist.schoolLabel" components={{ optional: <span className="text-muted-foreground" /> }} />
            </Label>
            <Input
              id="waitlist-school"
              type="text"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              placeholder={t('onboarding:waitlist.schoolPlaceholder')}
              className="w-full h-11 text-base bg-card border-border focus-visible:border-malachite-600 focus-visible:ring-malachite-600"
              autoComplete="organization"
              disabled={isSubmitting}
            />
          </div>
        )}
        <Button
          type="submit"
          className="w-full h-11 text-base font-semibold bg-malachite-800 hover:bg-malachite-900 text-white"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
          ) : (
            t('common:actions.joinWaitlist')
          )}
        </Button>
      </form>

      <div className="mt-4 flex justify-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="rounded-full bg-muted px-5 font-semibold text-foreground hover:bg-muted/70 hover:text-foreground"
        >
          {t('common:actions.backToSignIn')}
        </Button>
      </div>
    </div>
  );
}
