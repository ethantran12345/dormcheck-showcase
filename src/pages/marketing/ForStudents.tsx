import { Link } from "react-router";
import { ClipboardCheck, MessageSquare, ShoppingBag } from "lucide-react";
import { Reveal } from "@/components/marketing/landing/Reveal";
import { Tilt } from "@/components/marketing/landing/motion";
import { AuroraField, Drift, PAGE } from "@/components/marketing/landing/atmosphere";
import { CapabilityRow, ProductCard } from "@/components/marketing/landing/mockups";
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

/**
 * /for-students (page-differentiation pass 2026-07-12): the self-serve student
 * pitch, in student language. This page exclusively owns: the day-in-the-life
 * use cases, the .edu verification explainer, the student FAQ, and the
 * "You will never pay a cent" section. The lifecycle walkthrough
 * (`FeatureShowcase`) lives only on the homepage now; /how-it-works and
 * /features still redirect here.
 */

const MOMENTS = [
  {
    icon: <ClipboardCheck className="h-5 w-5" />,
    title: "Move-in week",
    body: "Your checklist already knows your hall. No AC? Fan's on the list. Twin XL? Bedding's right. Split the fridge with your roommate before either of you buys one.",
  },
  {
    icon: <MessageSquare className="h-5 w-5" />,
    title: "The semester",
    body: "Your floor chat is where the Target runs, the laundry intel, and the who-has-a-ladder questions actually get answered. Real neighbors, auto-joined.",
  },
  {
    icon: <ShoppingBag className="h-5 w-5" />,
    title: "Move-out",
    body: "List your whole setup in minutes and sell to students staying on campus. Pickup down the hall beats shipping a futon home.",
  },
];

const FAQS = [
  {
    q: "Is it really free?",
    a: "Yes. No subscriptions, no listing fees, no premium tier. DormCheck is funded by universities, brands, and local businesses, never by students.",
  },
  {
    q: "Who can see my listings and chats?",
    a: "Only verified students at your own school. Listings and chats never appear to the public internet, and contact details stay private until you choose to share them.",
  },
  {
    q: "What if my school isn't on DormCheck yet?",
    a: "Join the waitlist and we'll tell you the moment your campus goes live. Schools with the most waitlist signups come first.",
  },
  {
    q: "Do I need anything besides my school email?",
    a: "No. Your school email is the whole gate. Sign in with it once and you're verified.",
  },
];

export default function ForStudents() {
  return (
    <div className={PAGE}>
      <RouteMeta title={pageTitle("For students")} />
      <AuroraField />
      <section className="pb-14 pt-10 md:pb-32 md:pt-16">
        <div className={`${WRAP} grid items-center gap-10 md:grid-cols-2`}>
          <div>
            <h1 className="font-serif text-[clamp(44px,6vw,80px)] font-semibold leading-[1.08]">
              Moved in before <em className="italic">you move in</em>.
            </h1>
            <p className="mt-4 max-w-[44ch] text-lg text-stone-700">
              Skip the group-chat chaos and the sketchy resellers. DormCheck is just the students
              at your school, in one place, for free.
            </p>
            <div className="mt-7 flex flex-wrap gap-3.5">
              <PrimaryCta to="/auth">Get started free</PrimaryCta>
              <GhostCta to="/waitlist">Bring it to your campus</GhostCta>
            </div>
            <p className="mt-4 text-sm text-stone-600">
              Don&apos;t see your school?{" "}
              <Link
                to="/waitlist"
                className="font-semibold text-malachite-800 underline-offset-2 hover:text-malachite-900 hover:underline"
              >
                Join the waitlist
              </Link>
            </p>
          </div>
          <Drift>
            <Tilt max={4}>
              <div aria-hidden="true" className="relative">
                <ProductCard icon="✓" title="Move-in checklist" tag="Your hall" className="p-6 shadow-overlay shadow-stone-900/5">
                  <CapabilityRow label="Hall-aware guidance" detail="Your residence rules shape what appears on the list." />
                  <CapabilityRow label="Roommate coordination" detail="Claim and split items without duplicate purchases." />
                </ProductCard>
                <ProductCard
                  icon="💬"
                  title="Floor chat · 7th"
                  tag="Students only"
                  className="mt-4 -rotate-1 p-5 shadow-overlay shadow-stone-900/5 md:absolute md:-bottom-28 md:-right-8 md:mt-0 md:w-[64%]"
                >
                  <CapabilityRow label="Verified membership" detail="Building conversations are limited to eligible students." />
                  <CapabilityRow label="Conversation controls" detail="Message, react, report, or block from one place." />
                </ProductCard>
              </div>
            </Tilt>
          </Drift>
        </div>
      </section>

      {/* Day in the life: the year, in three moments */}
      <section className="pb-24">
        <div className={WRAP}>
          <Reveal>
            <SectionHead
              eyebrow="A year with DormCheck"
              title={<>From packing list to <span className="whitespace-nowrap">pickup line</span>.</>}
              className="mb-10"
            >
              The right tool shows up at the right moment, from the day you commit to the day you
              hand over your keys.
            </SectionHead>
          </Reveal>
          <div className="grid gap-4 md:grid-cols-3">
            {MOMENTS.map((c, i) => (
              <Reveal key={c.title} delay={i * 100}>
                <SiteCard icon={c.icon} title={c.title}>
                  {c.body}
                </SiteCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* .edu verification explainer */}
      <section className="pb-24" id="verified">
        <div className={WRAP}>
          <Reveal>
            <div className="grid items-center gap-10 rounded-[22px] border border-stone-900/5 bg-white px-8 py-10 shadow-[0_10px_36px_-16px_rgba(15,23,42,0.16)] md:grid-cols-[1fr_0.8fr] md:px-12">
              <div>
                <SectionHead eyebrow="One gate" title="Your school email is the bouncer." align="left">
                  Everyone on DormCheck signed in with a verified email from your school. No bots,
                  no resellers, no strangers from the open internet. Just the people who actually
                  live in your buildings.
                </SectionHead>
              </div>
              <div className="flex flex-col items-center gap-4" aria-hidden="true">
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-malachite-100 text-xl font-black text-malachite-800">
                    ✓
                  </span>
                  <span className="rounded-full bg-tint-100 px-4 py-2 text-base font-extrabold text-stone-700">
                    you@school.edu
                  </span>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {["No bots", "No resellers", "Only your campus"].map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full border border-malachite-600/20 bg-malachite-50 px-3 py-1.5 text-[13px] font-extrabold text-malachite-900"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Student FAQ */}
      <section className="pb-24" id="faq">
        <div className={WRAP}>
          <Reveal>
            <SectionHead eyebrow="Questions" title="The stuff you'd actually ask." className="mb-10" />
          </Reveal>
          <div className="mx-auto grid max-w-[880px] gap-4 md:grid-cols-2">
            {FAQS.map((f, i) => (
              <Reveal key={f.q} delay={i * 80}>
                <div className="h-full rounded-[22px] border border-stone-900/5 bg-white p-6 shadow-[0_10px_36px_-16px_rgba(15,23,42,0.16)]">
                  <h3 className="font-serif text-[19px] font-semibold leading-snug text-stone-900">{f.q}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-stone-600">{f.a}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* The one rule: this page is the only home of "never pay a cent" */}
      <Reveal>
        <ClosingCta
          tone="malachite"
          title="You will never pay a cent."
          sub="DormCheck is free for students, forever. No subscriptions, no listing fees. Your school email is the only thing you bring."
        >
          <PrimaryCta to="/auth">Get started free</PrimaryCta>
          <GhostCta to="/waitlist">Bring DormCheck to your campus</GhostCta>
        </ClosingCta>
      </Reveal>
    </div>
  );
}
