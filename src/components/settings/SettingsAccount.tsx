import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Phone, Mail, Loader2, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { useUniversity } from '@/contexts/UniversityContext';
import { isUniversityEmail } from '@/config/universities';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeOptional } from '@/lib/sanitize';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsCardGroup } from '@/components/settings/SettingsSectionShell';
import { PROFILE_ROW_ICON_CHIP_CLASS, PROFILE_ROW_ICON_CLASS } from '@/lib/profileDialogClasses';

/**
 * Account identity (R2): the verified-student hero plus schema-backed contact
 * info (phone edit, email view). Rendered at the top of the Account section,
 * above the existing Sign-in / connected-methods / Sign Out groups.
 *
 * Verified-student status is DERIVED, never a stored flag: a signed-in session
 * whose email domain matches the resolved university IS a verified student -
 * the university-email auth gate (enforced in Auth.tsx/AuthCallback.tsx + the
 * validate_pitt_email DB trigger) guarantees no other email can hold a session.
 * This mirrors VerifiedStudentBadge's presentational rule.
 */
export function SettingsAccount() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { university } = useUniversity();
  const queryClient = useQueryClient();

  const email = user?.email ?? null;
  const isVerifiedStudent = !!user && isUniversityEmail(university, email);

  // profiles.phone_number - schema-backed and editable. SMS/OTP verification is
  // a backend lift with no path yet: we save an UNVERIFIED number and never
  // render a verified badge on it. TODO(phone-verify): wire OTP confirmation.
  const { data: phoneNumber } = useQuery({
    queryKey: ['account_phone', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('profiles')
        .select('phone_number')
        .eq('id', user.id)
        .maybeSingle();
      return (data?.phone_number as string | null) ?? null;
    },
    enabled: !!user?.id,
  });

  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);

  useEffect(() => {
    setPhoneDraft(phoneNumber ?? '');
  }, [phoneNumber]);

  const handleSavePhone = async () => {
    if (!user?.id) return;
    setSavingPhone(true);
    const { error } = await supabase
      .from('profiles')
      .update({ phone_number: sanitizeOptional(phoneDraft) })
      .eq('id', user.id);
    setSavingPhone(false);
    if (error) {
      toast.error(t('settings:account.phone.saveError'), {
        description: t('common:toast.genericError'),
      });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['account_phone', user.id] });
    // Keep the roommate/profile reads that also surface phone_number in sync.
    queryClient.invalidateQueries({ queryKey: ['profile_me'] });
    setEditingPhone(false);
    toast.success(t('settings:account.phone.saved'));
  };

  const cancelPhoneEdit = () => {
    setEditingPhone(false);
    setPhoneDraft(phoneNumber ?? '');
  };

  return (
    <div className="space-y-6">
      {/* Verified-student hero - the core trust signal, featured first. */}
      <SettingsCardGroup
        divided={false}
        className={
          isVerifiedStudent
            ? 'border-malachite-600/30 bg-malachite-600/5 p-4'
            : 'p-4'
        }
      >
        <div className="flex items-start gap-3">
          <div
            className={
              isVerifiedStudent
                ? 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-malachite-600/15'
                : 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted'
            }
          >
            <ShieldCheck
              className={
                isVerifiedStudent
                  ? 'h-6 w-6 text-malachite-600'
                  : 'h-6 w-6 text-muted-foreground'
              }
              aria-hidden
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-bold leading-tight text-foreground">
              {isVerifiedStudent
                ? t('settings:account.verified.hero', { university: university.shortName })
                : t('settings:account.studentAccount')}
            </p>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{university.name}</p>
            {isVerifiedStudent && email && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3.5 w-3.5 shrink-0 text-malachite-600" aria-hidden />
                <span>
                  {t('settings:account.verified.via')} <span className="break-all font-medium text-foreground">{email}</span>
                </span>
              </p>
            )}
          </div>
        </div>
      </SettingsCardGroup>

      {/* Contact info - schema-backed edits only. Flat Mercury row-list. */}
      <SettingsCardGroup flat label={t('settings:account.contactInfo')}>
        {/* Phone number - view / inline edit. */}
        {editingPhone ? (
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-3">
              <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                <Phone className={PROFILE_ROW_ICON_CLASS} />
              </div>
              <Label htmlFor="account-phone" className="text-sm font-medium text-foreground">
                {t('settings:account.phone.title')}
              </Label>
            </div>
            <Input
              id="account-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(555) 555-5555"
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              className="h-10"
            />
            <p className="text-xs text-muted-foreground">
              {t('settings:account.phone.hint')}
            </p>
            <div className="flex gap-2">
              <Button onClick={handleSavePhone} disabled={savingPhone}>
                {savingPhone ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('common:actions.save')}
              </Button>
              <Button variant="outline" onClick={cancelPhoneEdit} disabled={savingPhone}>
                {t('common:actions.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 p-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                <Phone className={PROFILE_ROW_ICON_CLASS} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-tight text-foreground">{t('settings:account.phone.title')}</p>
                <p className="mt-0.5 break-all text-xs leading-tight text-muted-foreground">
                  {phoneNumber ? phoneNumber : t('settings:account.phone.notAdded')}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingPhone(true)}
              className="shrink-0 text-malachite-800 hover:bg-malachite-600/10 dark:text-malachite-400"
            >
              {phoneNumber ? t('common:actions.edit') : t('common:actions.add')}
            </Button>
          </div>
        )}

        {/* Email - sign-in address. Changing it needs a re-verification email
            flow that isn't wired yet, so the control is disabled + labelled.
            TODO(email-change): supabase.auth.updateUser({ email }) + confirm template. */}
        <div className="flex items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
              <Mail className={PROFILE_ROW_ICON_CLASS} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight text-foreground">{t('settings:account.email.title')}</p>
              <p className="mt-0.5 break-all text-xs leading-tight text-muted-foreground">
                {email ?? t('settings:account.email.notAvailable')}
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            {t('settings:account.email.comingSoon')}
          </span>
        </div>
      </SettingsCardGroup>
    </div>
  );
}
