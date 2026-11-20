import { useEffect } from "react";
import { useLocation } from "react-router";
import { BadgeCheck, CalendarClock, Sparkles, Store, Tag } from "lucide-react";
import { Reveal } from "@/components/marketing/landing/Reveal";
import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { ContactForm } from "@/components/marketing/ContactForm";
import { CheckList, PageHead, SectionHead, SiteCard, WRAP } from "@/components/marketing/landing/ui";
import { RouteMeta } from "@/components/seo/RouteMeta";
import { pageTitle } from "@/lib/seo";

/**
 * /partners (audience isolation 2026-07-12): brands and local businesses ONLY.
 * Universities have their own page and their own pilot form on
 * /for-universities; nothing here routes them or names any campus. No school
 * names anywhere on this page. Monetization framing only, never dollar
 * figures; students are never charged.
 */

const AUDIENCES = [
  {
    icon: <Tag className="h-5 w-5" />,
    title: "Brands",
    body: "Student-focused brands that want to reach a verified, on-campus audience without buying junk impressions.",
    points: [
      "Real, school-verified students",
      "Reach them at move-in, the buying moment",
      "Clearly labeled, never disguised as a student",
    ],
  },
  {
    icon: <Store className="h-5 w-5" />,
    title: "Local businesses",
    body: "The furniture spot, the storage unit, the food place by campus: the businesses students already need.",
    points: [
      "Target a specific campus",
      "Show up when students are shopping",
      "Simple and local, no agency needed",
    ],
  },
];

const WHY = [
  {
    icon: <BadgeCheck className="h-5 w-5" />,
    title: "An audience you can't fake your way into",
    body: "Every account is a student verified with a school email. Your budget reaches real people on a real campus, not bots, recycled impressions, or clicks that were never going to convert.",
  },
  {
    icon: <CalendarClock className="h-5 w-5" />,
    title: "The moment they're actually buying",
    body: "Students plan their whole move-in on DormCheck, from the first packing list to the last pickup. You reach them exactly when they're furnishing a room and setting up their year, not months before or after.",
  },
  {
    icon: <Sparkles className="h-5 w-5" />,
    title: "A place students already trust",
    body: "DormCheck isn't a spam feed, so placements get noticed instead of scrolled past. Yours runs clean and clearly labeled, in a product students actually open every day of move-in season.",
  },
];

export default function Partners() {
  const { hash } = useLocation();

  // Router navigation to /partners#contact does not auto-scroll; do it here.
  useEffect(() => {
    if (hash === "#contact") {
      document.getElementById("contact")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [hash]);

  return (
    <div className={PAGE}>
      {/* `/partners#contact` is the same page as `/partners`; the hash is
          stripped from the canonical. */}
      <RouteMeta title={pageTitle("Partners")} />
      <AuroraField />
      <div className={WRAP}>
        <PageHead eyebrow="Partners" title="Reach verified students where they actually are.">
          Students setting up their dorms are hard to reach and easy to waste budget on. DormCheck
          puts your brand in front of verified students at the moment they&apos;re actually buying,
          and stays free for them because partners fund it, never the students.
        </PageHead>

        <div className="mx-auto grid max-w-[880px] gap-4 py-16 md:grid-cols-2 md:py-20">
          {AUDIENCES.map((a, i) => (
            <Reveal key={a.title} delay={i * 100}>
              <SiteCard icon={a.icon} title={a.title}>
                <p>{a.body}</p>
                <CheckList items={a.points} className="mt-3" itemClassName="text-[14px] py-1" />
              </SiteCard>
            </Reveal>
          ))}
        </div>

      </div>

      <section className="pb-4">
        <div className={WRAP}>
          <Reveal>
            <SectionHead eyebrow="Why it works" title="Reach that's worth paying for." className="mb-10">
              Verified students, caught at the one moment they&apos;re buying, in a product they open
              every day of move-in. That combination is hard to find anywhere else.
            </SectionHead>
          </Reveal>
          <div className="grid gap-4 md:grid-cols-3">
            {WHY.map((c, i) => (
              <Reveal key={c.title} delay={i * 100}>
                <SiteCard icon={c.icon} title={c.title}>
                  {c.body}
                </SiteCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="scroll-mt-24 bg-malachite-50 py-20 md:py-24" id="contact">
        <div className={WRAP}>
          <Reveal>
            <SectionHead eyebrow="Get in touch" title="Let's get you in front of them." align="left" className="mb-8">
              Tell us who you&apos;re trying to reach. We&apos;ll come back with how it would work for
              you, usually within a day.
            </SectionHead>
          </Reveal>
          <div className="mx-auto grid max-w-[720px] gap-6">
            <div className="rounded-[22px] border border-stone-900/5 bg-white p-6 shadow-[0_18px_60px_-30px_rgba(15,23,42,0.22)] md:p-8">
              <ContactForm
                inquiryTypes={["Brand", "Local business", "Press", "Other"]}
                orgPlaceholder="Brand / business"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
