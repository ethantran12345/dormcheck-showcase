import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Phone, Download, Loader2, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SettingsCardGroup } from '@/components/settings/SettingsSectionShell';
import { PROFILE_ROW_ICON_CHIP_CLASS, PROFILE_ROW_ICON_CLASS } from '@/lib/profileDialogClasses';

/**
 * Privacy R3: your-data controls. Two schema-honest pieces plus the headline
 * data export.
 *
 * - Phone visibility is a read-only explainer, NOT a toggle: there is no
 *   profile-level phone-visibility column. Phone reveal is a per-listing /
 *   per-roommate-post opt-in (`marketplace_listings.show_phone` etc.), set where
 *   you create the post. A profile-level toggle would be a tier nothing enforces.
 * - "Download my data" calls the `export-user-data` edge function, which returns
 *   ONLY the caller's own rows (JWT `sub` + RLS-scoped reads), and downloads the
 *   JSON. No user id is ever sent from the client.
 * - Retention wording is pulled verbatim in spirit from the live Privacy Policy
 *   (src/pages/marketing/Privacy.tsx) - no invented durations.
 */
export function SettingsPrivacyData() {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error('Not signed in');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/export-user-data`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(detail?.error ?? `Export failed (${res.status})`);
      }
      const payload = await res.json();

      // Browser download of the JSON blob. (Native WKWebView save is a follow-up:
      // TODO(native-export) route through the Capacitor share sheet on iOS.)
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dormcheck-data-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(t('settings:privacy.download.success.title'), {
        description: t('settings:privacy.download.success.description'),
      });
    } catch (err) {
      toast.error(t('settings:privacy.download.error.title'), {
        description: err instanceof Error ? err.message : t('common:toast.genericError'),
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <SettingsCardGroup label={t('settings:privacy.download.cardLabel')}>
        {/* Phone visibility - honest explainer, not a toggle (no profile-level column). */}
        <div className="flex items-start gap-3 p-4">
          <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
            <Phone className={PROFILE_ROW_ICON_CLASS} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-tight text-foreground">
              {t('settings:privacy.phonePrivacy.title')}
            </p>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {t('settings:privacy.phonePrivacy.description')}
            </p>
          </div>
        </div>

        {/* Download my data - the headline export. */}
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
              <Download className={PROFILE_ROW_ICON_CLASS} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight text-foreground">{t('settings:privacy.download.title')}</p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                {t('settings:privacy.download.description')}
              </p>
            </div>
          </div>
          <Button
            onClick={handleExport}
            disabled={exporting}
            className="shrink-0 self-start sm:self-auto"
          >
            {exporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                {t('settings:privacy.download.preparing')}
              </>
            ) : (
              t('settings:privacy.download.button')
            )}
          </Button>
        </div>
      </SettingsCardGroup>

      {/* Data retention - plain-language, sourced from the live Privacy Policy. */}
      <SettingsCardGroup label={t('settings:privacy.retention.cardLabel')} divided={false} className="p-4">
        <div className="flex items-start gap-3">
          <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
            <Clock className={PROFILE_ROW_ICON_CLASS} />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-medium leading-tight text-foreground">
              {t('settings:privacy.retention.title')}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('settings:privacy.retention.description')}
            </p>
          </div>
        </div>
      </SettingsCardGroup>
    </>
  );
}
