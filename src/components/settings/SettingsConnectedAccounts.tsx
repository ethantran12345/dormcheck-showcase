import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { KeyRound, Link2, Loader2, Unlink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UserIdentity } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  PROFILE_ROW_ICON_CHIP_CLASS,
  PROFILE_ROW_ICON_CLASS,
} from '@/lib/profileDialogClasses';

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google',
  apple: 'Apple',
  email: 'Email & password',
};

/**
 * Connected sign-in methods (P1.9): lists the account's identities with
 * unlink, guarded so the ONLY remaining sign-in method can never be removed.
 * Linking a new OAuth identity is web-only (the native shell handles OAuth
 * at sign-in, not mid-session) and requires manual linking enabled in
 * Supabase Auth (config.toml locally, dashboard on hosted).
 */
export function SettingsConnectedAccounts() {
  const { t } = useTranslation();
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const isNative = Capacitor.isNativePlatform();

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.auth.getUserIdentities();
    if (!error) setIdentities(data?.identities ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canUnlink = (identities?.length ?? 0) > 1;

  const handleUnlink = async (identity: UserIdentity) => {
    if (!canUnlink || busy) return;
    setBusy(identity.identity_id);
    try {
      const { error } = await supabase.auth.unlinkIdentity(identity);
      if (error) throw error;
      await refresh();
      toast(t('settings:account.connected.removed'));
    } catch (err) {
      toast.error(t('settings:account.connected.removeError'), {
        description: (err as Error).message,
      });
    } finally {
      setBusy(null);
    }
  };

  const handleLinkGoogle = async () => {
    if (busy) return;
    setBusy('link-google');
    try {
      const { error } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/settings?section=account` },
      });
      if (error) throw error;
      // Redirects away on success; nothing further to do here.
    } catch (err) {
      toast.error(t('settings:account.connected.linkGoogleError'), {
        description: (err as Error).message,
      });
      setBusy(null);
    }
  };

  const hasGoogle = identities?.some((i) => i.provider === 'google') ?? false;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
          <Link2 className={PROFILE_ROW_ICON_CLASS} />
        </div>
        <div>
          <p className="font-medium text-sm leading-tight text-foreground">Connected sign-in methods</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
            Ways you can sign in to this account
          </p>
        </div>
      </div>

      {identities === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('common:state.loading')}
        </div>
      ) : (
        <ul className="space-y-2">
          {identities.map((identity) => (
            <li
              key={identity.identity_id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {PROVIDER_LABELS[identity.provider] ?? identity.provider}
                </p>
                {typeof identity.identity_data?.email === 'string' && (
                  <p className="text-xs text-muted-foreground truncate">{identity.identity_data.email}</p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleUnlink(identity)}
                disabled={!canUnlink || busy !== null}
                title={canUnlink ? undefined : t('settings:account.connected.lastMethodWarning')}
              >
                {busy === identity.identity_id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Unlink className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                    {t('common:actions.remove')}
                  </>
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!canUnlink && identities !== null && (
        <p className="text-xs text-muted-foreground">
          {t('settings:account.connected.onlyMethodHint')}
        </p>
      )}

      {!isNative && !hasGoogle && identities !== null && (
        <Button variant="outline" size="sm" onClick={() => void handleLinkGoogle()} disabled={busy !== null}>
          {busy === 'link-google' ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          ) : (
            <KeyRound className="h-3.5 w-3.5 mr-1.5" aria-hidden />
          )}
          {t('settings:account.connected.linkGoogle')}
        </Button>
      )}
    </div>
  );
}
