import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  User,
  ChevronLeft,
  ChevronRight,
  LogOut,
  MessageSquare,
  Trash2,
  Loader2,
  FileText,
  Settings2,
  ShieldCheck,
  Compass,
  Ban,
  LifeBuoy,
  Wrench,
  RotateCcw,
  Palette,
  KeyRound,
  Users,
  ScrollText,
  Bell,
  UserCircle,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import { restartTour } from '@/components/tour/useTour';
import { useQueryClient } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '@/hooks/useAuth';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { supabase } from '@/integrations/supabase/client';
import { apiPost } from '@/lib/apiPost';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { useTurnstile, isCaptchaError, CAPTCHA_ERROR_MESSAGE } from '@/hooks/useTurnstile';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { useSetupMode } from '@/contexts/SetupModeContext';
import { useAdminFullAppPreview } from '@/contexts/AdminPreviewContext';
import { sanitizeText } from '@/lib/sanitize';
import { cn } from '@/lib/utils';
import { SettingsNotifications } from '@/components/settings/SettingsNotifications';
import { SettingsSecurity } from '@/components/settings/SettingsSecurity';
import { SettingsPrivacyControls } from '@/components/settings/SettingsPrivacyControls';
import { SettingsPrivacyData } from '@/components/settings/SettingsPrivacyData';
import { SettingsConnectedAccounts } from '@/components/settings/SettingsConnectedAccounts';
import { SettingsAccount } from '@/components/settings/SettingsAccount';
import { SettingsProfile } from '@/components/settings/SettingsProfile';
import { ThemeToggleGroup } from '@/components/app/ThemeToggleGroup';
import { SettingsAppearanceA11y } from '@/components/settings/SettingsAppearanceA11y';
import { SettingsLanguage } from '@/components/settings/SettingsLanguage';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useIsMobile } from '@/hooks/use-mobile';
import { resolveSettingsSection, visibleSettingsSections, type SettingsSectionId } from '@/components/settings/settingsSections';
import { SettingsSearch } from '@/components/settings/SettingsSearch';
import { settingsEntryBySlug } from '@/components/settings/settingsSearchIndex';
import {
  PROFILE_DIALOG_BODY_CLASS,
  PROFILE_DIALOG_CONTENT_CLASS,
  PROFILE_DIALOG_HEADER_CLASS,
  PROFILE_ROW_ICON_CHIP_CLASS,
  PROFILE_ROW_ICON_CLASS,
  PROFILE_SIGN_OUT_ICON_CHIP_CLASS,
  PROFILE_SIGN_OUT_ICON_CLASS,
} from '@/lib/profileDialogClasses';
import { SettingsCardGroup, SettingsSectionBody, SettingsSectionHeader } from '@/components/settings/SettingsSectionShell';
import { SafetyCenterContent } from '@/pages/app/SafetyCenterPage';
import { ModerationContent } from '@/pages/marketing/Moderation';
import { TermsContent } from '@/pages/marketing/Terms';
import { PrivacyContent } from '@/pages/marketing/Privacy';
import { LicensesContent } from '@/pages/marketing/Licenses';
import { useUniversity } from '@/contexts/UniversityContext';

/** Support & Legal docs rendered in-house (in place, inside the Settings surface)
 *  instead of navigating to a standalone marketing page that swaps the shell away
 *  from Settings and dead-ends the native back button. */
/* `feedback` rides the same doc channel as the legal pages: it is a drill-down
 * panel inside the one Settings sheet, not a second full-screen Dialog with its
 * own X in the opposite corner. */
type LegalDoc = 'safety' | 'guidelines' | 'terms' | 'privacy' | 'licenses' | 'feedback';
const LEGAL_DOC_IDS: readonly LegalDoc[] = ['safety', 'guidelines', 'terms', 'privacy', 'licenses', 'feedback'];

export function SettingsView() {
  const { t } = useTranslation();
  const { university } = useUniversity();
  const { signOut, user, isSuperAdmin } = useAuth();
  // View-as: hide the admin section while a superadmin previews as a student.
  const { effectiveIsAdmin: isAdmin } = useAdminUniversitySilo();
  // /admin never mounts on the native shell (see RoutedApp). Superadmins keep
  // this section natively for the preview/dev hot keys; university_admins'
  // only row here (Admin Panel) would 404 in-app, so hide it for them.
  const showAdminSection = isAdmin && (isSuperAdmin || !Capacitor.isNativePlatform());
  const { setupModeEnabled, setSetupModeEnabled } = useSetupMode();
  const { fullAppPreview, setFullAppPreview } = useAdminFullAppPreview();
  const { resetProfile } = useUserProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isSigningOut, setIsSigningOut] = useState(false);
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);
  const [showDeleteAccountDialog, setShowDeleteAccountDialog] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [isSettingPassword, setIsSettingPassword] = useState(false);
  const [deleteAccountVerification, setDeleteAccountVerification] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  // Captcha for the "send reset link" action (hits the captcha-protected
  // /recover endpoint). Setting a password directly (updateUser) is exempt.
  const turnstile = useTurnstile();

  // The left sidebar (AppSidebar's Settings variant) drives which section shows
  // via the `?section=` query param; render only that one panel here. On mobile
  // the sidebar is hidden, so `/settings` with no `?section=` becomes a
  // full-screen section list (drill-down) instead of defaulting to a panel.
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const rawSection = searchParams.get('section');
  const activeSection = resolveSettingsSection(rawSection, showAdminSection);
  // Mobile Settings is ONE bottom sheet (mounted by SettingsPage). Its body swaps
  // between the grouped root, a section panel, or an inline legal doc, keyed off the
  // URL (`?section=` / `?doc=`) so SettingsPage's pinned top-left X knows the depth
  // (back-to-root vs close). Every in-settings transition REPLACES the history entry,
  // so the whole surface is a single `/settings` entry — one drag or close pops
  // cleanly to wherever the user came from, never "two tabs back".
  const rawDoc = searchParams.get('doc');
  const mobileDoc = isMobile && LEGAL_DOC_IDS.includes(rawDoc as LegalDoc) ? (rawDoc as LegalDoc) : null;
  const openMobileSection = (id: SettingsSectionId) => setSearchParams({ section: id }, { replace: true });
  const openMobileDoc = (doc: LegalDoc) => setSearchParams({ doc }, { replace: true });
  // Legal docs are URL-driven on mobile (so SettingsPage's X can act as back), and
  // local state on desktop (inline within a section, with its own back chevron).
  const openDoc = (doc: LegalDoc) => (isMobile ? openMobileDoc(doc) : setLegalDoc(doc));
  // Label of the section the inline legal/support doc was opened from, for the
  // doc's back affordance (a legal doc is reachable from Support and Privacy).
  const activeSectionLabel =
    visibleSettingsSections(showAdminSection).find((s) => s.id === activeSection)?.label ?? '';
  const { showLanguagePicker } = useFeatureFlags();

  // Legal/support docs render inline (hoisted above the section panels, reachable
  // from Support and Privacy). Clear any open doc when the user switches sections
  // so returning lands on the row list, not a stale doc. Fires on section change
  // only, so setting the doc within a section (no section change) is preserved.
  useEffect(() => {
    setLegalDoc(null);
  }, [activeSection]);

  // Desktop deep-link into a doc (`?doc=safety`, the Safety Center's only
  // address since the /safety route was removed - PRD §5b). Mobile reads the
  // param directly; desktop keeps the doc in local state so its back chevron
  // and close both work, so consume the param once and strip it. Runs AFTER the
  // clear-on-section-change effect above, which would otherwise undo it on mount.
  useEffect(() => {
    if (isMobile || !LEGAL_DOC_IDS.includes(rawDoc as LegalDoc)) return;
    setLegalDoc(rawDoc as LegalDoc);
    const next = new URLSearchParams(searchParams);
    next.delete('doc');
    setSearchParams(next, { replace: true });
  }, [isMobile, rawDoc, searchParams, setSearchParams]);

  // Search deep-links carry `?sr=<slug>`; after the target section renders,
  // scroll to that row and flash a brand outline, then strip the param so a
  // refresh/back is clean. Anchored on the row's visible text - if the copy
  // drifts, this degrades to a section-level scroll rather than breaking.
  useEffect(() => {
    const slug = searchParams.get('sr');
    if (!slug) return;
    const entry = settingsEntryBySlug(slug);
    const localizedLabel = entry?.labelKey ? t(entry.labelKey) : (entry?.label ?? '');
    const anchorText = (localizedLabel ?? entry?.anchor ?? '').trim().toLowerCase();

    const findTarget = (): HTMLElement | null => {
      const container = entry ? document.getElementById(`settings-${entry.section}`) : null;
      if (container && anchorText) {
        const nodes = container.querySelectorAll<HTMLElement>('p, span, h2, h3, label, button, a');
        for (const node of Array.from(nodes)) {
          if (node.textContent?.trim().toLowerCase() === anchorText) {
            return (
              (node.closest('button, a, [class*="rounded-xl"], [class*="rounded-2xl"]') as HTMLElement | null) ??
              node
            );
          }
        }
      }
      return container;
    };

    const flash = (el: HTMLElement) => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const prev = {
        outline: el.style.outline,
        offset: el.style.outlineOffset,
        radius: el.style.borderRadius,
        transition: el.style.transition,
      };
      el.style.transition = 'outline-color 200ms ease';
      el.style.outline = '2px solid hsl(var(--dormcheck-brand))';
      el.style.outlineOffset = '3px';
      if (!prev.radius) el.style.borderRadius = '12px';
      window.setTimeout(() => {
        el.style.outline = prev.outline;
        el.style.outlineOffset = prev.offset;
        el.style.borderRadius = prev.radius;
        el.style.transition = prev.transition;
      }, 1800);
    };

    // Sections like Notifications hydrate their rows after an async query, so
    // poll briefly for the anchor before settling for the section container.
    let attempts = 0;
    let flashTimer = 0;
    const poll = window.setInterval(() => {
      attempts += 1;
      const target = findTarget();
      const rowFound = target?.id !== `settings-${entry?.section}`;
      if ((target && rowFound) || attempts >= 8) {
        window.clearInterval(poll);
        if (target) flashTimer = window.setTimeout(() => flash(target), 0);
        const next = new URLSearchParams(searchParams);
        next.delete('sr');
        setSearchParams(next, { replace: true });
      }
    }, 90);

    return () => {
      window.clearInterval(poll);
      if (flashTimer) window.clearTimeout(flashTimer);
    };
  }, [searchParams, setSearchParams, t]);

  const handleSearchNavigate = (section: string, slug: string) => {
    // Mobile keeps Settings a single history entry (replace); desktop pushes so the
    // sidebar's own back/forward stays intuitive.
    if (isMobile) {
      setSearchParams({ section, sr: slug }, { replace: true });
    } else {
      navigate(`/settings?section=${section}&sr=${slug}`);
    }
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      resetProfile();
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
      if (typeof window !== 'undefined') {
        window.location.href = window.location.origin;
      }
    } finally {
      setIsSigningOut(false);
    }
  };

  const formatDeleteError = (error?: string) => {
    return error || t('common:toast.genericError');
  };

  const handleDeleteAccount = async () => {
    if (deleteAccountVerification !== 'DELETE' || !user?.id) return;
    setIsDeletingAccount(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error('Not signed in');
      }
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/delete-user-account`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({} as { error?: string }));
        console.error('Delete account failed:', res.status, detail);
        toast.error(t('settings:danger.deleteError'), {
          description: formatDeleteError(detail?.error),
        });
        setIsDeletingAccount(false);
        return;
      }
      queryClient.clear();
      resetProfile();
      await signOut();
      if (typeof window !== 'undefined') {
        window.location.href = `${window.location.origin}/auth`;
      }
    } catch (err) {
      console.error('Delete account error:', err);
      toast.error(t('settings:danger.deleteError'), {
        description: t('settings:danger.deleteErrorDescription'),
      });
      setIsDeletingAccount(false);
    }
  };

  const handleChangePassword = async () => {
    const email = user?.email;
    if (!email) {
      toast.error(t('settings:view.noEmailTitle'), { description: t('settings:view.noEmailDescription') });
      return;
    }
    setIsResettingPassword(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth`,
      captchaToken: turnstile.captchaToken,
    });
    setIsResettingPassword(false);
    turnstile.reset(); // tokens are single-use
    if (error) {
      toast.error(t('settings:view.resetLinkError'), {
        description: isCaptchaError(error) ? CAPTCHA_ERROR_MESSAGE : t('settings:view.resetLinkErrorDescription'),
      });
    } else {
      toast.success(t('settings:view.resetLinkSent'), { description: t('settings:view.checkEmail') });
      setShowAccountDialog(false);
    }
  };

  const handleSetPassword = async () => {
    const pwd = newPassword.trim();
    if (!pwd) {
      toast.error(t('settings:view.enterPassword'), { description: t('settings:view.enterPasswordDescription') });
      return;
    }
    if (pwd.length < 6) {
      toast(t('settings:view.passwordTooShort'), { description: t('settings:view.passwordTooShortDescription') });
      return;
    }
    setIsSettingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setIsSettingPassword(false);
    if (error) {
      toast.error(t('settings:view.setPasswordError'), { description: error.message });
      return;
    }
    toast.success(t('settings:view.passwordSetSuccess'), { description: t('settings:view.passwordSetDescription') });
    setNewPassword('');
  };

  const handleFeedbackSubmit = async () => {
    const sanitized = sanitizeText(feedbackText);
    if (!sanitized) return;

    setIsSubmittingFeedback(true);
    try {
      // Sender email is derived server-side from the verified JWT.
      const res = await apiPost('/api/feedback', { message: sanitized });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(t('settings:view.feedbackSendError'), { description: data.error ?? t('common:toast.genericError') });
        return;
      }
      toast.success(t('settings:view.feedbackSent'), { description: t('settings:view.feedbackThanks') });
      setFeedbackText('');
      // Pop back to where the doc was opened from (root on mobile, the Support
      // section on desktop) - the drill-down equivalent of closing the dialog.
      if (isMobile) setSearchParams({}, { replace: true });
      else setLegalDoc(null);
    } catch {
      toast.error(t('settings:view.feedbackSendError'), { description: t('common:toast.genericError') });
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  // One Bevel-style row for the mobile grouped root. Presentation only.
  const mobileRow = ({
    icon: Icon,
    label,
    description,
    onClick,
    danger,
  }: {
    icon: LucideIcon;
    label: string;
    description?: string;
    onClick: () => void;
    danger?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[56px] w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-secondary/50"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div
          className={
            danger
              ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10'
              : PROFILE_ROW_ICON_CHIP_CLASS
          }
        >
          <Icon className={danger ? 'h-5 w-5 text-destructive' : PROFILE_ROW_ICON_CLASS} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-sm font-medium', danger ? 'text-destructive' : 'text-foreground')}>{label}</p>
          {description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );

  const mobileRoot = rawSection || mobileDoc;

  return (
    <div className={cn('animate-fade-in bg-background', isMobile ? 'pb-4' : 'min-h-screen pb-24 md:pb-28 px-4 pt-4 md:px-8 lg:px-10')}>
      {/* Desktop: left-anchored, wide panel (was `mx-auto max-w-3xl`, a narrow
          column floating in the middle of the page). Anchoring left and widening
          to 6xl lets each section fill the space next to the sidebar and gives
          room for the two-column section bodies below. Single-column sections
          (forms/logs) cap their own width for readability - see max-w-3xl below. */}
      <div className={isMobile ? '' : 'w-full max-w-6xl'}>
        <div className="space-y-6">
          {/* Root chrome (title + search): desktop always; mobile only on the
              grouped root. A mobile detail (section/doc) hides it — the sheet's
              pinned top-left X is the sole affordance there. */}
          {(!isMobile || !mobileRoot) && (
            <>
              <h1 className="font-display text-2xl font-bold text-foreground">{t('settings:view.title')}</h1>
              {/* Search is desktop-only. On mobile the sheet is a short grouped
                  list where scanning beats searching, so we omit the field. Desktop
                  shares this top row with the floating top-right pill
                  (AppShellTopRight, fixed right-4). Reserve its width so the search
                  field never slides under it once the page sits flush to the top. */}
              {!isMobile && (
                <div className="md:pr-44">
                  <SettingsSearch sleek={!isMobile} isAdmin={showAdminSection} isSuperAdmin={isSuperAdmin} onNavigate={handleSearchNavigate} />
                </div>
              )}
            </>
          )}

          {/* ========== MOBILE GROUPED ROOT (Bevel-style single page) ========== */}
          {isMobile && !mobileRoot && (
            <div className="space-y-6">
              <SettingsCardGroup label={t('settings:view.groups.account')}>
                {mobileRow({ icon: UserCircle, label: t('settings:sections.profile.label'), onClick: () => openMobileSection('profile') })}
                {mobileRow({ icon: User, label: t('settings:sections.account.label'), onClick: () => openMobileSection('account') })}
                {mobileRow({ icon: ShieldCheck, label: t('settings:sections.security.label'), onClick: () => openMobileSection('security') })}
              </SettingsCardGroup>

              <SettingsCardGroup label={t('settings:view.groups.preferences')}>
                {mobileRow({ icon: Palette, label: t('settings:sections.appearance.label'), onClick: () => openMobileSection('appearance') })}
                {mobileRow({ icon: Bell, label: t('settings:sections.notifications.label'), onClick: () => openMobileSection('notifications') })}
                {mobileRow({ icon: Ban, label: t('settings:sections.privacy.label'), onClick: () => openMobileSection('privacy') })}
              </SettingsCardGroup>

              <SettingsCardGroup label={t('settings:view.groups.support')}>
                {/* No sub-descriptions here: every other group on this root is a
                    bare label + chevron, and Support was the lone exception. */}
                {mobileRow({ icon: ShieldCheck, label: t('settings:support.safety.title'), onClick: () => openMobileDoc('safety') })}
                {mobileRow({ icon: MessageSquare, label: t('settings:support.feedback.title'), onClick: () => openMobileDoc('feedback') })}
                {mobileRow({ icon: Compass, label: t('settings:support.replayTour.title'), onClick: () => { restartTour(); navigate('/my-home'); } })}
              </SettingsCardGroup>

              <SettingsCardGroup label={t('settings:view.groups.aboutLegal')}>
                {mobileRow({ icon: Users, label: t('settings:support.guidelines.title'), onClick: () => openMobileDoc('guidelines') })}
                {mobileRow({ icon: FileText, label: t('settings:support.terms.title'), onClick: () => openMobileDoc('terms') })}
                {mobileRow({ icon: FileText, label: t('settings:view.privacyPolicy'), onClick: () => openMobileDoc('privacy') })}
                {mobileRow({ icon: ScrollText, label: t('settings:support.licenses.title'), onClick: () => openMobileDoc('licenses') })}
              </SettingsCardGroup>

              {showAdminSection && (
                <SettingsCardGroup label={t('settings:view.groups.admin')}>
                  {mobileRow({ icon: Wrench, label: t('settings:sections.admin.label'), onClick: () => openMobileSection('admin') })}
                </SettingsCardGroup>
              )}

              <SettingsCardGroup label={t('settings:view.groups.dangerZone')} divided={false}>
                {mobileRow({ icon: Trash2, danger: true, label: t('settings:sections.danger.label'), onClick: () => openMobileSection('danger') })}
              </SettingsCardGroup>

              <p className="px-1 text-xs text-muted-foreground">{t('settings:view.version', { version: '1.0.4' })}</p>
            </div>
          )}

          {/* Section / doc panel: desktop renders it inline; mobile renders it in
              place of the grouped root (same single sheet, no second overlay). */}
          {(() => {
          // Legal docs are URL-driven on mobile (`?doc=`), local state on desktop.
          const docId = isMobile ? mobileDoc : legalDoc;
          const sectionPanel = docId ? (
            /* Inline legal/support doc - renders in place of the section panel so
               the user stays inside the Settings surface (no overlay, no hop to a
               standalone marketing page). On mobile the sheet's pinned X is the
               back affordance; desktop keeps an inline back chevron. */
            <div className="space-y-2">
              {!isMobile && (
                <button
                  type="button"
                  onClick={() => setLegalDoc(null)}
                  className="-ml-1 inline-flex min-h-[44px] items-center gap-1 rounded-lg px-1 pr-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden />
                  {activeSectionLabel || t('common:actions.back')}
                </button>
              )}
              <div className="max-w-3xl px-1 py-2">
                {docId === 'safety' && <SafetyCenterContent />}
                {docId === 'guidelines' && <ModerationContent />}
                {docId === 'terms' && <TermsContent />}
                {docId === 'privacy' && <PrivacyContent />}
                {docId === 'licenses' && <LicensesContent />}
                {docId === 'feedback' && (
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <h2 className="font-display text-xl font-bold text-foreground">
                        {t('settings:view.feedbackDialogTitle')}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {t('settings:view.feedbackDialogDescription')}
                      </p>
                    </div>
                    <Textarea
                      placeholder={t('settings:view.feedbackPlaceholder')}
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      className="min-h-[140px] max-h-[45vh] resize-none border-malachite-600/50 focus-visible:ring-malachite-600"
                    />
                    {/* Submit only - the sheet's pinned X (mobile) / back chevron
                        (desktop) is the single way out, same as every other doc. */}
                    <Button
                      onClick={handleFeedbackSubmit}
                      disabled={!feedbackText.trim() || isSubmittingFeedback}
                      variant="default"
                      className="w-full sm:w-auto"
                    >
                      {isSubmittingFeedback ? t('settings:view.sending') : t('common:actions.submit')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
          <>
          {/* ========== PROFILE ========== */}
          {activeSection === 'profile' && (
          <section id="settings-profile" aria-label="Profile" className="scroll-mt-24 max-w-3xl">
            <SettingsProfile />
          </section>
          )}

          {/* ========== ACCOUNT ========== */}
          {activeSection === 'account' && (
          <section id="settings-account" aria-label={t('settings:sections.account.label')} className="scroll-mt-24">
            <div className="space-y-6">
              <SettingsSectionHeader
                icon={User}
                title={t('settings:sections.account.label')}
                description={t('settings:headers.account.description')}
              />
              <SettingsSectionBody>
                <SettingsAccount />
                <SettingsCardGroup flat label={t('settings:view.groups.signIn')}>
                  <button
                    onClick={() => setShowAccountDialog(true)}
                    className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                        <KeyRound className={PROFILE_ROW_ICON_CLASS} />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="font-medium text-sm leading-tight text-foreground">{t('common:actions.password')}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{t('settings:view.passwordDescription')}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </button>
                  <SettingsConnectedAccounts />
                </SettingsCardGroup>
                <SettingsCardGroup flat divided={false}>
                  <button
                    onClick={handleSignOut}
                    disabled={isSigningOut}
                    className="w-full flex items-center gap-3 p-4 min-h-[48px] hover:bg-secondary/50 transition-colors disabled:opacity-50"
                  >
                    <div className={PROFILE_SIGN_OUT_ICON_CHIP_CLASS}>
                      {isSigningOut ? (
                        <div className="w-5 h-5 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <LogOut className={PROFILE_SIGN_OUT_ICON_CLASS} />
                      )}
                    </div>
                    <span className="font-medium text-sm text-foreground flex-1 text-left">
                      {isSigningOut ? t('settings:view.signingOut') : t('common:actions.signOut')}
                    </span>
                  </button>
                </SettingsCardGroup>
              </SettingsSectionBody>
            </div>
          </section>
          )}

          {/* ========== SECURITY ========== */}
          {activeSection === 'security' && (
          <section id="settings-security" aria-label="Security" className="scroll-mt-24 max-w-3xl">
            <SettingsSecurity />
          </section>
          )}

          {/* ========== APPEARANCE ========== */}
          {activeSection === 'appearance' && (
          <section id="settings-appearance" aria-label={t('settings:sections.appearance.label')} className="scroll-mt-24">
            <div className="space-y-6">
              <SettingsSectionHeader
                icon={Palette}
                title={t('settings:sections.appearance.label')}
                description={t('settings:headers.appearance.description')}
              />
              <SettingsSectionBody>
                <SettingsCardGroup label={t('settings:appearance.theme.title')} divided={false} className="p-4 space-y-3">
                  <p className="text-xs text-muted-foreground leading-snug">
                    {t('settings:view.systemThemeDescription')}
                  </p>
                  <ThemeToggleGroup className="max-w-sm" />
                </SettingsCardGroup>
                <SettingsAppearanceA11y />
                {showLanguagePicker && (
                  <SettingsCardGroup divided={false} className="p-4">
                    <SettingsLanguage />
                  </SettingsCardGroup>
                )}
              </SettingsSectionBody>
            </div>
          </section>
          )}

          {/* ========== NOTIFICATIONS ========== */}
          {activeSection === 'notifications' && (
          <section id="settings-notifications" aria-label="Notifications" className="scroll-mt-24">
            <SettingsNotifications />
          </section>
          )}

          {/* ========== PRIVACY ========== */}
          {activeSection === 'privacy' && (
          <section id="settings-privacy" aria-label={t('settings:sections.privacy.label')} className="scroll-mt-24">
            <div className="space-y-6">
              <SettingsSectionHeader
                icon={Ban}
                title={t('settings:sections.privacy.label')}
                description={t('settings:headers.privacy.description')}
              />
              <SettingsSectionBody>
                <SettingsCardGroup label={t('settings:view.groups.messagingDiscovery')}>
                  <SettingsPrivacyControls />
                </SettingsCardGroup>
                <SettingsPrivacyData />
                <SettingsCardGroup label={t('settings:view.groups.more')}>
                  <Link
                    to="/profile/blocked"
                    className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                        <Ban className={PROFILE_ROW_ICON_CLASS} />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="font-medium text-sm leading-tight text-foreground">{t('settings:view.blockedAccounts')}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
                          {t('settings:view.blockedAccountsDescription')}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </Link>
                  <button
                    type="button"
                    onClick={() => openDoc('privacy')}
                    className="w-full flex items-center gap-3 p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                      <FileText className={PROFILE_ROW_ICON_CLASS} />
                    </div>
                    <p className="font-medium text-sm text-foreground flex-1 text-left">{t('settings:view.privacyPolicy')}</p>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </button>
                </SettingsCardGroup>
              </SettingsSectionBody>
            </div>
          </section>
          )}

          {/* ========== SUPPORT & LEGAL ========== */}
          {activeSection === 'support' && (
          <section id="settings-support" aria-label={t('settings:sections.support.label')} className="scroll-mt-24">
            <div className="space-y-6">
              <SettingsSectionHeader
                icon={LifeBuoy}
                title={t('settings:sections.support.label')}
                description={t('settings:headers.support.description')}
              />
              <SettingsSectionBody>
                <SettingsCardGroup label={t('settings:view.groups.help')}>
                  <button
                    type="button"
                    onClick={() => openDoc('safety')}
                    className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                        <ShieldCheck className={PROFILE_ROW_ICON_CLASS} />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="font-medium text-sm leading-tight text-foreground">{t('settings:support.safety.title')}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
                          {t('settings:support.safety.description')}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openDoc('feedback')}
                    className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                        <MessageSquare className={PROFILE_ROW_ICON_CLASS} />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="font-medium text-sm leading-tight text-foreground">{t('settings:support.feedback.title')}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{t('settings:support.feedback.description')}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      restartTour();
                      navigate('/my-home');
                    }}
                    className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                        <Compass className={PROFILE_ROW_ICON_CLASS} />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="font-medium text-sm leading-tight text-foreground">{t('settings:support.replayTour.title')}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{t('settings:support.replayTour.description')}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </button>
                </SettingsCardGroup>
                <SettingsCardGroup label={t('settings:view.groups.aboutLegal')}>
                  <button
                    type="button"
                    onClick={() => openDoc('guidelines')}
                    className="w-full flex items-center gap-3 p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                      <Users className={PROFILE_ROW_ICON_CLASS} />
                    </div>
                    <p className="font-medium text-sm text-foreground flex-1 text-left">{t('settings:support.guidelines.title')}</p>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openDoc('terms')}
                    className="w-full flex items-center gap-3 p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                      <FileText className={PROFILE_ROW_ICON_CLASS} />
                    </div>
                    <p className="font-medium text-sm text-foreground flex-1 text-left">{t('settings:support.terms.title')}</p>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openDoc('privacy')}
                    className="w-full flex items-center gap-3 p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                      <FileText className={PROFILE_ROW_ICON_CLASS} />
                    </div>
                    <p className="font-medium text-sm text-foreground flex-1 text-left">{t('settings:view.privacyPolicy')}</p>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openDoc('licenses')}
                    className="w-full flex items-center gap-3 p-4 hover:bg-secondary/50 transition-colors"
                  >
                    <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                      <ScrollText className={PROFILE_ROW_ICON_CLASS} />
                    </div>
                    <p className="font-medium text-sm text-foreground flex-1 text-left">{t('settings:support.licenses.title')}</p>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </button>
                </SettingsCardGroup>
                {/* TODO (R6 deferral): a "What's new" / changelog row belongs here, but
                    there is no user-facing release-notes surface in-app yet. RELEASES.md is
                    curated but not routed/rendered, and docs/CHANGELOG.md is raw dev history
                    that must not be shown to students. Add this row once a real /whats-new
                    (or equivalent) page ships - do not link a dead or dev-facing target. */}
                <p className="px-1 text-xs text-muted-foreground">{t('settings:view.version', { version: '1.0.4' })}</p>
              </SettingsSectionBody>
            </div>
          </section>
          )}

          {/* ========== ADMIN ========== */}
          {showAdminSection && activeSection === 'admin' && (
            <section id="settings-admin" aria-label={t('settings:sections.admin.label')} className="scroll-mt-24">
              <div className="space-y-6">
                <SettingsSectionHeader
                  icon={Wrench}
                  title={t('settings:sections.admin.label')}
                  description={t('settings:headers.admin.description')}
                />
                <SettingsSectionBody>
                  {/* Preview/dev tools + Setup Mode are platform (superadmin) controls -
                      never shown to university_admins, who keep only the Admin Panel link. */}
                  {isSuperAdmin && (
                  <SettingsCardGroup label={t('settings:view.groups.preview')}>
                    <div className="w-full flex items-center justify-between p-4">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                          <Settings2 className={PROFILE_ROW_ICON_CLASS} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm leading-tight text-foreground">{t('settings:admin.preview.title')}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{t('settings:admin.preview.description')}</p>
                        </div>
                      </div>
                      <Switch
                        aria-label={t('settings:admin.preview.title')}
                        checked={fullAppPreview}
                        onCheckedChange={setFullAppPreview}
                        className="data-[state=checked]:bg-malachite-600"
                      />
                    </div>
                    <div className="w-full flex items-center justify-between p-4">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                          <Settings2 className={PROFILE_ROW_ICON_CLASS} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm leading-tight text-foreground">{t('settings:admin.setup.title')}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{t('settings:admin.setup.description')}</p>
                        </div>
                      </div>
                      <Switch
                        aria-label={t('settings:admin.setup.title')}
                        checked={setupModeEnabled}
                        onCheckedChange={setSetupModeEnabled}
                        className="data-[state=checked]:bg-malachite-600"
                      />
                    </div>
                  </SettingsCardGroup>
                  )}
                  <SettingsCardGroup label={t('settings:view.groups.tools')}>
                    {isSuperAdmin && (
                    <button
                      onClick={() => navigate('/onboarding/intro')}
                      className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                          <RotateCcw className={PROFILE_ROW_ICON_CLASS} />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="font-medium text-sm leading-tight text-foreground">{t('settings:admin.replay.title')}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{t('settings:admin.replay.description')}</p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                    </button>
                    )}
                    {/* Admin console routes don't mount natively - web only. */}
                    {!Capacitor.isNativePlatform() && (
                    <button
                      onClick={() => navigate('/admin')}
                      className="w-full flex items-center justify-between p-4 hover:bg-secondary/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={PROFILE_ROW_ICON_CHIP_CLASS}>
                          <ShieldCheck className={PROFILE_ROW_ICON_CLASS} />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="font-medium text-sm leading-tight text-foreground">{t('settings:admin.panel.title')}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{t('settings:admin.panel.description')}</p>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                    </button>
                    )}
                  </SettingsCardGroup>
                </SettingsSectionBody>
              </div>
            </section>
          )}

          {/* ========== DANGER ZONE ========== */}
          {activeSection === 'danger' && (
          <section id="settings-danger" aria-label={t('settings:sections.danger.label')} className="scroll-mt-24 max-w-3xl">
            <div className="space-y-6">
              <SettingsSectionHeader
                icon={Trash2}
                title={t('settings:sections.danger.label')}
                description={t('settings:headers.danger.description')}
                tone="destructive"
              />
              <div>
                <SettingsCardGroup divided={false}>
                  <button
                    onClick={() => setShowDeleteAccountDialog(true)}
                    className="w-full flex items-center justify-between p-4 hover:bg-destructive/5 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                        <Trash2 className="w-5 h-5 text-destructive" />
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="font-medium text-sm leading-tight text-destructive">{t('settings:danger.delete.title')}</p>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  </button>
                </SettingsCardGroup>
              </div>
            </div>
          </section>
          )}
          </>
          );

          // Mobile root shows the grouped list above; render the panel only when
          // drilled into a section or doc. Desktop always renders the panel.
          if (isMobile && !mobileRoot) return null;
          return sectionPanel;
          })()}
        </div>
      </div>

      {/* Account Dialog */}
      <Dialog open={showAccountDialog} onOpenChange={setShowAccountDialog}>
        <DialogContent className={PROFILE_DIALOG_CONTENT_CLASS}>
          <DialogHeader className={PROFILE_DIALOG_HEADER_CLASS}>
            <DialogTitle>{t('settings:view.accountDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings:view.accountDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className={PROFILE_DIALOG_BODY_CLASS}>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">{t('common:fields.email')}</Label>
              <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2.5 font-mono break-all">
                {user?.email ?? ' - '}
              </p>
            </div>
            <div className="space-y-2 pt-2 border-t border-border">
              <Label className="text-sm font-medium text-foreground">{t('settings:view.changePasswordLabel')}</Label>
              <p className="text-xs text-muted-foreground mb-2">
                {t('settings:view.changePasswordExplanation')}
              </p>
              <TurnstileWidget
                ref={turnstile.ref}
                onToken={turnstile.setToken}
                theme="auto"
                action="password-reset"
                className="mb-2"
              />
              <Button
                variant="outline"
                onClick={handleChangePassword}
                disabled={isResettingPassword || !turnstile.ready}
                className="border-malachite-600/50 text-malachite-800 hover:bg-malachite-600/10 hover:border-malachite-600"
              >
                {isResettingPassword ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                {t('settings:view.sendResetLink')}
              </Button>
            </div>
            <div className="space-y-2 pt-2 border-t border-border">
              <h3 className="font-semibold text-foreground text-sm">{t('settings:view.accountSecurityLabel')}</h3>
              <p className="text-xs text-muted-foreground mb-2">
                {t('settings:view.manualPasswordExplanation')}
              </p>
              <Input
                type="password"
                placeholder={t('common:placeholders.newPassword')}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-10"
                autoComplete="new-password"
              />
              <Button
                variant="outline"
                onClick={handleSetPassword}
                disabled={!newPassword.trim() || isSettingPassword}
                className="border-malachite-600/50 text-malachite-800 hover:bg-malachite-600/10 hover:border-malachite-600"
              >
                {isSettingPassword ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                {t('settings:view.setManualPassword')}
              </Button>
            </div>
          </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Feedback renders as an inline `?doc=feedback` panel (see the doc branch
          above), not as its own full-screen Dialog - one sheet, one X. */}

      {/* Support & Legal docs render inline inside the support section (see the
          `legalDoc ?` branch above) so the links never open an overlay or drag the
          user out of the Settings surface. Same content as the /moderation, /terms,
          /licenses routes; for Safety this is now the ONLY home (the /safety route
          was removed - PRD §5b), reachable at SAFETY_CENTER_PATH. */}

      {/* Delete Account Dialog */}
      <Dialog
        open={showDeleteAccountDialog}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteAccountVerification('');
          }
          setShowDeleteAccountDialog(open);
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('settings:danger.deleteDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings:danger.deleteCannotUndo')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive space-y-2">
              <p className="font-medium">{t('settings:danger.whatWillBeDeleted')}</p>
              <ul className="list-disc list-inside space-y-0.5 text-destructive/90">
                <li>{t('settings:danger.deleteItem1')}</li>
                <li>{t('settings:danger.deleteItem2')}</li>
                <li>{t('settings:danger.deleteItem3')}</li>
                <li>{t('settings:danger.deleteItem4')}</li>
                <li>{t('settings:danger.deleteItem5')}</li>
              </ul>
              <p className="font-medium pt-2">{t('settings:danger.whatWillBeKept')}</p>
              <ul className="list-disc list-inside space-y-0.5 text-destructive/90">
                <li>{t('settings:danger.keepItem1', { school: university.shortName })}</li>
                <li>{t('settings:danger.keepItem2', { school: university.shortName })}</li>
              </ul>
            </div>
            <div>
              <Label htmlFor="delete-verification">
                {t('settings:danger.typeDeleteConfirm')}
              </Label>
              <Input
                id="delete-verification"
                value={deleteAccountVerification}
                onChange={(e) => setDeleteAccountVerification(e.target.value)}
                placeholder="DELETE"
                className="mt-2 font-mono"
                disabled={isDeletingAccount}
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteAccountDialog(false)}
              disabled={isDeletingAccount}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={deleteAccountVerification !== 'DELETE' || isDeletingAccount}
            >
              {isDeletingAccount ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                t('settings:danger.deleteAccountButton')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SettingsView;
