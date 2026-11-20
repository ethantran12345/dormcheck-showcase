import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, KeyRound, ShieldCheck, Copy, Check, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  SettingsCardGroup,
  SettingsSectionHeader,
} from '@/components/settings/SettingsSectionShell';
import {
  mintBackupCodes,
  getMySessions,
  revokeSession,
  revokeOtherSessions,
  describeUserAgent,
  type SessionRow,
} from '@/lib/mfa';
import {
  getMySecurityEvents,
  describeSecurityEvent,
  securityEventIcon,
  type SecurityActivity,
} from '@/lib/securityActivity';

type TotpFactor = { id: string; status: 'verified' | 'unverified' };

/**
 * Settings > Security (P0.3): TOTP two-factor auth (native supabase.auth.mfa)
 * with one-time backup codes (migration 20260712120000), plus the active
 * sessions list with per-session revoke and "sign out everywhere else".
 */
export function SettingsSecurity() {
  const { t } = useTranslation();
  const { user } = useAuth();

  // ── 2FA state ──────────────────────────────────────────────────────────────
  const [factor, setFactor] = useState<TotpFactor | null>(null);
  const [factorLoading, setFactorLoading] = useState(true);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollStep, setEnrollStep] = useState<'qr' | 'codes'>('qr');
  const [enrollFactorId, setEnrollFactorId] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [codesCopied, setCodesCopied] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');

  // ── Sessions state ─────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // ── Security activity + login-alerts state ──────────────────────────────────
  const [activity, setActivity] = useState<SecurityActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [loginAlerts, setLoginAlerts] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsSaving, setAlertsSaving] = useState(false);

  const refreshFactor = useCallback(async () => {
    setFactorLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      const verified = data.totp.find((f) => f.status === 'verified');
      setFactor(verified ? { id: verified.id, status: 'verified' } : null);
    } catch {
      setFactor(null);
    } finally {
      setFactorLoading(false);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      setSessions(await getMySessions());
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const refreshActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      setActivity(await getMySecurityEvents());
    } catch {
      setActivity(null);
    } finally {
      setActivityLoading(false);
    }
  }, []);

  const refreshLoginAlerts = useCallback(async () => {
    if (!user?.id) return;
    setAlertsLoading(true);
    try {
      const { data } = await supabase
        .from('profiles')
        .select('login_alerts')
        .eq('id', user.id)
        .maybeSingle();
      // login_alerts is newer than the generated types (migration 20260731070000).
      const row = data as unknown as { login_alerts: boolean | null } | null;
      setLoginAlerts(row?.login_alerts === true);
    } catch {
      setLoginAlerts(false);
    } finally {
      setAlertsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void refreshFactor();
    void refreshSessions();
    void refreshActivity();
    void refreshLoginAlerts();
  }, [refreshFactor, refreshSessions, refreshActivity, refreshLoginAlerts]);

  // Persists the preference. NOTE: the send path (new-device detection + email)
  // is not wired yet - see TODO(login-alerts-send) in migration 20260731070000.
  const toggleLoginAlerts = async (checked: boolean) => {
    if (!user?.id || alertsSaving) return;
    setAlertsSaving(true);
    setLoginAlerts(checked); // optimistic
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ login_alerts: checked } as never)
        .eq('id', user.id);
      if (error) throw error;
      toast.success(t('common:state.saved'), { description: t('settings:security.loginAlerts.saved') });
    } catch (err) {
      setLoginAlerts(!checked); // revert
      toast.error(t('common:toast.saveError'), {
        description: (err as Error).message,
      });
    } finally {
      setAlertsSaving(false);
    }
  };

  // ── Enroll flow ────────────────────────────────────────────────────────────

  const startEnroll = async () => {
    setBusy(true);
    try {
      // Clear any stale unverified factor from an abandoned attempt first.
      // NOTE: listFactors() only puts *verified* factors in data.totp/phone;
      // unverified ones (from an abandoned QR step) live only in data.all. Iterate
      // data.all or this cleanup is a no-op and the leftover factor blocks re-enroll
      // with "friendly name 'Authenticator app' already exists".
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const f of existing?.all ?? []) {
        if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Authenticator app',
      });
      if (error) throw error;
      setEnrollFactorId(data.id);
      setQrSvg(data.totp.qr_code);
      setTotpSecret(data.totp.secret);
      setEnrollStep('qr');
      setVerifyCode('');
      setEnrollOpen(true);
    } catch (err) {
      toast.error(t('settings:security.twoFactor.enrollError'), {
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmEnroll = async () => {
    if (!enrollFactorId || !user?.id) return;
    setBusy(true);
    try {
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
        factorId: enrollFactorId,
      });
      if (chErr) throw chErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: enrollFactorId,
        challengeId: challenge.id,
        code: verifyCode.trim(),
      });
      if (vErr) throw vErr;
      // The verify above upgraded this session to aal2, which the server-side
      // mint requires; codes are generated and hashed server-side.
      const codes = await mintBackupCodes();
      setBackupCodes(codes);
      setCodesCopied(false);
      setEnrollStep('codes');
      await refreshFactor();
    } catch (err) {
      toast.error(t('settings:security.twoFactor.verifyError'), {
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const finishEnroll = () => {
    setEnrollOpen(false);
    setBackupCodes([]);
    setQrSvg(null);
    setTotpSecret(null);
    setEnrollFactorId(null);
    toast.success(t('settings:security.twoFactor.enabledToast'), { description: t('settings:security.twoFactor.enabledDescription') });
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setCodesCopied(true);
    } catch {
      toast.error(t('settings:security.twoFactor.copyError'), { description: t('settings:security.twoFactor.copyManual') });
    }
  };

  // ── Disable flow (re-auth with a current code, then unenroll) ─────────────

  const confirmDisable = async () => {
    if (!factor || !user?.id) return;
    setBusy(true);
    try {
      const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
        factorId: factor.id,
      });
      if (chErr) throw chErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code: disableCode.trim(),
      });
      if (vErr) throw vErr;
      // Delete the codes BEFORE unenrolling: the DB requires aal2 to delete
      // them, and the verify above is what makes this session aal2. Unenrolling
      // first drops the factor that justifies the claim.
      const { error: delErr } = await supabase.from('mfa_backup_codes').delete().eq('user_id', user.id);
      if (delErr) throw delErr;
      const { error: unErr } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
      if (unErr) throw unErr;
      setDisableOpen(false);
      setDisableCode('');
      await refreshFactor();
      toast('Two-factor authentication is off');
    } catch (err) {
      toast.error('Could not turn off 2FA', {
        description: (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  // ── Sessions actions ───────────────────────────────────────────────────────

  const handleRevoke = async (sessionId: string) => {
    setRevokingId(sessionId);
    try {
      await revokeSession(sessionId);
      await refreshSessions();
      toast.success(t('settings:security.sessions.revokeSuccess'));
    } catch (err) {
      toast.error(t('settings:security.sessions.revokeError'), { description: (err as Error).message });
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeOthers = async () => {
    setRevokingId('others');
    try {
      const n = await revokeOtherSessions();
      await refreshSessions();
      toast(n > 0 ? t('settings:security.sessions.revokeOthersSuccess', { count: n }) : t('settings:security.sessions.noOthers'));
    } catch (err) {
      toast.error(t('settings:security.sessions.revokeOthersError'), { description: (err as Error).message });
    } finally {
      setRevokingId(null);
    }
  };

  const otherSessions = sessions.filter((s) => !s.is_current);

  // Recent activity is flooded by hourly token refresh/revoke pairs, so collapse
  // to the most recent handful and let students expand on demand rather than
  // scroll past dozens of low-signal rows.
  const COLLAPSED_ACTIVITY_COUNT = 5;
  const activityEvents = activity?.events ?? [];
  const hiddenActivityCount = Math.max(0, activityEvents.length - COLLAPSED_ACTIVITY_COUNT);
  const visibleActivityEvents = activityExpanded
    ? activityEvents
    : activityEvents.slice(0, COLLAPSED_ACTIVITY_COUNT);

  return (
    <>
      <div className="space-y-6">
        <SettingsSectionHeader
          icon={ShieldCheck}
          title={t('settings:security.title')}
          description={t('settings:security.description')}
        />
        <div className="max-w-3xl space-y-6">
          {/* ── Recent security activity (headline) ── */}
          <SettingsCardGroup flat label={t('settings:security.activity.title')}>
            {activityLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('settings:security.activity.loading')}
              </div>
            ) : activity && activityEvents.length > 0 ? (
              <>
                {visibleActivityEvents.map((e) => {
                  const Icon = securityEventIcon(e.type);
                  return (
                    <div key={e.id} className="flex items-start gap-3 p-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-malachite-600/10">
                        <Icon className="h-4 w-4 text-malachite-600" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {describeSecurityEvent(e.type)}
                          {e.user_agent && (
                            <span className="font-normal text-muted-foreground">
                              {' '}
                              · {describeUserAgent(e.user_agent)}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {e.ip ? `${e.ip} · ` : ''}
                          {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {(hiddenActivityCount > 0 || activityExpanded) && (
                  <button
                    type="button"
                    onClick={() => setActivityExpanded((v) => !v)}
                    aria-expanded={activityExpanded}
                    className="flex w-full items-center justify-center gap-1.5 p-4 text-sm font-medium text-malachite-800 transition-colors hover:bg-malachite-600/5"
                  >
                    {activityExpanded ? (
                      <>
                        {t('settings:security.activity.showLess')}
                        <ChevronUp className="h-4 w-4" aria-hidden />
                      </>
                    ) : (
                      <>
                        {t('settings:security.activity.showMore', { count: hiddenActivityCount })}
                        <ChevronDown className="h-4 w-4" aria-hidden />
                      </>
                    )}
                  </button>
                )}
                {/* Honest scope note: the audit-log branch (password / 2FA changes)
                    is empty until GoTrue audit logging is enabled, so only sign-ins
                    show today. */}
                <p className="p-4 text-xs leading-snug text-muted-foreground">
                  {t('settings:security.activity.note')}
                </p>
              </>
            ) : (
              // No sign-in rows (rare while signed in): fall back to the real last-sign-in anchor.
              <div className="flex items-start gap-3 p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-malachite-600/10">
                  <Clock className="h-4 w-4 text-malachite-600" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{t('settings:security.activity.lastSignIn')}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {activity?.last_sign_in_at
                      ? formatDistanceToNow(new Date(activity.last_sign_in_at), { addSuffix: true })
                      : t('settings:security.activity.notRecorded')}
                  </p>
                </div>
              </div>
            )}
          </SettingsCardGroup>

          {/* ── Login alerts (preference only; send path is a follow-up) ── */}
          <SettingsCardGroup flat label={t('settings:security.loginAlerts.title')} divided={false} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Label htmlFor="login-alerts" className="text-sm font-medium text-foreground">
                  {t('settings:security.loginAlerts.label')}
                </Label>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {t('settings:security.loginAlerts.description')}
                </p>
              </div>
              <Switch
                id="login-alerts"
                checked={loginAlerts}
                onCheckedChange={toggleLoginAlerts}
                disabled={alertsLoading || alertsSaving}
                className="shrink-0 data-[state=checked]:bg-malachite-600"
                aria-label={t('settings:security.loginAlerts.ariaLabel')}
              />
            </div>
          </SettingsCardGroup>

          {/* ── Two-factor authentication ── */}
          <SettingsCardGroup flat label={t('settings:security.twoFactor.title')} divided={false} className="p-4 space-y-3">
            <p className="text-xs text-muted-foreground leading-snug">
              {t('settings:security.twoFactor.description')}
            </p>
            {factorLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('settings:security.twoFactor.checking')}
              </div>
            ) : factor ? (
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-malachite-800">
                  <Check className="h-4 w-4" /> {t('settings:security.twoFactor.enabled')}
                </span>
                <Button variant="outline" size="sm" onClick={() => setDisableOpen(true)}>
                  {t('settings:security.twoFactor.disable')}
                </Button>
              </div>
            ) : (
              <Button onClick={startEnroll} disabled={busy} className="bg-malachite-800 hover:bg-malachite-900">
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <KeyRound className="h-4 w-4 mr-2" />}
                {t('settings:security.twoFactor.setup')}
              </Button>
            )}
          </SettingsCardGroup>

          {/* ── Active sessions ── */}
          <SettingsCardGroup flat label={t('settings:security.sessions.title')}>
            {sessionsLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('settings:security.sessions.loading')}
              </div>
            ) : (
              <>
                {sessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {describeUserAgent(s.user_agent)}
                        {s.is_current && (
                          <span className="ml-2 rounded-full bg-malachite-600/15 px-2 py-0.5 text-[11px] font-semibold text-malachite-800">
                            {t('settings:security.sessions.thisDevice')}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {s.ip ? `${s.ip} · ` : ''}
                        {t('settings:security.sessions.lastSeen', { when: formatDistanceToNow(new Date(s.last_seen_at), { addSuffix: true }) })}
                      </p>
                    </div>
                    {!s.is_current && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRevoke(s.id)}
                        disabled={revokingId !== null}
                      >
                        {revokingId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : t('settings:security.sessions.signOut')}
                      </Button>
                    )}
                  </div>
                ))}
                {otherSessions.length > 0 && (
                  <div className="p-4">
                    <Button
                      variant="outline"
                      onClick={handleRevokeOthers}
                      disabled={revokingId !== null}
                      className="text-destructive border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
                    >
                      {revokingId === 'others' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      {t('settings:security.sessions.signOutAll')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </SettingsCardGroup>
        </div>
      </div>

      {/* ── Enroll dialog ── */}
      <Dialog
        open={enrollOpen}
        onOpenChange={(open) => {
          // During the codes step, closing = done (codes already stored).
          if (!open && enrollStep === 'codes') return finishEnroll();
          setEnrollOpen(open);
        }}
      >
        <DialogContent className="max-w-md">
          {enrollStep === 'qr' ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('settings:security.twoFactor.enrollTitle')}</DialogTitle>
                <DialogDescription>
                  {t('settings:security.twoFactor.enrollQrDescription')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                {qrSvg && (
                  <div className="flex justify-center rounded-xl border border-border bg-card p-3">
                    <img src={qrSvg} alt={t('settings:security.twoFactor.qrCodeAlt')} className="h-44 w-44" />
                  </div>
                )}
                {totpSecret && (
                  <p className="text-xs text-muted-foreground break-all">
                    {t('settings:security.twoFactor.manualKeyPrefix')}{' '}
                    <span className="font-mono text-foreground">{totpSecret}</span>
                  </p>
                )}
                <div>
                  <Label htmlFor="mfa-enroll-code" className="text-sm font-medium">
                    {t('settings:security.twoFactor.codeLabel')}
                  </Label>
                  <Input
                    id="mfa-enroll-code"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={6}
                    className="mt-1.5"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEnrollOpen(false)} disabled={busy}>
                  {t('common:actions.cancel')}
                </Button>
                <Button
                  onClick={confirmEnroll}
                  disabled={busy || verifyCode.trim().length !== 6}
                  className="bg-malachite-800 hover:bg-malachite-900"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {t('settings:security.twoFactor.verify')}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t('settings:security.twoFactor.backupCodesTitle')}</DialogTitle>
                <DialogDescription>
                  {t('settings:security.twoFactor.backupCodesDescription')}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/40 p-4 font-mono text-sm">
                {backupCodes.map((code) => (
                  <span key={code}>{code}</span>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={copyCodes}>
                  {codesCopied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                  {codesCopied ? t('settings:security.twoFactor.copied') : t('settings:security.twoFactor.copyCodes')}
                </Button>
                <Button onClick={finishEnroll} className="bg-malachite-800 hover:bg-malachite-900">
                  {t('common:actions.done')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Disable dialog ── */}
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('settings:security.twoFactor.disableTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings:security.twoFactor.disableDescription')}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="mfa-disable-code" className="text-sm font-medium">
              {t('settings:security.twoFactor.codeLabel')}
            </Label>
            <Input
              id="mfa-disable-code"
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              className="mt-1.5"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableOpen(false)} disabled={busy}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDisable}
              disabled={busy || disableCode.trim().length !== 6}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t('settings:security.twoFactor.disableConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
