import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { redeemBackupCode } from '@/lib/mfa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Full-screen TOTP gate (P0.3). Mounted app-wide inside AuthProvider: when the
 * session's assurance level needs an upgrade (user has a verified TOTP factor
 * but signed in with only the first factor), everything is blocked behind a
 * code prompt. Accepts an authenticator code or a one-time backup code
 * (use_backup_code() RPC). Burning a backup code leaves the TOTP factors
 * intact and flags the profile for re-enrollment; it grants passage for this
 * browser session only (sessionStorage), since GoTrue itself cannot upgrade
 * the session to aal2 without a live factor.
 */
const BACKUP_PASS_KEY = 'dc-mfa-backup-pass';

export function MfaChallengeGate() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [needed, setNeeded] = useState(false);
  const [checked, setChecked] = useState(false);
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkAal = useCallback(async () => {
    if (!user) {
      setNeeded(false);
      setChecked(true);
      return;
    }
    try {
      const { data, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalErr) throw aalErr;
      const upgradeNeeded = data.nextLevel === 'aal2' && data.nextLevel !== data.currentLevel;
      // A redeemed backup code cannot raise the GoTrue AAL (no live factor),
      // so passage is tracked per browser session; a fresh session re-gates.
      const backupPass = sessionStorage.getItem(BACKUP_PASS_KEY) === user.id;
      setNeeded(upgradeNeeded && !backupPass);
    } catch {
      setNeeded(false);
    } finally {
      setChecked(true);
    }
  }, [user]);

  useEffect(() => {
    void checkAal();
  }, [checkAal]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'totp') {
        const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
        if (fErr) throw fErr;
        const factor = factors.totp.find((f) => f.status === 'verified');
        if (!factor) throw new Error(t('auth:mfa.noAuthenticator'));
        const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({
          factorId: factor.id,
        });
        if (cErr) throw cErr;
        const { error: vErr } = await supabase.auth.mfa.verify({
          factorId: factor.id,
          challengeId: challenge.id,
          code: code.trim(),
        });
        if (vErr) throw vErr;
      } else {
        const ok = await redeemBackupCode(code);
        if (!ok) throw new Error(t('auth:mfa.invalidBackup'));
        // TOTP factors survive redemption, so the GoTrue AAL requirement
        // still reads "aal2 needed" — record the pass for this browser
        // session and open the gate. Settings will prompt re-enrollment via
        // profiles.mfa_reenroll_required.
        if (user) sessionStorage.setItem(BACKUP_PASS_KEY, user.id);
        setCode('');
        setNeeded(false);
        return;
      }
      setCode('');
      await checkAal();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    sessionStorage.removeItem(BACKUP_PASS_KEY);
    await supabase.auth.signOut();
    setNeeded(false);
  };

  if (!checked || !needed) return null;

  return (
    // Radix Dialog for the focus trap + scroll-lock + aria wiring, but every
    // dismissal path is deliberately severed: this is an AAL2 gate, so Escape,
    // outside-click and the built-in close button must NOT let a user through.
    // The only ways out are a valid code, a backup code, or signing out.
    <Dialog open modal>
      <DialogContent
        overlayClassName="bg-background"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="fixed inset-0 left-0 top-0 h-full w-full max-w-none translate-x-0 translate-y-0 place-items-center gap-0 rounded-none border-0 bg-background p-4 shadow-none sm:rounded-none [&>button]:hidden"
      >
        <div className="w-full max-w-sm space-y-5">
          <div className="space-y-1.5 text-center">
            <ShieldCheck className="mx-auto h-8 w-8 text-malachite-800" />
            <DialogTitle className="text-lg font-bold text-foreground">
              {t('auth:mfa.title')}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {mode === 'totp' ? t('auth:mfa.totpPrompt') : t('auth:mfa.backupPrompt')}
            </DialogDescription>
          </div>

          <div>
            <Label htmlFor="mfa-gate-code" className="text-sm font-medium">
              {mode === 'totp' ? t('auth:mfa.codeLabel') : t('auth:mfa.backupCodeLabel')}
            </Label>
            <Input
              id="mfa-gate-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode={mode === 'totp' ? 'numeric' : 'text'}
              autoComplete="one-time-code"
              placeholder={mode === 'totp' ? '123456' : 'xxxx-xxxx'}
              maxLength={mode === 'totp' ? 6 : 12}
              className="mt-1.5"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.trim()) void submit();
              }}
            />
            {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
          </div>

          <Button
            onClick={submit}
            disabled={busy || !code.trim()}
            className="w-full bg-malachite-800 hover:bg-malachite-900"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {t('auth:actions.verify')}
          </Button>

          <div className="flex items-center justify-between text-xs">
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-xs text-muted-foreground underline-offset-2"
              onClick={() => {
                setMode(mode === 'totp' ? 'backup' : 'totp');
                setCode('');
                setError(null);
              }}
            >
              {mode === 'totp' ? t('auth:mfa.useBackup') : t('auth:mfa.useAuthenticator')}
            </Button>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0 text-xs text-muted-foreground underline-offset-2"
              onClick={signOut}
            >
              {t('common:actions.signOut')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
