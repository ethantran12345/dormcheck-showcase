import { BarChart3, Check, Inbox, LockKeyhole, X } from "lucide-react";
import { Reveal } from "@/components/marketing/landing/Reveal";
import { Tilt } from "@/components/marketing/landing/motion";
import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { RouteMeta } from "@/components/seo/RouteMeta";
import { pageTitle } from "@/lib/seo";
import {
  ClosingCta,
  GhostCta,
  PrimaryCta,
  SectionHead,
  SiteCard,
  WRAP,
} from "@/components/marketing/landing/ui";
import { AdminDashboardDemo } from "@/components/marketing/AdminDashboardDemo";
import { ContactForm } from "@/components/marketing/ContactForm";

/**
 * /for-universities (NEW page, marketing site 2026-07, ported from the
 * approved mockup): the housing-team pitch. Distinct from /partners by
 * product decision (see docs/DECISIONS.md 2026-07-07): this page sells the
 * extension-not-replacement story; /partners is the universities/brands/local
 * umbrella that holds the contact form. Readiness numbers are illustrative
 * and aggregate only, never individual student data.
 */

function ReadinessCapability({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="border-t border-white/10 py-3 first:border-t-0">
      <p className="text-sm font-extrabold text-white">{title}</p>
      <p className="mt-1 text-xs font-semibold leading-relaxed text-white/70">{detail}</p>
    </div>
  );
}

export default function ForUniversities() {
  return (
    <div className={PAGE}>
      <RouteMeta title={pageTitle("For universities")} />
      <AuroraField />
      {/* deep green hero: the marketing site's single dark moment */}
      <section className="bg-gradient-to-br from-malachite-900 to-malachite-950 py-16 text-white md:py-20">
        <div className={`${WRAP} grid items-center gap-10 md:grid-cols-2`}>
          <div>
            <span className="text-[13px] font-extrabold uppercase tracking-[0.14em] text-malachite-300">
              For universities
            </span>
            <h1 className="mt-3 font-serif text-[clamp(44px,6vw,80px)] font-semibold leading-[1.08] text-white">
              An extension of the systems <em className="italic">you already run</em>.
            </h1>
            <p className="mt-4 max-w-[46ch] text-lg text-white/85">
              Students show up to move-in more prepared, your front desk fields fewer repeat
              questions, and your team finally sees how each building is tracking. No data import,
              no new system to run.
            </p>
            <div className="mt-7">
              <PrimaryCta href="#contact" className="bg-white text-malachite-900 shadow-none hover:bg-malachite-50">
                Talk to us about a pilot
              </PrimaryCta>
            </div>
          </div>
          <Tilt max={3}>
            <div className="rounded-editorial border border-white/15 bg-white/5 p-6">
              <div className="mb-3 flex items-center justify-between text-[12px] font-bold text-malachite-200">
                <span>Move-in readiness</span>
                <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-malachite-300/80">
                  By building
                </span>
              </div>
              <ReadinessCapability title="Readiness by building" detail="Aggregate progress without exposing individual student activity." />
              <ReadinessCapability title="Adoption and activation" detail="Understand whether students are reaching useful product outcomes." />
              <ReadinessCapability title="Operational follow-up" detail="See where additional communication or support may be useful." />
            </div>
          </Tilt>
        </div>
      </section>

      {/* Live admin-dashboard demo: what a housing director actually gets */}
      <section className="py-20 md:py-24">
        <div className={WRAP}>
          <Reveal>
            <SectionHead
              eyebrow="Your dashboard"
              title="This is what your team sees."
              className="mb-10"
              eyebrowClassName="text-stone-500"
            >
              A live operator view of adoption, activation, and where each building stands, without
              touching your existing systems.
            </SectionHead>
          </Reveal>
          <Reveal delay={100}>
            <AdminDashboardDemo />
          </Reveal>
        </div>
      </section>

      <section className="pb-20 md:pb-28">
        <div className={WRAP}>
          <Reveal>
            <SectionHead
              eyebrow="Why housing teams keep it"
              title="Less noise. Better move-ins."
              className="mb-10"
              eyebrowClassName="text-stone-500"
            />
          </Reveal>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                icon: <BarChart3 className="h-5 w-5" />,
                title: "Readiness by building",
                body: "See which halls are ready and which still have questions, before move-in day rather than during it.",
              },
              {
                icon: <Inbox className="h-5 w-5" />,
                title: "A quieter front desk",
                body: "The what-do-I-bring, who's-my-roommate, is-there-AC questions get answered in the app, not at your counter.",
              },
              {
                icon: <Check className="h-5 w-5" />,
                title: "No IT project",
                body: "No data import and no new system to run. It layers on top of the tools your team already uses.",
              },
            ].map((c, i) => (
              <Reveal key={c.title} delay={i * 100}>
                <SiteCard icon={c.icon} title={c.title}>
                  {c.body}
                </SiteCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Data handling: aggregate only, shown as a see / never-see contrast */}
      <section className="pb-20">
        <div className={WRAP}>
          <Reveal>
            <div className="rounded-editorial border border-stone-900/5 bg-white p-8 shadow-[0_10px_36px_-16px_rgba(15,23,42,0.16)] md:p-12">
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-malachite-100 text-malachite-800" aria-hidden="true">
                  <LockKeyhole className="h-6 w-6" />
                </span>
                <div>
                  <h2 className="font-serif text-[clamp(26px,3.2vw,36px)] font-semibold leading-[1.1] text-stone-900">
                    Aggregate signals. Never individual student data.
                  </h2>
                  <p className="mt-2 text-base text-stone-600">
                    Students own their data. Your team sees the patterns that help you plan, and
                    nothing else.
                  </p>
                </div>
              </div>
              <div className="mt-8 grid gap-6 md:grid-cols-2 md:gap-10">
                <div>
                  <p className="text-[13px] font-extrabold uppercase tracking-[0.12em] text-malachite-800">
                    What your team sees
                  </p>
                  <ul className="mt-3 space-y-2.5">
                    {[
                      "Readiness and adoption by building",
                      "Trends across move-in season",
                      "Where students get stuck, in aggregate",
                    ].map((t) => (
                      <li key={t} className="flex items-start gap-2.5 text-[15px] font-semibold text-stone-700">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-malachite-700" strokeWidth={3} aria-hidden="true" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[13px] font-extrabold uppercase tracking-[0.12em] text-stone-400">
                    What it never touches
                  </p>
                  <ul className="mt-3 space-y-2.5">
                    {[
                      "Any named student's checklist",
                      "Private messages or listings",
                      "Anything synced into your records",
                    ].map((t) => (
                      <li key={t} className="flex items-start gap-2.5 text-[15px] font-semibold text-stone-500">
                        <X className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" strokeWidth={3} aria-hidden="true" />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="pb-24" id="pilot">
        <div className={WRAP}>
          <Reveal>
            <SectionHead
              eyebrow="What a pilot looks like"
              title="Live in weeks, not semesters."
              className="mb-10"
              eyebrowClassName="text-stone-500"
            >
              No procurement marathon, no integration project. A pilot is three steps.
            </SectionHead>
          </Reveal>
          <div className="relative grid gap-4 md:grid-cols-3">
            {[
              {
                step: "1",
                title: "We set up your campus",
                body: "We load your residence halls from public information and your team confirms the details. Nothing to install.",
              },
              {
                step: "2",
                title: "Students verify and move in",
                body: "Students sign in with their school email and get building-matched checklists, chats, and the marketplace. It spreads hall by hall.",
              },
              {
                step: "3",
                title: "Your team watches it land",
                body: "See readiness by building through move-in, then decide from real signals whether to keep going.",
              },
            ].map((c, i) => (
              <Reveal key={c.step} delay={i * 100} className="relative">
                <div className="h-full rounded-editorial border border-stone-900/5 bg-white p-6 shadow-[0_10px_36px_-16px_rgba(15,23,42,0.16)]">
                  <span className="relative z-10 grid h-11 w-11 place-items-center rounded-full bg-malachite-800 font-serif text-xl font-semibold text-white ring-4 ring-tint-50" aria-hidden="true">
                    {c.step}
                  </span>
                  <h3 className="mt-3 font-serif text-[19px] font-semibold leading-snug text-stone-900">{c.title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-stone-600">{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How it's funded. States the model and routes to the same #contact form
          as every other CTA on the page. */}
      <section className="scroll-mt-24 pb-20 md:pb-24" id="funding">
        <div className={WRAP}>
          <Reveal>
            <SectionHead
              eyebrow="How it's funded"
              title="Students never pay. That is the whole model."
              className="mb-10"
              eyebrowClassName="text-stone-500"
            >
              Every student feature is free to every student, at every school, permanently.
              Dormcheck is funded by the institutions and partners who get value from it, never by
              the students who use it.
            </SectionHead>
          </Reveal>
          <Reveal delay={100}>
            <div className="mx-auto grid max-w-[820px] gap-4 md:grid-cols-3">
              {[
                {
                  title: "Free to students, always",
                  body: "No student account, feature, or listing is ever behind a payment. There is no upsell we are holding back.",
                },
                {
                  title: "Funded by institutions and partners",
                  body: "Housing teams fund the operator side. Local businesses and brands reach students through clearly marked listings.",
                },
                {
                  title: "Scoped to your campus",
                  body: "What a pilot costs depends on your halls, your timing, and how far you want it to reach. We'll put it in writing.",
                },
              ].map((c) => (
                <div
                  key={c.title}
                  className="h-full rounded-editorial border border-stone-200 bg-white p-6 shadow-flat"
                >
                  <h3 className="font-serif text-[19px] font-semibold leading-snug text-stone-900">
                    {c.title}
                  </h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-stone-600">{c.body}</p>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={200}>
            <p className="mt-8 text-center text-[15px] text-stone-600">
              Want the specifics for your campus?{" "}
              <a
                href="#contact"
                className="font-extrabold text-malachite-800 underline underline-offset-4 hover:text-malachite-900"
              >
                Ask us and we&apos;ll walk you through it
              </a>
              .
            </p>
          </Reveal>
        </div>
      </section>

      {/* The one full extension-not-replacement treatment on the site */}
      <Reveal>
        <ClosingCta
          tone="malachite"
          title="We don't replace the systems you already run."
          sub="Those systems run housing. DormCheck runs the last mile, the student's actual move-in, and hands your team the visibility that falls through the cracks between them."
        >
          <PrimaryCta href="#contact">Talk to us about a pilot</PrimaryCta>
          <GhostCta to="/">See how it works</GhostCta>
        </ClosingCta>
      </Reveal>

      {/* Pilot inquiries stay on this page: universities never route through /partners. */}
      <section className="scroll-mt-24 bg-malachite-50 py-20 md:py-24" id="contact">
        <div className={WRAP}>
          <Reveal>
            <SectionHead eyebrow="Start the conversation" title="Tell us about your campus." align="left" className="mb-8">
              A short note is plenty. We&apos;ll reply with what a pilot would look like for your
              halls, usually within a day.
            </SectionHead>
          </Reveal>
          <div className="mx-auto grid max-w-[720px] gap-6">
            <div className="rounded-editorial border border-stone-900/5 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.22)] md:p-8">
              <ContactForm
                inquiryTypes={["University / housing team"]}
                orgLabel="University"
                orgPlaceholder="Your university"
                messageLabel="What would you want out of a pilot?"
                messagePlaceholder="A sentence or two about your campus and timing..."
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
