import { supabase } from '@/integrations/supabase/client';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import {
  buildPasswordResetRedirectTo,
  buildSignupEmailRedirectTo,
  getPostLoginRedirect,
  parseSafeRedirectParam,
} from '@/lib/authRedirects';
import { enforceUniversityEmailOrSignOut, gateUniversityEmail, isAllowedEmail } from '@/lib/universityAuth';
import { DEFAULT_UNIVERSITY, primaryEmailDomain, isActiveUniversityEmail, isEduEmail, resolveUniversityByEmail } from '@/config/universities';
import type { AuthMethod, University } from '@/config/universities';
import {
  resolveSelectedUniversity,
  persistSelectedUniversity,
  clearPersistedUniversity,
} from '@/lib/selectedUniversity';
import {
  getLastAuthMethod,
  setLastAuthMethod,
  toAuthMethod,
  lastMethodLabel,
  isOAuthMethod,
  type LastAuthMethod,
} from '@/lib/lastAuthMethod';
import { WaitlistCard } from '@/components/auth/WaitlistCard';
import { TurnstileWidget } from '@/components/auth/TurnstileWidget';
import { useTurnstile, isCaptchaError, CAPTCHA_ERROR_MESSAGE } from '@/hooks/useTurnstile';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';
import { isPasswordValid, mapPasswordPolicyServerError, PASSWORD_MIN_LENGTH } from '@/lib/passwordPolicy';
import { resolveSchoolByDomain, type ResolvedSchool } from '@/lib/waitlist';
import {
  resolveAuthMethods,
  deriveShellSignInStage,
  visibleSsoMethodsFor,
} from '@/lib/authMethods';
import { useNativeAuthCanvas } from '@/hooks/useNativeAuthCanvas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { fieldErrorProps, firstUnmetRequirement, useErrorReveal } from '@/lib/formCraft';
import { FieldError, SubmitBlockedReason } from '@/components/ui/field-error';
import { SHOW_HOUSING, SHOW_ROOMMATES } from '@/lib/featureFlags';
import { motion } from 'framer-motion';
import { useTranslation, Trans } from 'react-i18next';
import i18n from '@/i18n';

// Derive a human-readable message from a Supabase auth error and log the full
// object. Guards against the opaque "{}" case: @supabase/auth-js surfaces a
// message of "{}" (JSON.stringify of an empty body) when the auth endpoint
// returns an error status with no parseable body, or a transport/unknown
// failure. Without this, the error box renders a bare "{}" and the real cause
// (status/code) is lost.
function describeAuthError(error: unknown): string {
  console.error('[auth]', error);
  const e = error as { message?: string; status?: number; name?: string; code?: string };
  const msg = e?.message?.trim();
  if (msg && msg !== '{}') return msg;
  const status = e?.status ? ` (status ${e.status})` : '';
  return i18n.t('auth:errors.unreachable', { status });
}

/**
 * T3.6: Auth's inline text actions ("not your school?", "start over", the
 * sign-in/sign-up switch) compose <Button variant="link"> for the shared focus
 * ring and disabled handling, but they sit INSIDE running prose — so the button
 * BOX is stripped back to a text run and each site keeps its own colour/weight
 * via className (tailwind-merge resolves the conflicts). Shell only: the
 * @pitt.edu enforcement in this file is untouched.
 */
const inlineTextButtonClass = 'h-auto p-0 align-baseline';

// TODO: Consolidate platform fork. iOS native branch and web branch have
// duplicate JSX that drifts. Plan: extract shared components OR remove
// the fork entirely and use Tailwind responsive classes. See v1.1 backlog.
const AuthPage = () => {
  const isNative = Capacitor.isNativePlatform();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isLoading: isAuthLoading } = useAuth();
  const hasRedirected = useRef(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);
  const [emailToResend, setEmailToResend] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  // App Store 1.2 (UGC): the reviewer must be able to SEE the terms being
  // agreed to, so this is a required checkbox on the sign-up path rather than
  // the passive Terms link that was here before. Resets whenever the user
  // leaves sign-up, so returning to it re-asks rather than remembering consent.
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  // Two-step identifier-first flow. Start by collecting the email ('identify');
  // once we know the account's methods, reveal the password field ('password'),
  // switch to account creation ('signup'), or push an OAuth-only account to its
  // provider ('oauth-only'). Fails open to the password field on any lookup error.
  const [signInStage, setSignInStage] = useState<
    'identify' | 'password' | 'oauth-only' | 'oauth-unavailable' | 'signup'
  >('identify');
  const [stageOAuthMethod, setStageOAuthMethod] = useState<AuthMethod | null>(null);
  const [isResolvingMethods, setIsResolvingMethods] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [showUpdatePassword, setShowUpdatePassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const [isMicrosoftSigningIn, setIsMicrosoftSigningIn] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [isVerifyingCode, setIsVerifyingCode] = useState(false);

  const [showWaitlist, setShowWaitlist] = useState(false);

  // "Last used" login hint (device-local, Wispr-style). Read once on mount;
  // "Use a different method" dismisses it for this visit only (storage untouched).
  const [lastMethod] = useState<LastAuthMethod | null>(() => getLastAuthMethod());
  const [hintDismissed] = useState(false);

  // Identifier-first school resolution. Pre-resolution the card is
  // school-neutral (email field only); once the typed email resolves to an
  // active school, that school's providers, domain hint, and light branding
  // appear. `?school=` / persisted choice still resolve instantly for
  // returning users; a typed email always wins over the persisted school.
  const schoolParam = searchParams.get('school');
  const selectedUniversity = useMemo(
    () => resolveSelectedUniversity(schoolParam),
    [schoolParam],
  );
  const [emailResolvedUniversity, setEmailResolvedUniversity] = useState<University | null>(null);
  const [selectionCleared, setSelectionCleared] = useState(false);
  // Directory match for non-active .edu domains ("Looks like you're at {school}").
  // Naming only - never authorizes sign-in; nulls fall back to the generic waitlist.
  const [resolvedSchool, setResolvedSchool] = useState<ResolvedSchool | null>(null);

  // Cloudflare Turnstile token lifecycle. One instance covers every
  // captcha-protected action on this page (signUp, signInWithPassword,
  // resetPasswordForEmail, resend); only one such form is mounted at a time.
  // When VITE_TURNSTILE_SITE_KEY is unset, `turnstile.ready` is always true and
  // no widget renders, so flows work until Ethan enables Supabase enforcement.
  const turnstile = useTurnstile();

  const resolvedUniversity =
    emailResolvedUniversity ?? (selectionCleared ? null : selectedUniversity);
  const isSchoolResolved = resolvedUniversity !== null;
  // Fallback keeps the email gates/domain hint well-defined pre-resolution;
  // nothing school-specific renders until isSchoolResolved.
  const authUniversity = resolvedUniversity ?? DEFAULT_UNIVERSITY;
  const emailDomain = primaryEmailDomain(authUniversity);
  const authMethods = authUniversity.authMethods;
  // Which SSO buttons THIS shell may render. iOS shows none (App Store 4.8 -
  // build 30 was rejected for offering Google with no privacy-preserving
  // equivalent, so we take the own-account-system-exclusively exemption);
  // Android hides Microsoft; web keeps everything. Do NOT "fix" the missing
  // Google button on iOS - the reasoning lives with the rule, in
  // `visibleSsoMethodsFor`.
  const visibleSsoMethods = useMemo(
    () => visibleSsoMethodsFor(authMethods, Capacitor.getPlatform()),
    [authMethods],
  );
  const hasSsoProvider = isSchoolResolved && visibleSsoMethods.length > 0;

  // Debounced resolve-by-email: waits for a complete address, then matches it
  // against every active school. Persists on success so the next visit brands
  // immediately.
  useEffect(() => {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailResolvedUniversity(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const resolved = resolveUniversityByEmail(trimmed);
      setEmailResolvedUniversity(resolved ?? null);
      if (resolved) {
        persistSelectedUniversity(resolved.slug);
        setSelectionCleared(false);
        setResolvedSchool(null);
        return;
      }
      // Active-tenant miss on a .edu address: ask the directory which school
      // this is, so the waitlist branch can name it. Best-effort - null keeps
      // the generic waitlist card.
      if (isEduEmail(trimmed)) {
        void resolveSchoolByDomain(trimmed.split('@')[1]).then((school) => {
          if (!cancelled) setResolvedSchool(school);
        });
      } else {
        setResolvedSchool(null);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [email]);

  const isValidUniversityEmail = isAllowedEmail(email, authUniversity);
  const isValidEmailFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  // ── Form UX craft (IPP-3) ──────────────────────────────────────────────────
  // Reveal-on-blur-or-submit. This screen is the top of the funnel, so the two
  // failure modes both mattered: nagging someone mid-typing ("that's not an
  // email" on character three), and the dead disabled button that never says
  // what it wants. `reveal` answers only WHEN; the message below is derived from
  // the current value, so it clears the moment the address is fixed.
  const reveal = useErrorReveal();
  const emailError =
    reveal.shouldReveal('email') && email.trim().length > 0 && !isValidEmailFormat
      ? t('common:form.emailInvalid')
      : null;
  // The reason the submit is disabled, in field order. Turnstile last: it
  // resolves on its own and is the one item the user cannot act on.
  // An EMPTY email is not a "reason" worth printing: the placeholder already says
  // you@school.edu, so "Enter your school email to continue." under the button was
  // restating the field for everyone who hadn't typed yet. The list starts at the
  // first requirement that can only be explained in words.
  const submitBlockedReason = firstUnmetRequirement([
    { met: isValidEmailFormat, reason: t('common:form.emailInvalid') },
    { met: isValidUniversityEmail, reason: t('auth:blocked.schoolEmail') },
    {
      met: signInStage === 'identify' || password.length > 0,
      reason: t('auth:blocked.password'),
    },
    {
      met: !isSignUp || confirmPassword.length > 0,
      reason: t('auth:blocked.confirmPassword'),
    },
    // App Store 1.2: agreeing to the EULA must be an explicit act on the
    // sign-up path, not a passive "by continuing you agree" line.
    {
      met: !isSignUp || agreedToTerms,
      reason: t('auth:blocked.terms'),
    },
    {
      met: !(signInStage === 'password' || signInStage === 'signup') || turnstile.ready,
      reason: t('auth:blocked.captcha'),
    },
  ]);
  // WHEN that reason is allowed to show. Same gate as the field errors — the
  // reveal hook already means "email blurred once, or a submit was attempted" —
  // so the block under the button is empty on a screen nobody has touched yet.
  // Also requires a non-empty value: blurring past an untouched field is not a
  // mistake, and "Enter a valid email address" on a blank input reads as scolding.
  const submitBlockedVisible = reveal.shouldReveal('email') && email.trim().length > 0;
  // Waitlist is students-only: a valid .edu that isn't an active university
  // routes there instead of the signup dead-end. Non-.edu addresses get the
  // "use your school email" message instead.
  const showWaitlistOption = isValidEmailFormat && isEduEmail(email) && !isActiveUniversityEmail(email);

  // The last-used method only surfaces once a school is resolved and that
  // school actually offers it.
  const activeHint = useMemo(() => {
    if (!isSchoolResolved || !lastMethod || hintDismissed) return null;
    const mapped = toAuthMethod(lastMethod);
    if (!authMethods.includes(mapped)) return null;
    // Never point at a button this shell doesn't render (iOS hides Google per
    // 4.8) - a "last used: Google" nudge with no Google button is worse than no
    // nudge at all.
    if (mapped !== 'email' && !visibleSsoMethods.includes(mapped)) return null;
    return {
      method: lastMethod,
      mapped,
      label: lastMethodLabel(lastMethod),
      isOAuth: isOAuthMethod(lastMethod),
    };
  }, [isSchoolResolved, lastMethod, hintDismissed, authMethods, visibleSsoMethods]);

  // Subtle brand ring on whichever control we want to steer the user toward:
  // the OAuth-only stage's provider takes priority, else the last-used method.
  const emphasizedMethod =
    signInStage === 'oauth-only' ? stageOAuthMethod : (activeHint?.mapped ?? null);
  const ringFor = (m: AuthMethod) =>
    emphasizedMethod === m ? 'ring-2 ring-malachite-600 ring-offset-2' : '';

  const oauthLabel = (m: AuthMethod) =>
    m === 'google'
      ? 'Google'
      : m === 'microsoft'
        ? 'Microsoft'
        : m === 'saml'
          ? t('auth:oauthLabel.saml')
          : t('auth:oauthLabel.email');

  const lastUsedBadge = (
    <span className="ml-2 rounded-full bg-malachite-50 px-2 py-0.5 text-xs font-semibold text-malachite-800">
      {t('auth:badges.lastUsed')}
    </span>
  );

  // Light school branding once resolved: name + accent, nothing more.
  const schoolBanner = () =>
    resolvedUniversity ? (
      <div role="status" className="mb-4 text-center">
        <p className="text-sm font-medium text-foreground">
          {t('auth:schoolBanner.continueTo', { name: resolvedUniversity.name })}
        </p>
        <Button
          type="button"
          variant="link"
          onClick={() => {
            clearPersistedUniversity();
            setEmailResolvedUniversity(null);
            setSelectionCleared(true);
            setEmail('');
          }}
          className={`${inlineTextButtonClass} mt-1 text-xs font-normal text-muted-foreground underline underline-offset-2 hover:text-foreground`}
        >
          {t('auth:schoolBanner.notYourSchool')}
        </Button>
      </div>
    ) : null;

  // Listen for password recovery (user clicked reset link in email)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowUpdatePassword(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Native: white canvas + no overscroll bounce while the auth screen is mounted.
  useNativeAuthCanvas();

  // If user landed with recovery hash (e.g. from reset link), show update password form
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && (hash.includes('type=recovery') || hash.includes('recovery'))) {
      setShowUpdatePassword(true);
    }
  }, []);

  // State sync: if user exists in auth context, redirect after university-email verification
  useEffect(() => {
    if (!user || hasRedirected.current || showUpdatePassword) return;

    void (async () => {
      // Gate against the school the session email actually belongs to, not the
      // pre-typed selection — a resolved-by-email mismatch means sign out.
      const sessionUniversity = resolveUniversityByEmail(user.email) ?? authUniversity;
      const gate = await gateUniversityEmail(user.email, sessionUniversity);
      if (gate === 'rejected') {
        return;
      }
      hasRedirected.current = true;
      const go = (target: string) => navigate(target, { replace: true });
      if (gate === 'advertiser') {
        // Invite-gated business account (P1.10): web-only advertiser zone.
        if (isNative) {
          toast.error(t('auth:toast.advertiserWebOnly'));
          await supabase.auth.signOut();
          hasRedirected.current = false;
          return;
        }
        go('/advertise');
        return;
      }
      const safeRedirect = parseSafeRedirectParam(searchParams.get('redirect'));
      if (safeRedirect) {
        go(safeRedirect);
      } else if (isNative) {
        go('/my-home');
      } else {
        getPostLoginRedirect(user.id).then(go);
      }
    })();
  }, [user, navigate, searchParams, showUpdatePassword, authUniversity, isNative, t]);

  const handleResendLink = async () => {
    if (!emailToResend) return;
    setIsResending(true);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: emailToResend,
      options: {
        // Match signup: land on /auth/v1/callback and preserve the destination
        // through the email round-trip.
        emailRedirectTo: buildSignupEmailRedirectTo(searchParams.get('redirect')),
        captchaToken: turnstile.captchaToken,
      },
    });
    setIsResending(false);
    turnstile.reset(); // tokens are single-use
    if (error) toast.error(isCaptchaError(error) ? CAPTCHA_ERROR_MESSAGE : error.message);
    else toast.success(t('auth:toast.confirmationResent'));
  };

  const handleVerifyCode = async () => {
    if (otpCode.length !== 6) {
      toast.error(t('auth:toast.enterCode'));
      return;
    }
    if (!emailToResend) {
      toast.error(t('auth:toast.missingEmail'));
      return;
    }
    setIsVerifyingCode(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: emailToResend,
        token: otpCode,
        type: 'email',
      });
      if (error) {
        const msg = error.message?.toLowerCase() ?? '';
        if (msg.includes('expired')) {
          toast.error(t('auth:toast.codeExpired'));
        } else if (msg.includes('invalid') || msg.includes('token')) {
          toast.error(t('auth:toast.codeIncorrect'));
        } else {
          toast.error(error.message);
        }
        setOtpCode('');
        return;
      }
      if (data?.session) {
        toast.success(t('auth:toast.welcome'));
        // onAuthStateChange listener and AuthCallback will handle navigation
      } else {
        toast.error(t('auth:toast.noSession'));
      }
    } catch (err) {
      console.error('verifyOtp threw:', err);
      toast.error(t('auth:toast.verifyError'));
    } finally {
      setIsVerifyingCode(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const resetEmail = email.trim();
    if (!isAllowedEmail(resetEmail, authUniversity)) {
      toast.error(t('auth:toast.enterSchoolEmail'));
      return;
    }
    setIsSendingReset(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: buildPasswordResetRedirectTo(),
      captchaToken: turnstile.captchaToken,
    });
    setIsSendingReset(false);
    turnstile.reset(); // tokens are single-use
    if (error) {
      toast.error(isCaptchaError(error) ? CAPTCHA_ERROR_MESSAGE : error.message);
    } else {
      toast.success(t('auth:toast.resetSent'));
      setShowForgotPassword(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword.trim()) {
      toast.error(t('auth:toast.enterNewPassword'));
      return;
    }
    setIsUpdatingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword.trim() });
    setIsUpdatingPassword(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('auth:toast.passwordUpdated'));
    setShowUpdatePassword(false);
    setNewPassword('');
    await supabase.auth.signOut();
  };

  const handleGoogleSignIn = async () => {
    const redirect = parseSafeRedirectParam(searchParams.get('redirect'));
    if (redirect) {
      try {
        sessionStorage.setItem('auth_redirect', redirect);
      } catch {
        // ignore
      }
    }

    // Native iOS/Android: use SocialLogin plugin + signInWithIdToken
    if (Capacitor.isNativePlatform()) {
      setIsGoogleSigningIn(true);
      try {
        // Android uses the Credential Manager idToken flow, which rejects any
        // `scopes` array ("You CANNOT use scopes without modifying the main
        // activity") — we only need the idToken for signInWithIdToken, so omit
        // scopes there. iOS keeps its existing scoped path unchanged.
        const result = await SocialLogin.login({
          provider: 'google',
          options:
            Capacitor.getPlatform() === 'ios'
              ? { scopes: ['profile', 'email'] }
              : {},
        });

        const googleResult = (result as { result?: { idToken?: string; profile?: { email?: string } } })
          ?.result;
        const idToken = googleResult?.idToken;
        if (!idToken) {
          toast.error(t('auth:toast.googleNoToken'));
          return;
        }

        const profileEmail = googleResult?.profile?.email;
        // Resolve the school from the Google account's email so a valid
        // student at any active school passes regardless of what was typed.
        const profileUniversity = profileEmail ? resolveUniversityByEmail(profileEmail) : undefined;
        if (profileEmail && !profileUniversity) {
          toast.error(t('auth:errors.restrictedEmail'));
          await SocialLogin.logout({ provider: 'google' }).catch(() => {});
          return;
        }

        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });
        if (error) {
          toast.error(error.message);
          return;
        }

        const sessionEmail = data.session?.user.email ?? profileEmail;
        const sessionUniversity =
          (sessionEmail ? resolveUniversityByEmail(sessionEmail) : undefined) ?? authUniversity;
        if (!(await enforceUniversityEmailOrSignOut(sessionEmail, sessionUniversity))) {
          await SocialLogin.logout({ provider: 'google' }).catch(() => {});
          return;
        }
        setLastAuthMethod('google');
        return;
      } catch (e: unknown) {
        const raw = (e as { message?: unknown } | null)?.message;
        const message = typeof raw === 'string' ? raw : t('auth:toast.googleCancelled');
        if (!message.toLowerCase().includes('cancel')) {
          toast.error(message);
        }
        return;
      } finally {
        setIsGoogleSigningIn(false);
      }
    }

    // Web fallback: existing OAuth redirect flow (unchanged). Record intent
    // before the redirect navigates the page away.
    setLastAuthMethod('google');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${import.meta.env.VITE_SITE_URL ?? window.location.origin}/auth/v1/callback`,
        queryParams: { hd: emailDomain },
      },
    });
    if (error) {
      toast.error(error.message);
    }
  };

  const handleMicrosoftSignIn = async () => {
    const redirect = searchParams.get('redirect');
    if (redirect?.startsWith('/') && !redirect.startsWith('//')) {
      try {
        sessionStorage.setItem('auth_redirect', redirect);
      } catch {
        // ignore
      }
    }

    // Microsoft always hands off (in-app browser on native, redirect on web),
    // so record intent here before we lose control of the page.
    setLastAuthMethod('microsoft');

    // Native iOS/Android: capgo has no Microsoft provider and
    // signInWithIdToken({provider:'azure'}) hits a Supabase nonce bug, so use
    // the standard native-OAuth pattern: open the auth URL in an in-app
    // browser and finish via the `com.dormcheck.ios://auth-callback` deep link
    // (PKCE `exchangeCodeForSession` in AuthDeepLinkGate, App.tsx).
    if (Capacitor.isNativePlatform()) {
      setIsMicrosoftSigningIn(true);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'azure',
        options: {
          redirectTo: 'com.dormcheck.ios://auth-callback',
          scopes: 'openid profile email',
          // Steer users to the Pitt tenant; the email gate still enforces
          // @pitt.edu regardless, so this is UX, not security.
          queryParams: { domain_hint: emailDomain },
          skipBrowserRedirect: true, // we open the URL ourselves
        },
      });
      if (error || !data?.url) {
        setIsMicrosoftSigningIn(false);
        toast.error(error?.message ?? t('auth:toast.microsoftStartFailed'));
        return;
      }
      // Reset the spinner if the user dismisses the browser without finishing
      // (harmless if auth succeeded — the deep link is navigating us away).
      const finished = await Browser.addListener('browserFinished', () => {
        setIsMicrosoftSigningIn(false);
        void finished.remove();
      });
      await Browser.open({ url: data.url, presentationStyle: 'popover' });
      return; // the appUrlOpen listener (App.tsx) finishes the flow
    }

    setIsMicrosoftSigningIn(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        redirectTo: `${import.meta.env.VITE_SITE_URL ?? window.location.origin}/auth/v1/callback`,
        scopes: 'openid profile email',
        // Steer users straight to the resolved school's tenant login. The
        // email gate still enforces the domain regardless, so this is UX,
        // not security.
        queryParams: { domain_hint: emailDomain },
      },
    });
    if (error) {
      setIsMicrosoftSigningIn(false);
      toast.error(error.message);
    }
    // On success the browser redirects away; no need to clear the flag.
  };

  const handleWebGoogleSignIn = async () => {
    setIsGoogleSigningIn(true);
    try {
      await handleGoogleSignIn();
    } finally {
      setIsGoogleSigningIn(false);
    }
  };

  const renderAuthForm = () => (
    showWaitlist ? (
      <WaitlistCard
        email={email.trim()}
        resolvedSchoolName={
          resolvedSchool && !resolvedSchool.matched_university_active ? resolvedSchool.name : null
        }
        onBack={() => setShowWaitlist(false)}
      />
    ) : showCodeInput ? (
      <div className="space-y-4">
        <div className="text-center space-y-2">
          <h2 className="font-display text-xl font-bold text-foreground">{t('auth:codeStep.title')}</h2>
          <p className="text-sm text-muted-foreground">
            <Trans
              i18nKey="auth:codeStep.sentTo"
              values={{ email: emailToResend }}
              components={{ bold: <span className="font-medium text-foreground" /> }}
            />
          </p>
        </div>

        <div className="flex justify-center py-2">
          <InputOTP
            maxLength={6}
            value={otpCode}
            onChange={setOtpCode}
            disabled={isVerifyingCode}
            pattern={REGEXP_ONLY_DIGITS}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={t('auth:codeStep.otpAriaLabel')}
          >
            <InputOTPGroup className="gap-2 sm:gap-3">
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>

        <Button
          type="button"
          className="w-full h-11 text-base font-semibold bg-malachite-800 hover:bg-malachite-900 text-white"
          disabled={isVerifyingCode || otpCode.length !== 6}
          onClick={handleVerifyCode}
        >
          {isVerifyingCode ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
          ) : (
            t('auth:actions.verify')
          )}
        </Button>

        <div className="flex flex-col items-center gap-2 text-sm">
          {/* Resend hits the captcha-protected /resend endpoint, so it needs a
              fresh token; verifying the code above does not. */}
          <TurnstileWidget
            ref={turnstile.ref}
            onToken={turnstile.setToken}
            theme="light"
            action="resend"
          />
          <Button
            type="button"
            variant="link"
            onClick={handleResendLink}
            disabled={isResending || !turnstile.ready}
            className={inlineTextButtonClass}
          >
            {isResending ? t('auth:codeStep.sending') : t('auth:codeStep.resendCode')}
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setShowCodeInput(false);
              setOtpCode('');
              setEmailToResend('');
              setIsSignUp(false);
              setAuthError(null);
            }}
            className={`${inlineTextButtonClass} font-normal text-muted-foreground hover:text-foreground`}
          >
            {t('auth:codeStep.startOver')}
          </Button>
        </div>
      </div>
    ) : (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Label htmlFor="auth-email" className="sr-only">
        {t('auth:form.emailLabel')}
      </Label>
      <Input
        id="auth-email"
        data-testid="auth-email-input"
        type="email"
        placeholder="you@school.edu"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          // Editing the email invalidates a prior lookup: drop back to the
          // identify step so a stale password can't be submitted against a
          // different account.
          if (signInStage !== 'identify') {
            setSignInStage('identify');
            setStageOAuthMethod(null);
            setPassword('');
            setConfirmPassword('');
            setConfirmError(null);
            setIsSignUp(false);
            setAuthError(null);
            setShowResend(false);
          }
        }}
        className="w-full h-11 text-base bg-card border-border focus-visible:border-malachite-600 focus-visible:ring-malachite-600"
        required
        autoComplete="email"
        inputMode="email"
        // Top of the funnel: the caret starts in the first field so signing in is
        // type-type-enter with no click.
        // IPP-3 item 5. /auth is a dedicated single-purpose route, so the a11y
        // rule's real concern (stealing focus from content the user was reading,
        // and jumping the viewport mid-page) doesn't apply. Not done on forms that
        // are only a section of a longer page.
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        {...reveal.blurProps('email')}
        {...fieldErrorProps('auth-email', emailError)}
        disabled={isSubmitting || isResolvingMethods}
      />
      <FieldError fieldId="auth-email" message={emailError} />
      {isValidEmailFormat && !isEduEmail(email) && (
        <p className="text-xs text-muted-foreground" role="status">
          {t('auth:errors.restrictedEmail')}
        </p>
      )}
      {(signInStage === 'password' || signInStage === 'signup') && (
        <>
          <div className="space-y-1">
            <Label htmlFor="auth-password" className="sr-only">
              {t('common:actions.password')}
            </Label>
            <PasswordInput
              id="auth-password"
              data-testid="auth-password-input"
              ref={passwordRef}
              placeholder={isSignUp ? t('auth:form.createPasswordPlaceholder') : t('auth:form.passwordPlaceholder')}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setAuthError(null);
                setConfirmError(null);
              }}
              className="w-full h-11 text-base bg-card border-border focus-visible:border-malachite-600 focus-visible:ring-malachite-600"
              required={!showForgotPassword}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              minLength={isSignUp ? 6 : undefined}
              aria-describedby={isSignUp ? 'signup-password-requirements' : undefined}
              disabled={isSubmitting}
            />
            {isSignUp && (
              <PasswordRequirements id="signup-password-requirements" password={password} />
            )}
            {!isSignUp && (
              <div className="flex justify-end pt-1">
                <Button
                  type="button"
                  variant="link"
                  onClick={() => setShowForgotPassword(true)}
                  className={`${inlineTextButtonClass} text-xs text-muted-foreground underline-offset-2 hover:text-foreground`}
                >
                  {t('auth:form.forgotPassword')}
                </Button>
              </div>
            )}
          </div>
          {isSignUp && (
            <div className="space-y-1">
              <Label htmlFor="auth-confirm-password" className="sr-only">
                {t('auth:form.confirmPasswordLabel')}
              </Label>
              <PasswordInput
                id="auth-confirm-password"
                data-testid="auth-confirm-password-input"
                ref={confirmPasswordRef}
                placeholder={t('auth:form.confirmPasswordPlaceholder')}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setAuthError(null);
                  setConfirmError(null);
                }}
                className="w-full h-11 text-base bg-card border-border focus-visible:border-malachite-600 focus-visible:ring-malachite-600"
                required
                autoComplete="new-password"
                aria-invalid={!!confirmError}
                aria-describedby={confirmError ? 'signup-confirm-error' : undefined}
                disabled={isSubmitting}
              />
              {confirmError && (
                <p id="signup-confirm-error" role="alert" className="text-xs font-medium text-red-700">
                  {confirmError}
                </p>
              )}
            </div>
          )}
        </>
      )}
      {signInStage === 'oauth-only' && stageOAuthMethod && (
        <div
          role="status"
          className="rounded-lg border border-malachite-200 bg-malachite-50 px-4 py-3 text-sm text-malachite-900"
        >
          <Trans
            i18nKey="auth:oauthOnly.message"
            values={{ provider: oauthLabel(stageOAuthMethod) }}
            components={{ bold: <span className="font-semibold" /> }}
          />
        </div>
      )}
      {/* App Store 4.8: the iOS shell hides Google, so an existing Google-only
          account has no button to press and no password to type. Rather than
          strand them on the password field, name the situation and hand them a
          way out: a reset link creates a password on the SAME account (Supabase
          recovery works for an identity with no prior password), and the link
          opens on the web where /auth shows the set-password form. */}
      {signInStage === 'oauth-unavailable' && stageOAuthMethod && (
        <div className="space-y-3 rounded-card border border-stone-200 bg-white p-4 shadow-flat">
          <p className="text-sm text-foreground">
            <Trans
              i18nKey="auth:oauthUnavailable.message"
              values={{ provider: oauthLabel(stageOAuthMethod) }}
              components={{ bold: <span className="font-semibold" /> }}
            />
          </p>
          <Button
            type="button"
            disabled={isSendingReset || !isValidUniversityEmail || !turnstile.ready}
            // The `default` variant is the Deep Malachite token, not a raw
            // `bg-malachite-800` — this screen is already at its solid-green
            // budget under `lint:colors` RULE 3.
            className="h-11 w-full"
            onClick={(e) => {
              e.preventDefault();
              void handleForgotPassword(e);
            }}
          >
            {isSendingReset ? (
              <div className="mx-auto h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              t('auth:oauthUnavailable.sendLink')
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            {t('auth:oauthUnavailable.hint')}
          </p>
        </div>
      )}
      {showForgotPassword && (
        <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            <Trans
              i18nKey="auth:forgotPassword.info"
              values={{ email: email.trim() || t('auth:forgotPassword.yourSchoolEmail') }}
              components={{ bold: <span className="font-medium text-foreground" /> }}
            />
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={isSendingReset || !isValidUniversityEmail || !turnstile.ready}
              className="flex-1 h-11 bg-malachite-800 hover:bg-malachite-900 text-white"
              onClick={(e) => {
                e.preventDefault();
                void handleForgotPassword(e);
              }}
            >
              {isSendingReset ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
              ) : (
                t('auth:forgotPassword.send')
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setShowForgotPassword(false)}
            >
              {t('common:actions.cancel')}
            </Button>
          </div>
        </div>
      )}
      {showResend && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
          <p className="text-sm font-medium mb-3">{t('auth:resend.title')}</p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mb-3">
            {t('auth:resend.note')}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={handleResendLink}
            disabled={isResending || !turnstile.ready}
            className="w-full border-amber-300 bg-card text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800 dark:text-amber-300"
          >
            {isResending ? (
              <div className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto" />
            ) : (
              t('auth:resend.button')
            )}
          </Button>
        </div>
      )}
      {/* Captcha for the password/sign-up submit (and any forgot/resend action
          reachable from this stage). The identify step needs no token, so the
          widget only mounts once past it. */}
      {/* App Store 1.2 requirement 1: an explicit agreement to terms with NO
          tolerance for objectionable content or abusive users. Required on the
          sign-up path only — an existing account already accepted it. Both
          links open in-app (/terms and /privacy are exempt from the native
          logged-out redirect, see routes/legalPaths.ts). */}
      {isSignUp && (
        <div className="rounded-card border border-stone-200 bg-white p-3 shadow-flat">
          <label htmlFor="agree-terms" className="flex cursor-pointer items-start gap-3">
            <input
              id="agree-terms"
              type="checkbox"
              required
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              disabled={isSubmitting}
              className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded accent-malachite-800"
            />
            <span className="text-sm leading-relaxed text-muted-foreground">
              <Trans
                i18nKey="auth:legal.agreementCheckbox"
                components={{
                  terms: (
                    <Link
                      to="/terms"
                      className="font-semibold text-malachite-800 underline underline-offset-2 hover:text-malachite-900"
                    />
                  ),
                  privacy: (
                    <Link
                      to="/privacy"
                      className="font-semibold text-malachite-800 underline underline-offset-2 hover:text-malachite-900"
                    />
                  ),
                }}
              />
            </span>
          </label>
        </div>
      )}
      {(signInStage === 'password' ||
        signInStage === 'signup' ||
        // The 4.8 dead-end state's only action is a captcha-protected reset.
        signInStage === 'oauth-unavailable') && (
        <div className="flex justify-center">
          <TurnstileWidget
            ref={turnstile.ref}
            onToken={turnstile.setToken}
            theme="light"
            action={isSignUp ? 'signup' : 'signin'}
          />
        </div>
      )}
      {/* Primary action, why-it's-blocked, and the sign-up switch are ONE block.
          Lifting them out of the form's `space-y-4` is what lets the sign-up line
          sit 8px under the button instead of 20px — a `-mt-*` on the paragraph
          would not have worked, since `space-y-4`'s selector outranks it. */}
      <div className="space-y-2">
      {showWaitlistOption ? (
        <Button
          type="button"
          onClick={() => setShowWaitlist(true)}
          className="w-full h-11 text-base font-semibold bg-malachite-800 hover:bg-malachite-900 text-white"
        >
          {t('common:actions.joinWaitlist')}
        </Button>
      ) : signInStage === 'oauth-only' || signInStage === 'oauth-unavailable' ? null : (
        // One form child, not two: as a fragment the (usually empty) blocked-reason
        // paragraph still collected the form's `space-y-4`, so a phantom 16px band
        // sat between the button and the sign-up line on a screen with nothing to
        // report. Grouped here, the reason costs nothing until it has something to say.
        <div>
        <Button
          type="submit"
          data-testid="auth-submit-button"
          // Disabled is a NEUTRAL surface, not a faded green: a translucent green
          // still reads as "the button, dimmed", which is exactly the ambiguity
          // that made people tap a dead control. stone-600 on stone-200 is 6.4:1.
          className={cn(
            'w-full h-11 text-base font-semibold bg-malachite-800 hover:bg-malachite-900 text-white',
            'disabled:opacity-100 disabled:bg-stone-200 disabled:text-stone-600 disabled:hover:bg-stone-200',
            signInStage === 'password' && ringFor('email'),
          )}
          // IPP-3 item 5: the button still disables, but it no longer refuses in
          // silence — the reason renders below and is announced. Landing on a dead
          // control with no explanation was the single worst thing on this screen,
          // and this is the top of the signup funnel.
          aria-describedby={submitBlockedVisible && submitBlockedReason ? 'auth-submit-blocked' : undefined}
          disabled={
            isSubmitting ||
            isResolvingMethods ||
            !isValidUniversityEmail ||
            // App Store 1.2: no account is created without an explicit
            // agreement to the terms.
            (isSignUp && !agreedToTerms) ||
            ((signInStage === 'password' || signInStage === 'signup') && !turnstile.ready)
          }
        >
          {isSubmitting || isResolvingMethods ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
          ) : signInStage === 'identify' ? (
            t('common:actions.continue')
          ) : isSignUp ? (
            t('auth:actions.createAccount')
          ) : (
            <>
              {t('auth:actions.signIn')}
              {activeHint?.mapped === 'email' && lastUsedBadge}
            </>
          )}
        </Button>
        {/* Same reveal rule as the field errors: the reason for a dead button is
            useful AFTER you've tried something, and pure nagging before. At rest
            on mount — or on a field you tabbed past without typing — there is
            nothing to explain yet, so it stays silent. The element stays mounted
            either way (an aria-live region that appears late announces nothing),
            so the gap above it is conditional instead: empty, it costs 0px. */}
        <SubmitBlockedReason
          id="auth-submit-blocked"
          reason={submitBlockedVisible ? submitBlockedReason : null}
          className={cn('text-center', submitBlockedVisible && submitBlockedReason && 'mt-2')}
        />
        </div>
      )}
      <p className="text-center text-sm text-muted-foreground">
        {isSignUp ? t('auth:switch.haveAccount') : t('auth:switch.noAccount')}{' '}
        <Button
          type="button"
          variant="link"
          onClick={() => {
            if (isSignUp) {
              // Back to sign in: re-collect the identifier so we resolve the
              // right method for this email.
              setIsSignUp(false);
              setSignInStage('identify');
              setStageOAuthMethod(null);
              setPassword('');
              setConfirmPassword('');
              setConfirmError(null);
              setAuthError(null);
              setShowResend(false);
              // Consent is re-asked on every visit to sign-up, never carried.
              setAgreedToTerms(false);
            } else {
              // Explicit sign up: reveal the password field in create mode.
              setIsSignUp(true);
              setSignInStage('signup');
              setStageOAuthMethod(null);
              setAuthError(null);
              setShowForgotPassword(false);
              setShowResend(false);
            }
          }}
          className={`${inlineTextButtonClass} font-semibold text-malachite-800 underline-offset-2 hover:text-malachite-900`}
        >
          {isSignUp ? t('auth:actions.signIn') : t('auth:actions.signUp')}
        </Button>
      </p>
      </div>
      {/* App Store 5.1.1(v): the Student Market is browsable without an account,
          and this is how a visitor (and the App Review tester) finds that out.
          On native this screen is the logged-out entry point, so without this
          link guest browsing exists but is unreachable.

          It sits one tier BELOW the sign-up link but is no longer the same shape
          as it: a bordered ghost button, separated by its own rule, so the block
          under the primary action reads as three ranked things rather than four
          interchangeable centered sentences. Never hide or collapse this. */}
      <div className="pt-3 border-t border-stone-200">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate('/marketplace')}
          className="w-full h-11 text-sm font-semibold border-stone-300 bg-transparent text-malachite-800 hover:bg-stone-100 hover:text-malachite-900"
        >
          {t('auth:actions.browseAsGuest', 'Browse the marketplace without an account')}
        </Button>
      </div>
    </form>
    )
  );

  // Identifier step: resolve the account's sign-in methods, then reveal the
  // password field, switch to sign-up, or steer an OAuth-only account to its
  // provider. Only reached for active-university emails (the button is disabled
  // otherwise); fails open to the password field on any lookup error.
  const handleIdentify = async (trimmedEmail: string) => {
    setIsResolvingMethods(true);
    setAuthError(null);
    try {
      const lookup = await resolveAuthMethods(trimmedEmail);
      const stage = deriveShellSignInStage(lookup, authMethods, visibleSsoMethods);
      if (stage.mode === 'oauth-only' && stage.oauthMethod) {
        setStageOAuthMethod(stage.oauthMethod);
        setIsSignUp(false);
        setSignInStage('oauth-only');
      } else if (stage.mode === 'oauth-unavailable' && stage.oauthMethod) {
        // The account exists but its only sign-in method isn't offered on this
        // shell (iOS + Google, per 4.8). Don't drop them on a password field
        // for a password they never set - offer to create one.
        setStageOAuthMethod(stage.oauthMethod);
        setIsSignUp(false);
        setSignInStage('oauth-unavailable');
      } else if (stage.mode === 'signup') {
        setIsSignUp(true);
        setSignInStage('signup');
        setTimeout(() => passwordRef.current?.focus(), 0);
      } else {
        setIsSignUp(false);
        setSignInStage('password');
        setTimeout(() => passwordRef.current?.focus(), 0);
      }
    } catch (err) {
      const msg = describeAuthError(err);
      setAuthError(msg);
      toast.error(msg);
    } finally {
      setIsResolvingMethods(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Before any early return: a submit attempt reveals every field's error, so
    // someone who tabs straight to the button still sees what's wrong.
    reveal.markSubmitAttempted();

    const trimmedEmail = email.trim();
    if (!isAllowedEmail(trimmedEmail, authUniversity)) {
      // Advertiser exception (P1.10): a superadmin-issued invitation admits
      // exactly this email (the DB signup gate re-checks server-side).
      let invitedAdvertiser = false;
      if (isValidEmailFormat) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not yet in generated types (migration 20260713010000)
          const { data } = await (supabase as any).rpc('has_advertiser_invitation', {
            p_email: trimmedEmail,
          });
          invitedAdvertiser = data === true;
        } catch {
          invitedAdvertiser = false;
        }
      }
      if (!invitedAdvertiser) {
        // A complete non-active-university .edu address routes to the waitlist
        // instead of a dead-end; anything else falls back to the gate message.
        if (isValidEmailFormat && isEduEmail(trimmedEmail)) {
          setShowWaitlist(true);
        } else {
          toast.error(t('auth:errors.restrictedEmail'));
        }
        return;
      }
    }

    // Step one: we don't yet know the account's methods.
    if (signInStage === 'identify') {
      await handleIdentify(trimmedEmail);
      return;
    }

    // Signup: validate the password against policy and confirm-match up front,
    // before any network call. The live checklist already shows which rules are
    // unmet, so a compliant password never reaches (or trips) a server error.
    if (isSignUp) {
      if (!isPasswordValid(password)) {
        setConfirmError(null);
        passwordRef.current?.focus();
        return;
      }
      if (password !== confirmPassword) {
        setConfirmError(t('auth:errors.passwordsNoMatch'));
        confirmPasswordRef.current?.focus();
        return;
      }
    }

    setIsSubmitting(true);
    setAuthError(null);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            // Carry the invite/destination inside the confirmation URL so it
            // survives the email round-trip (sessionStorage does not — a new
            // user confirms in a fresh browser context). See authRedirects.
            emailRedirectTo: buildSignupEmailRedirectTo(searchParams.get('redirect')),
            captchaToken: turnstile.captchaToken,
          },
        });
        if (error) {
          // Captcha rejections first, then password-policy readable copy;
          // everything else keeps the generic transport/unknown handling.
          const msg = isCaptchaError(error)
            ? CAPTCHA_ERROR_MESSAGE
            : mapPasswordPolicyServerError(error) !== null
            ? t('auth:errors.passwordPolicy', { min: PASSWORD_MIN_LENGTH })
            : describeAuthError(error);
          setAuthError(msg);
          toast.error(msg);
        } else {
          setShowCodeInput(true);
          setEmailToResend(trimmedEmail);
          setOtpCode('');
          toast.success(t('auth:toast.accountCreated'));
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
          options: { captchaToken: turnstile.captchaToken },
        });
        if (error) {
          const msg = error.message?.toLowerCase() ?? '';
          if (isCaptchaError(error)) {
            setAuthError(CAPTCHA_ERROR_MESSAGE);
            toast.error(CAPTCHA_ERROR_MESSAGE);
          } else if (msg.includes('email not confirmed')) {
            setAuthError(describeAuthError(error));
            setShowResend(true);
            setEmailToResend(trimmedEmail);
            toast(t('auth:toast.pleaseVerify'));
          } else if (msg.includes('invalid login credentials')) {
            // Friendly copy - Supabase's raw "Invalid login credentials" is
            // opaque. Only nudge toward an OAuth provider when THIS school
            // actually offers it: a device-local last-used hint from another
            // campus must never suggest Google at an email-only school (CMU).
            const offeredOAuth =
              lastMethod && isOAuthMethod(lastMethod) && authMethods.includes(toAuthMethod(lastMethod))
                ? lastMethod
                : null;
            const friendly = offeredOAuth
              ? t('auth:errors.wrongPasswordOAuth', { method: lastMethodLabel(offeredOAuth) })
              : t('auth:errors.wrongCredentials');
            setAuthError(friendly);
            toast.error(friendly);
          } else {
            const generic = describeAuthError(error);
            setAuthError(generic);
            toast.error(generic);
          }
        } else {
          setLastAuthMethod('password');
        }
      }
    } catch (err) {
      // Supabase returns errors via { error } above; this catches anything
      // genuinely thrown (transport/unknown) so it can't escape unhandled.
      const thrown = describeAuthError(err);
      setAuthError(thrown);
      toast.error(thrown);
    } finally {
      setIsSubmitting(false);
      turnstile.reset(); // single-use token: refresh for the next attempt
    }
  };

  // Loading guard: prevent login screen flash while Supabase session is being determined
  if (isAuthLoading) {
    return (
      <div role="status" className="min-h-screen flex items-center justify-center bg-primary">
        <div aria-hidden="true" className="w-8 h-8 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin motion-reduce:animate-none" />
        <span className="sr-only">{t('common:state.loading')}</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex relative">
      {!isNative && (
      <div className="fixed top-4 left-4 z-[60]">
        <Button
          variant="outline"
          aria-label={t('common:actions.back')}
          onClick={() => navigate('/')}
          className="bg-card/80 backdrop-blur-md border-border shadow-raised hover:bg-card/95 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline ml-2">{t('common:actions.back')}</span>
        </Button>
      </div>
      )}

      {/* Left Side - Brand Panel */}
      <div className="hidden lg:flex lg:w-1/2 relative flex-col justify-center overflow-hidden bg-gradient-to-br from-malachite-700 via-malachite-800 to-malachite-900">
        {/* Subtle depth: soft radial glows, dark green only (never black) */}
        <div aria-hidden className="absolute inset-0 [background:radial-gradient(52rem_36rem_at_18%_12%,rgba(255,255,255,0.09),transparent_60%),radial-gradient(44rem_32rem_at_88%_92%,rgba(255,255,255,0.06),transparent_55%)]" />
        <div aria-hidden className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full border border-white/10" />
        <div aria-hidden className="absolute -bottom-16 -right-16 h-64 w-64 rounded-full border border-white/10" />

        <div className="relative z-10 px-12 xl:px-20 max-w-2xl">
          <img
            src="/dormcheck-logo-new.png"
            alt=""
            aria-hidden
            className="h-16 w-auto object-contain mb-10 brightness-0 invert opacity-90"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <h1 className="font-display text-5xl font-bold leading-tight mb-5 text-white">
            <Trans i18nKey="auth:hero.headline" components={{ i: <span className="italic" /> }} />
          </h1>
          <p className="text-white/80 text-lg max-w-md">
            {SHOW_HOUSING || SHOW_ROOMMATES
              ? t('auth:hero.subDiscover')
              : t('auth:hero.subShop')}
          </p>
        </div>
      </div>

      {/* Right Side - Auth Form */}
      <div
        className={cn(
          'w-full lg:w-1/2 flex justify-center min-h-[100dvh] overflow-y-auto overscroll-none bg-card',
          isNative
            ? 'px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-[calc(var(--keyboard-height,0px)+max(2rem,env(safe-area-inset-bottom)))]'
            : 'px-8 py-10 pb-[calc(var(--keyboard-height,0px)+max(2.5rem,env(safe-area-inset-bottom)))]',
        )}
      >
        {/* Native is TOP-ANCHORED, not centered: a short form floating in the
            middle of a tall phone viewport reads as unfinished, and the logo
            drifts as the field count changes between stages. Web keeps my-auto,
            where the column is short relative to the panel. */}
        <div className={cn('w-full max-w-[400px]', isNative ? 'pb-8' : 'my-auto')}>
          {showUpdatePassword ? (
            <>
              <div className="flex justify-center mb-6">
                <img
                  src="/dormcheck-logo-new.png"
                  alt="DormCheck"
                  className="h-10 w-auto object-contain"
                  onError={(e) => { e.currentTarget.src = "/dormcheck-logo.png"; }}
                />
              </div>
              <div className="text-center mb-6">
                <h2 className="font-display text-2xl font-bold text-foreground mb-2">
                  {t('auth:updatePassword.title')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('auth:updatePassword.subtitle')}
                </p>
              </div>
              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <PasswordInput
                  placeholder={t('auth:updatePassword.placeholder')}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full h-11 text-base bg-card border-border focus-visible:border-malachite-600 focus-visible:ring-malachite-600"
                  required
                  minLength={6}
                  autoComplete="new-password"
                />
                <Button
                  type="submit"
                  className="w-full h-11 text-base font-semibold bg-malachite-800 hover:bg-malachite-900 text-white"
                  disabled={isUpdatingPassword}
                >
                  {isUpdatingPassword ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
                  ) : (
                    t('auth:updatePassword.submit')
                  )}
                </Button>
              </form>
              <p className="text-center text-sm text-muted-foreground mt-4">
                <Button
                  type="button"
                  variant="link"
                  onClick={() => { setShowUpdatePassword(false); setNewPassword(''); }}
                  className={inlineTextButtonClass}
                >
                  {t('common:actions.backToSignIn')}
                </Button>
              </p>
            </>
          ) : isNative ? (
            <>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="mt-2 mb-3 flex items-center justify-center gap-3"
              >
                <img
                  src="/dormcheck-logo-new.png"
                  alt=""
                  className="h-11 w-11 object-contain"
                  onError={(e) => { e.currentTarget.src = '/dormcheck-logo.png'; }}
                />
                <h2 className="font-display text-3xl font-bold text-foreground">
                  DormCheck
                </h2>
              </motion.div>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="mb-5 text-center text-muted-foreground"
              >
                {t('auth:tagline')}
              </motion.p>

              {authError && (
                <div role="alert" aria-live="polite" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                  <p className="font-medium mb-1">{t('auth:error.heading')}</p>
                  <p className="text-red-700 dark:text-red-400 break-words mb-3">{authError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-400"
                    onClick={async () => {
                      await supabase.auth.signOut();
                      try {
                        localStorage.clear();
                      } catch { /* ignore */ }
                      setAuthError(null);
                      toast.success(t('auth:toast.sessionCleared'));
                    }}
                  >
                    {t('auth:error.clearSession')}
                  </Button>
                </div>
              )}

              {schoolBanner()}

              {hasSsoProvider && (
              <div className="space-y-3">
              {visibleSsoMethods.includes('google') && (
              <Button
                type="button"
                data-testid="auth-google-continue-button"
                variant="outline"
                disabled={isGoogleSigningIn}
                className={cn('w-full h-12 text-base font-medium border-border bg-card text-foreground shadow-raised hover:bg-accent', ringFor('google'))}
                onClick={handleGoogleSignIn}
              >
                {isGoogleSigningIn ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                    {t('auth:actions.signingIn')}
                  </span>
                ) : (
                  <>
                    <svg className="mr-3 h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    {t('auth:actions.continueWithGoogle')}
                    {activeHint?.mapped === 'google' && lastUsedBadge}
                  </>
                )}
              </Button>
              )}

              {visibleSsoMethods.includes('microsoft') && (
              <Button
                type="button"
                variant="outline"
                disabled={isMicrosoftSigningIn}
                className={cn('w-full h-12 text-base font-medium border-border bg-card text-foreground shadow-raised hover:bg-accent', ringFor('microsoft'))}
                onClick={handleMicrosoftSignIn}
              >
                {isMicrosoftSigningIn ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                    {t('auth:actions.signingIn')}
                  </span>
                ) : (
                  <>
                    <svg className="mr-3 h-5 w-5 shrink-0" viewBox="0 0 23 23" aria-hidden>
                      <path fill="#f35325" d="M1 1h10v10H1z" />
                      <path fill="#81bc06" d="M12 1h10v10H12z" />
                      <path fill="#05a6f0" d="M1 12h10v10H1z" />
                      <path fill="#ffba08" d="M12 12h10v10H12z" />
                    </svg>
                    {t('auth:actions.continueWithMicrosoft')}
                    {activeHint?.mapped === 'microsoft' && lastUsedBadge}
                  </>
                )}
              </Button>
              )}
              </div>
              )}

              {hasSsoProvider && (
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-card px-4 text-muted-foreground">{t('auth:divider.or')}</span>
                </div>
              </div>
              )}

              {renderAuthForm()}

              <div className="mt-6 text-center text-xs text-muted-foreground">
                <p>
                  <Trans
                    i18nKey="auth:legal.agreement"
                    components={{
                      terms: <Link to="/terms" className="text-primary underline underline-offset-2" />,
                      privacy: <Link to="/privacy" className="text-primary underline underline-offset-2" />,
                    }}
                  />
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="mb-1.5 flex items-center justify-center gap-2.5">
                <img
                  src="/dormcheck-logo-new.png"
                  alt=""
                  className="h-9 w-9 object-contain"
                  onError={(e) => { e.currentTarget.src = '/dormcheck-logo.png'; }}
                />
                <h2 className="font-display text-2xl font-bold text-foreground">
                  DormCheck
                </h2>
              </div>
              <p className="mb-8 text-center text-sm text-muted-foreground">
                {t('auth:tagline')}
              </p>

              {authError && (
                <div role="alert" aria-live="polite" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800">
                  <p className="font-medium mb-1">{t('auth:error.heading')}</p>
                  <p className="text-red-700 dark:text-red-400 break-words mb-3">{authError}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-red-300 text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-400"
                    onClick={async () => {
                      await supabase.auth.signOut();
                      try {
                        localStorage.clear();
                      } catch { /* ignore */ }
                      setAuthError(null);
                      toast.success(t('auth:toast.sessionCleared'));
                    }}
                  >
                    {t('auth:error.clearSession')}
                  </Button>
                </div>
              )}

              {schoolBanner()}

              {hasSsoProvider && (
              <div className="space-y-3">
              {visibleSsoMethods.includes('google') && (
              <Button
                type="button"
                data-testid="auth-google-continue-button"
                variant="outline"
                disabled={isGoogleSigningIn}
                className={cn('w-full h-12 text-base font-medium border-border bg-card text-foreground shadow-raised hover:bg-accent', ringFor('google'))}
                onClick={() => void handleWebGoogleSignIn()}
              >
                {isGoogleSigningIn ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                    {t('auth:actions.signingIn')}
                  </span>
                ) : (
                  <>
                    <svg className="mr-3 h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden>
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    {t('auth:actions.continueWithGoogle')}
                    {activeHint?.mapped === 'google' && lastUsedBadge}
                  </>
                )}
              </Button>
              )}

              {visibleSsoMethods.includes('microsoft') && (
              <Button
                type="button"
                variant="outline"
                disabled={isMicrosoftSigningIn}
                className={cn('w-full h-12 text-base font-medium border-border bg-card text-foreground shadow-raised hover:bg-accent', ringFor('microsoft'))}
                onClick={handleMicrosoftSignIn}
              >
                {isMicrosoftSigningIn ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                    {t('auth:actions.signingIn')}
                  </span>
                ) : (
                  <>
                    <svg className="mr-3 h-5 w-5 shrink-0" viewBox="0 0 23 23" aria-hidden>
                      <path fill="#f35325" d="M1 1h10v10H1z" />
                      <path fill="#81bc06" d="M12 1h10v10H12z" />
                      <path fill="#05a6f0" d="M1 12h10v10H1z" />
                      <path fill="#ffba08" d="M12 12h10v10H12z" />
                    </svg>
                    {t('auth:actions.continueWithMicrosoft')}
                    {activeHint?.mapped === 'microsoft' && lastUsedBadge}
                  </>
                )}
              </Button>
              )}
              </div>
              )}

              {hasSsoProvider && (
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="bg-card px-4 text-muted-foreground">{t('auth:divider.or')}</span>
                </div>
              </div>
              )}

              {renderAuthForm()}

              <div className="mt-6 text-center text-xs text-muted-foreground">
                <p>
                  <Trans
                    i18nKey="auth:legal.agreement"
                    components={{
                      terms: <Link to="/terms" className="text-primary underline underline-offset-2" />,
                      privacy: <Link to="/privacy" className="text-primary underline underline-offset-2" />,
                    }}
                  />
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
