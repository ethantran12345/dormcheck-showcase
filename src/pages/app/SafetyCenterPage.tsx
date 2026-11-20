import { Link } from 'react-router';
import {
  Ban,
  CreditCard,
  ExternalLink,
  Flag,
  MapPin,
  Phone,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useUniversity } from '@/contexts/UniversityContext';
import { CAMPUS_SAFETY_RESOURCES } from '@/config/safetyResources';
import { PageContainer } from '@/components/ui/page-container';

/**
 * Safety Center (P1.11): one page collecting the trading/meeting/payment
 * rules the app enforces piecemeal (safety banner, scam interstitial,
 * report/block) plus campus-specific contacts. Linked from marketplace
 * safety surfaces and Settings > Support.
 */
export function SafetyCenterContent() {
  const { university } = useUniversity();
  const campusResources = CAMPUS_SAFETY_RESOURCES[university.id] ?? [];

  return (
      <PageContainer width="content" className="space-y-6 px-4 py-6 sm:px-6">
        <header className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-malachite-600/15">
            <ShieldCheck className="h-5 w-5 text-malachite-600" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Safety Center</h1>
            <p className="text-sm text-muted-foreground">
              How to trade, tour, and message safely on DormCheck.
            </p>
          </div>
        </header>

        <section aria-labelledby="safety-meet" className="rounded-xl border border-border bg-card p-4 shadow-raised space-y-2">
          <h2 id="safety-meet" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Users className="h-4 w-4 text-malachite-800" aria-hidden />
            Meeting up
          </h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
            <li>Meet in daylight in a busy public spot on or near campus.</li>
            <li>Bring a friend, or tell someone where you&apos;re going and when.</li>
            <li>For housing, always do an in-person or live video tour before any money moves.</li>
          </ul>
        </section>

        <section aria-labelledby="safety-pay" className="rounded-xl border border-border bg-card p-4 shadow-raised space-y-2">
          <h2 id="safety-pay" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <CreditCard className="h-4 w-4 text-malachite-800" aria-hidden />
            Payments
          </h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
            <li>Never send a deposit before you&apos;ve toured the place.</li>
            <li>Use traceable payment methods; avoid wire transfers and gift cards entirely.</li>
            <li>Be wary of anyone rushing you or moving the conversation off DormCheck.</li>
            <li>DormCheck never charges students and never asks you to pay another student on its behalf.</li>
          </ul>
        </section>

        <section aria-labelledby="safety-report" className="rounded-xl border border-border bg-card p-4 shadow-raised space-y-2">
          <h2 id="safety-report" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Flag className="h-4 w-4 text-malachite-800" aria-hidden />
            Report and block
          </h2>
          <p className="text-sm text-foreground">
            Every listing, profile, and message thread has a Report option, and every report is
            reviewed by the DormCheck team - you&apos;ll get a notification with the outcome.
            Blocking someone removes them from your feeds and messages instantly.
          </p>
          <Link
            to="/profile/blocked"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-malachite-800 underline-offset-2 hover:underline"
          >
            <Ban className="h-3.5 w-3.5" aria-hidden />
            Manage blocked accounts
          </Link>
        </section>

        {campusResources.length > 0 && (
          <section aria-labelledby="safety-campus" className="rounded-xl border border-border bg-card p-4 shadow-raised space-y-3">
            <h2 id="safety-campus" className="flex items-center gap-2 text-base font-semibold text-foreground">
              <MapPin className="h-4 w-4 text-malachite-800" aria-hidden />
              {university.shortName} resources
            </h2>
            <ul className="space-y-2.5">
              {campusResources.map((r) => (
                <li key={r.label}>
                  <a
                    href={r.href}
                    target={r.href.startsWith('http') ? '_blank' : undefined}
                    rel={r.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                    className="group flex items-start gap-2.5"
                  >
                    {r.href.startsWith('tel:') ? (
                      <Phone className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span>
                      <span className="block text-sm font-medium text-foreground group-hover:underline">
                        {r.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">{r.detail}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              In an emergency, always call 911 first.
            </p>
          </section>
        )}
      </PageContainer>
  );
}

/* The standalone page shell that used to back the `/safety` route was removed
   2026-08-05 with the route itself (vault `Reviews Subleases Services PRD.md`
   §5b). `SafetyCenterContent` above is the surviving export: SettingsView
   renders it inline as the Settings > Support doc, which is now the Safety
   Center's only home (see SAFETY_CENTER_PATH). The content is the concrete
   artifact for App Store guideline 1.2 and gains a sublease section in Phase 4 -
   it is deliberately NOT deleted. */
