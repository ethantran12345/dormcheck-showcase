import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation, Trans } from "react-i18next";
import { Check, Copy, Mail, Users } from "lucide-react";
import { toast } from "sonner";
import { fieldErrorProps, useErrorReveal } from "@/lib/formCraft";
import { FieldError } from "@/components/ui/field-error";
import { Reveal } from "@/components/marketing/landing/Reveal";
import { Eyebrow, WRAP } from "@/components/marketing/landing/ui";
import { RouteMeta } from "@/components/seo/RouteMeta";
import { pageTitle } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isEduEmail } from "@/config/universities";
import { submitWaitlist } from "@/lib/waitlist";
import {
  buildAdminMailto,
  buildShareUrl,
  classifyWaitlistEmail,
  emailDomain,
  fetchWaitlistRank,
  readWaitlistRef,
  schoolDisplayName,
  storeWaitlistRef,
  submitAdminLead,
  type WaitlistRankResult,
} from "@/lib/waitlistGrowth";

/**
 * /waitlist (public, marketing zone): school-level waitlist status +
 * two move-up levers - share link for classmates and a pre-written
 * email to the housing office / university admin (lead captured for
 * the partnership pipeline). School aggregates only; no personal data
 * is ever shown or put in the share URL.
 *
 * Honesty guardrail: admin backing means the school jumps the line and
 * the partnership process starts. Never promise an instant launch.
 */

function StepCard({
  step,
  icon,
  title,
  children,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-[22px] border border-stone-900/10 bg-white p-6 shadow-raised md:p-8">
      <div className="flex items-center gap-3">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-malachite-100 text-malachite-800"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div>
          <p className="text-[12.5px] font-extrabold uppercase tracking-[0.14em] text-malachite-800">
            {t('onboarding:waitlist.stepPrefix', { step })}
          </p>
          <h2 className="font-serif text-[21px] font-semibold leading-snug text-stone-900">
            {title}
          </h2>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function WaitlistPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const ref = readWaitlistRef();
  const domain = (searchParams.get("school") ?? ref?.domain ?? "").trim().toLowerCase();

  const [rank, setRank] = useState<WaitlistRankResult | null>(null);
  const [rankLoading, setRankLoading] = useState(Boolean(domain));
  const [rankFailed, setRankFailed] = useState(false);

  // Join form (friend landing, or no school context at all)
  const [joinEmail, setJoinEmail] = useState("");
  const [joinSchool, setJoinSchool] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [justJoined, setJustJoined] = useState(false);

  // Cold start (no ?school): peek rank by email domain, client-side only.
  const [coldStartEmail, setColdStartEmail] = useState("");
  const [coldStartError, setColdStartError] = useState<string | null>(null);
  const [coldStartActive, setColdStartActive] = useState(false);
  const focusAfterPeek = useRef(false);

  // Share link
  const [copied, setCopied] = useState(false);

  // Admin outreach form
  const [adminName, setAdminName] = useState("");
  const [adminRole, setAdminRole] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [isSendingLead, setIsSendingLead] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadRank = useCallback(async (d: string) => {
    setRankLoading(true);
    setRankFailed(false);
    try {
      setRank(await fetchWaitlistRank(d));
    } catch {
      // Rank fetch failing must not read as "no one has joined" - fall
      // back to a neutral headline; the share + outreach steps still work.
      setRank(null);
      setRankFailed(true);
    } finally {
      setRankLoading(false);
    }
  }, []);

  useEffect(() => {
    if (domain) void loadRank(domain);
  }, [domain, loadRank]);

  // After a cold-start peek switches us into the rank view, move focus to
  // the aria-live heading (same landing spot as the post-join flow).
  useEffect(() => {
    if (domain && focusAfterPeek.current) {
      focusAfterPeek.current = false;
      headingRef.current?.focus();
    }
  }, [domain]);

  const handlePeek = (e: React.FormEvent) => {
    e.preventDefault();
    const classified = classifyWaitlistEmail(coldStartEmail);
    if (classified.kind === "invalid") {
      setColdStartError(t('auth:errors.restrictedEmail'));
      return;
    }
    setColdStartError(null);
    if (classified.kind === "active") {
      // Already-live campus: sign-in, not the waitlist.
      setColdStartActive(true);
      return;
    }
    // Peek only: keep the email in memory to prefill the join form; it is
    // never stored or sent until the visitor explicitly joins.
    setJoinEmail(coldStartEmail.trim());
    focusAfterPeek.current = true;
    setSearchParams({ school: classified.domain }, { replace: true });
  };

  const schoolName = schoolDisplayName(domain, rank?.school_name);
  const onList = rank?.rank != null;
  // The visitor is "on the list" personally only if we have their ref or
  // they joined right here; otherwise show the join form alongside rank.
  const visitorJoined = justJoined || ref?.domain === domain;

  // IPP-3: the join error used to exist ONLY as a toast — transient, unassociated
  // with the field, and gone before a screen-reader user could find what to fix.
  // It now also renders under the input, revealed on blur or after a submit
  // attempt, and clears itself the moment the address becomes valid.
  const joinReveal = useErrorReveal();
  const trimmedJoinEmail = joinEmail.trim();
  const joinEmailError = !joinReveal.shouldReveal('email') || trimmedJoinEmail.length === 0
    ? null
    : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedJoinEmail)
      ? t('common:form.emailInvalid')
      : !isEduEmail(trimmedJoinEmail)
        ? t('auth:errors.restrictedEmail')
        : null;

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    joinReveal.markSubmitAttempted();
    if (isJoining) return;
    const email = joinEmail.trim();
    if (!isEduEmail(email)) {
      // Toast stays (it's what draws the eye) but the field now owns the error too.
      toast.error(t('auth:errors.restrictedEmail'));
      return;
    }
    setIsJoining(true);
    const result = await submitWaitlist(email, schoolKnown ? undefined : joinSchool);
    setIsJoining(false);
    // strictNullChecks is off, so `!result.ok` doesn't narrow the union; key off
    // the failure member's `message` property (via `in`) which narrows regardless.
    if ('message' in result) {
      toast.error(result.message);
      return;
    }
    const joinedDomain = emailDomain(email);
    if (joinedDomain) {
      storeWaitlistRef({ domain: joinedDomain, email: email.toLowerCase() });
      setJustJoined(true);
      if (joinedDomain !== domain) {
        setSearchParams({ school: joinedDomain }, { replace: true });
      } else {
        void loadRank(joinedDomain);
      }
      toast.success(
        result.alreadyOnList ? t('onboarding:waitlist.alreadyOnListToast') : t('onboarding:waitlist.joinedToast'),
      );
      headingRef.current?.focus();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(domain));
      setCopied(true);
      toast.success(t('onboarding:waitlist.linkCopiedToast'));
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error(t('onboarding:waitlist.copyFailedToast'));
    }
  };

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSendingLead) return;
    const email = adminEmail.trim();
    if (!adminName.trim() || !email) {
      toast.error(t('onboarding:waitlist.adminNameEmailRequiredToast'));
      return;
    }
    setIsSendingLead(true);
    const result = await submitAdminLead({
      adminName,
      adminRole,
      adminEmail: email,
      schoolDomain: domain,
      referredByEmail: ref?.email ?? null,
    });
    setIsSendingLead(false);
    // strictNullChecks off → narrow via the failure member's `message` property.
    if ('message' in result) {
      // Don't block the student's outreach on our capture failing.
      toast.error(result.message);
    }
    window.location.href = buildAdminMailto(email, schoolName, {
      rank: rank?.rank,
      totalSchools: rank?.total_schools,
    });
  };

  // Directory/rank already names the school: ask for the email only. The
  // optional school field only appears when we genuinely don't know it.
  const schoolKnown = Boolean(rank?.school_name?.trim());

  const joinForm = (
    <form
      onSubmit={handleJoin}
      className="mx-auto mt-8 flex w-full max-w-[440px] flex-col gap-3 text-left"
    >
      <label htmlFor="wl-join-email" className="sr-only">
        {t('auth:form.emailLabel')}
      </label>
      <Input
        id="wl-join-email"
        type="email"
        required
        placeholder="you@school.edu"
        autoComplete="email"
        inputMode="email"
        value={joinEmail}
        onChange={(e) => setJoinEmail(e.target.value)}
        {...joinReveal.blurProps('email')}
        {...fieldErrorProps('wl-join-email', joinEmailError)}
        disabled={isJoining}
      />
      <FieldError fieldId="wl-join-email" message={joinEmailError} />
      {!schoolKnown && (
        <>
          <label htmlFor="wl-join-school" className="sr-only">
            {t('onboarding:waitlist.schoolNameOptionalLabel')}
          </label>
          <Input
            id="wl-join-school"
            type="text"
            placeholder={t('onboarding:waitlist.schoolNameOptionalLabel')}
            autoComplete="organization"
            value={joinSchool}
            onChange={(e) => setJoinSchool(e.target.value)}
            disabled={isJoining}
          />
        </>
      )}
      <Button type="submit" disabled={isJoining}>
        {isJoining ? t('onboarding:waitlist.joiningButton') : t('common:actions.joinWaitlist')}
      </Button>
    </form>
  );

  // No school context at all: cold start. Peek first - the email is used
  // client-side only to find the school domain; nothing is stored until
  // the visitor explicitly joins from the rank view.
  if (!domain) {
    return (
      <div className="bg-tint-50 text-stone-900">
        {/* Both branches of this page are the same URL. The school is carried in
            the query string, so the canonical collapses them onto /waitlist. */}
        <RouteMeta title={pageTitle("Waitlist")} />
        <section className="pb-24 pt-8 md:pt-14">
          <div className={`${WRAP} mx-auto max-w-[680px] text-center`}>
            <Eyebrow>{t('onboarding:waitlist.eyebrow')}</Eyebrow>
            <h1 className="mt-3 font-serif text-[clamp(32px,4.5vw,52px)] font-semibold leading-[1.08]">
              {t('onboarding:waitlist.coldStartHeading')}
            </h1>
            {coldStartActive ? (
              <>
                <p className="mt-4 text-lg text-stone-700" role="status">
                  {t('onboarding:waitlist.alreadyLiveDescription')}
                </p>
                <div className="mt-8">
                  <Button asChild>
                    <Link to="/auth">
                      {t('onboarding:waitlist.signInLink')}
                    </Link>
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-4 text-lg text-stone-700">
                  {t('onboarding:waitlist.coldStartDescription')}
                </p>
                <form
                  onSubmit={handlePeek}
                  className="mx-auto mt-8 flex w-full max-w-[440px] flex-col gap-3 text-left"
                >
                  <label htmlFor="wl-peek-email" className="sr-only">
                    {t('auth:form.emailLabel')}
                  </label>
                  <Input
                    id="wl-peek-email"
                    type="email"
                    required
                    placeholder="you@school.edu"
                    autoComplete="email"
                    inputMode="email"
                    value={coldStartEmail}
                    onChange={(e) => {
                      setColdStartEmail(e.target.value);
                      setColdStartError(null);
                    }}
                    aria-invalid={coldStartError ? true : undefined}
                    aria-describedby={coldStartError ? "wl-peek-error" : undefined}
                  />
                  {coldStartError && (
                    <p
                      id="wl-peek-error"
                      role="alert"
                      className="text-sm font-semibold text-red-600"
                    >
                      {coldStartError}
                    </p>
                  )}
                  <Button type="submit">
                    {t('onboarding:waitlist.peekButton')}
                  </Button>
                </form>
              </>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="bg-tint-50 text-stone-900">
      <RouteMeta title={pageTitle("Waitlist")} />
      {/* Rank header */}
      <section className="pb-10 pt-8 md:pt-14">
        <div className={`${WRAP} mx-auto max-w-[680px] text-center`}>
          <Eyebrow>{t('onboarding:waitlist.rankEyebrow')}</Eyebrow>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-3 font-serif text-[clamp(32px,4.5vw,52px)] font-semibold leading-[1.08] outline-none"
            aria-live="polite"
          >
            {rankLoading ? (
              <span className="text-stone-400">{t('onboarding:waitlist.checkingHeading', { schoolName })}</span>
            ) : onList ? (
              <Trans
                i18nKey="onboarding:waitlist.rankHeading"
                values={{ schoolName, rank: rank?.rank }}
                components={{ highlight: <span className="text-malachite-800" /> }}
              />
            ) : rankFailed ? (
              <Trans
                i18nKey="onboarding:waitlist.failedHeading"
                values={{ schoolName }}
              />
            ) : (
              <Trans
                i18nKey="onboarding:waitlist.firstHeading"
                values={{ schoolName }}
              />
            )}
          </h1>
          {!rankLoading && onList && (
            <p className="mt-4 text-lg text-stone-700">
              <Trans
                i18nKey="onboarding:waitlist.signedUpLine"
                values={{ count: rank?.count ?? 0, schoolName }}
              />
            </p>
          )}
          {!rankLoading && !onList && !rankFailed && (
            <p className="mt-4 text-lg text-stone-700">
              <Trans
                i18nKey="onboarding:waitlist.noOneJoinedDescription"
                values={{ schoolName }}
              />
            </p>
          )}
          {!rankLoading && rankFailed && (
            <p className="mt-4 text-lg text-stone-700">
              {t('onboarding:waitlist.failedLoadingDescription')}
            </p>
          )}

          {/* Mini leaderboard: school-level aggregates only. Skeleton rows
              above and below sell the "board" even when only the self row
              (or, pre-join, no ranked row at all) is real. */}
          {!rankLoading && rank && (
            <div className="mx-auto mt-6 w-full max-w-[440px] rounded-2xl border border-stone-900/10 bg-stone-100/70 p-3">
              <ol
                aria-label={t('onboarding:waitlist.leaderboardAriaLabel')}
                className="flex flex-col gap-1.5"
              >
                <li aria-hidden="true" className="flex items-center gap-3 px-4 py-2">
                  <span className="h-3 w-9 rounded-full bg-stone-200" />
                  <span className="h-3 w-36 rounded-full bg-stone-200" />
                </li>
                {onList ? (
                  rank.nearby.map((n) => {
                    const isSelf = n.domain === domain;
                    return (
                      <li
                        key={n.domain}
                        className={
                          isSelf
                            ? "flex items-center justify-between rounded-xl border border-malachite-600/40 bg-white px-4 py-2.5 font-extrabold text-stone-900 shadow-raised"
                            : "flex items-center justify-between rounded-xl px-4 py-2.5 font-semibold text-stone-500"
                        }
                      >
                        <span className="flex items-center gap-3">
                          <span
                            className={
                              isSelf ? "text-malachite-800" : "text-stone-400"
                            }
                          >
                            #{n.rank}
                          </span>
                          {isSelf
                            ? t('onboarding:waitlist.leaderboardYouRow', { schoolName: schoolDisplayName(n.domain, n.school_name) })
                            : schoolDisplayName(n.domain, n.school_name)}
                        </span>
                        <span className="text-sm font-semibold text-stone-400">
                          {t('onboarding:waitlist.signedUpCount', { num: n.count })}
                        </span>
                      </li>
                    );
                  })
                ) : (
                  <li className="flex items-center justify-between rounded-xl border border-dashed border-stone-900/15 bg-white px-4 py-2.5 font-extrabold text-stone-900">
                    <span className="flex items-center gap-3">
                      <span className="text-stone-400">&ndash;</span>
                      {schoolName}
                    </span>
                    <span className="text-sm font-semibold text-stone-400">
                      {t('onboarding:waitlist.notOnBoardYet')}
                    </span>
                  </li>
                )}
                <li aria-hidden="true" className="flex items-center gap-3 px-4 py-2">
                  <span className="h-3 w-9 rounded-full bg-stone-200" />
                  <span className="h-3 w-28 rounded-full bg-stone-200" />
                </li>
              </ol>
            </div>
          )}

          {/* Friend landing: join from here */}
          {!visitorJoined && !rankLoading && (
            <div className="mt-8">
              <p className="text-base font-semibold text-stone-700">
                {t('onboarding:waitlist.notOnListYetPrompt')}
              </p>
              {joinForm}
            </div>
          )}
        </div>
      </section>

      {/* Move-up steps */}
      <section className="pb-24">
        <div className={`${WRAP} mx-auto grid max-w-[760px] gap-5`}>
          <Reveal>
            <StepCard step={1} icon={<Users className="h-5 w-5" />} title={t('onboarding:waitlist.step1Title')}>
              <p className="text-[15px] leading-relaxed text-stone-600">
                <Trans
                  i18nKey="onboarding:waitlist.step1Description"
                  values={{ schoolName }}
                />
              </p>
              <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                <label htmlFor="wl-share-link" className="sr-only">
                  {t('onboarding:waitlist.shareLinksrOnly', { schoolName })}
                </label>
                <Input
                  id="wl-share-link"
                  type="text"
                  readOnly
                  value={buildShareUrl(domain)}
                  onFocus={(e) => e.currentTarget.select()}
                  className="font-mono text-sm text-stone-600"
                />
                <Button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4" aria-hidden="true" /> {t('onboarding:waitlist.copiedButton')}
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" aria-hidden="true" /> {t('onboarding:waitlist.copyLinkButton')}
                    </>
                  )}
                </Button>
              </div>
            </StepCard>
          </Reveal>

          <Reveal delay={100}>
            <StepCard
              step={2}
              icon={<Mail className="h-5 w-5" />}
              title={t('onboarding:waitlist.step2Title')}
            >
              <p className="text-[15px] leading-relaxed text-stone-600">
                <Trans
                  i18nKey="onboarding:waitlist.step2Description"
                  values={{ schoolName }}
                />
              </p>
              <form onSubmit={handleAdminSubmit} className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="wl-admin-name" className="text-sm font-bold text-stone-700">
                    {t('onboarding:waitlist.adminNameLabel')}
                  </label>
                  <Input
                    id="wl-admin-name"
                    type="text"
                    required
                    placeholder={t('onboarding:waitlist.adminNamePlaceholder')}
                    autoComplete="off"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    disabled={isSendingLead}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="wl-admin-role" className="text-sm font-bold text-stone-700">
                    <Trans i18nKey="onboarding:waitlist.adminRoleLabel" components={{ optional: <span className="font-semibold text-stone-400" /> }} />
                  </label>
                  <Input
                    id="wl-admin-role"
                    type="text"
                    placeholder={t('onboarding:waitlist.adminRolePlaceholder')}
                    autoComplete="off"
                    value={adminRole}
                    onChange={(e) => setAdminRole(e.target.value)}
                    disabled={isSendingLead}
                  />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="wl-admin-email" className="text-sm font-bold text-stone-700">
                    {t('onboarding:waitlist.adminEmailLabel')}
                  </label>
                  <Input
                    id="wl-admin-email"
                    type="email"
                    required
                    placeholder={t('onboarding:waitlist.adminEmailPlaceholder')}
                    inputMode="email"
                    // KEEP autoComplete="off" here: this asks for the HOUSING
                    // DIRECTOR's address, not the visitor's, so offering their own
                    // saved email would be actively wrong. inputMode is about the
                    // keyboard, not autofill, so it still belongs.
                    autoComplete="off"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    disabled={isSendingLead}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={isSendingLead}>
                    {isSendingLead ? t('onboarding:waitlist.preparingEmailButton') : t('onboarding:waitlist.sendEmailButton')}
                  </Button>
                  <p className="mt-2.5 text-[13px] leading-relaxed text-stone-500">
                    {t('onboarding:waitlist.emailDraftHelperText')}
                  </p>
                </div>
              </form>
            </StepCard>
          </Reveal>
        </div>
      </section>
    </div>
  );
}
