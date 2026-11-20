import { Link } from "react-router";
import { Users, LifeBuoy } from "lucide-react";
import { Reveal } from "@/components/marketing/landing/Reveal";
import { PageHead, SiteCard, WRAP } from "@/components/marketing/landing/ui";
import { RouteMeta } from "@/components/seo/RouteMeta";
import { pageTitle } from "@/lib/seo";

/**
 * /contact (marketing site 2026-07): a lightweight, Granola-style help/feedback
 * hub kept OUT of the Partners page (Ethan 2026-07-08). Two cards, each routing
 * to its own form: partnerships -> /partners, help/feedback -> /feedback (posts
 * to /api/contact kind:'support' -> support@dormcheck.com). The plain
 * support@dormcheck.com mailto stays as a lightweight "something else" fallback.
 */
const SUPPORT_MAILTO = "mailto:support@dormcheck.com?subject=DormCheck%20help%20%26%20feedback";

const inlineLink =
  "font-extrabold text-malachite-800 underline-offset-4 hover:underline";

export default function Contact() {
  return (
    <div className="bg-tint-50 text-stone-900">
      <RouteMeta title={pageTitle("Contact us")} />
      <section className="pb-8 pt-8 md:pt-14">
        <div className={WRAP}>
          <PageHead eyebrow="Get in touch" title="Contact us">
            Partnerships, help, or feedback: pick the one that fits and we will get back to you.
          </PageHead>
        </div>
      </section>

      <section className="pb-16">
        <div className={WRAP}>
          <Reveal>
            <div className="mx-auto grid max-w-[820px] gap-5 md:grid-cols-2">
              <SiteCard icon={<Users className="h-5 w-5" />} title="Want DormCheck for your school?">
                <p className="mb-4">
                  For universities, brands, and local businesses looking to work with us.
                </p>
                <Link to="/partners" className={inlineLink}>
                  Talk with our team →
                </Link>
              </SiteCard>

              <SiteCard icon={<LifeBuoy className="h-5 w-5" />} title="Need help or have feedback?">
                <p className="mb-4">
                  Questions, bugs, or ideas from students. Real replies, usually within a day.
                </p>
                <Link to="/feedback" className={inlineLink}>
                  Send us a message →
                </Link>
              </SiteCard>
            </div>
          </Reveal>

          <p className="mx-auto mt-8 max-w-[820px] text-center text-[15px] font-semibold text-stone-600">
            Something else? Reach us any time at{" "}
            <a href={SUPPORT_MAILTO} className={inlineLink}>
              support@dormcheck.com
            </a>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
