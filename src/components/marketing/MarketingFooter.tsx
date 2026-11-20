import { Link } from "react-router";
import { SiInstagram, SiTiktok, SiX, SiFacebook } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa6";
import { PageContainer } from "@/components/ui/page-container";

/**
 * Marketing footer, logged-out web only (landing redesign 2026-07). Brand
 * column carries the locked tagline verbatim + the DormCheck social links
 * (added by Ethan 2026-07-08, mirroring the app `Footer.tsx` handles); the
 * bottom bar is the copyright line ("Built at" / "Not an official" / "Made in
 * Pittsburgh" lines removed by Ethan 2026-07-08; do not re-add here).
 */
const SOCIAL_LINKS = [
  { label: "Instagram @dormcheck_app", href: "https://www.instagram.com/dormcheck_app", Icon: SiInstagram },
  { label: "TikTok @dormcheck", href: "https://www.tiktok.com/@dormcheck", Icon: SiTiktok },
  { label: "LinkedIn @dormcheck", href: "https://www.linkedin.com/company/dormcheck", Icon: FaLinkedin },
  { label: "X (Twitter) @dormcheck", href: "https://x.com/dormcheck", Icon: SiX },
  { label: "Facebook @Dormcheck", href: "https://www.facebook.com/people/Dormcheck/61588622997141/", Icon: SiFacebook },
];
const PRODUCT_LINKS = [
  { label: "For students", to: "/for-students" },
  { label: "For universities", to: "/for-universities" },
];

const COMPANY_LINKS = [
  { label: "About", to: "/about" },
  { label: "Partners", to: "/partners" },
  { label: "Contact", to: "/contact" },
];

const LEGAL_LINKS = [
  { label: "Privacy", to: "/privacy" },
  { label: "Terms", to: "/terms" },
  { label: "Moderation", to: "/moderation" },
  { label: "Delete Account", to: "/delete-account" },
];

function FootColumn({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h5 className="mb-3.5 text-[13.5px] font-extrabold uppercase tracking-[0.08em] text-stone-600">{heading}</h5>
      <ul className="space-y-0">{children}</ul>
    </div>
  );
}

const footLink =
  "block py-1.5 text-sm font-semibold text-stone-700 transition-colors hover:text-malachite-800";

export function MarketingFooter() {
  return (
    <footer className="bg-tint-50 px-6 pb-10 pt-14 text-[14.5px]">
      {/* Socials sit ABOVE the hairline, hard right — Slack's arrangement, and
          the reason it works is hierarchy, not decoration: the link columns are
          navigation and the social row is not, so putting them in the same grid
          made five "Instagram, TikTok, LinkedIn…" icons compete with PRODUCT /
          COMPANY / LEGAL for the same reading. Above the rule they are a
          separate, lower-priority band. Right-aligned on desktop (nothing sits
          opposite them — we have no "Change Region"), centered on mobile where
          a lone right-aligned cluster reads like a mistake. */}
      <div className="mx-auto flex max-w-[1160px] justify-center md:justify-end">
        <div className="flex gap-5">
          {SOCIAL_LINKS.map(({ label, href, Icon }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="text-stone-600 transition-colors hover:text-malachite-800"
            >
              <Icon size={20} aria-hidden="true" />
            </a>
          ))}
        </div>
      </div>

      {/* Hairline ABOVE the link columns, not only above the copyright line
          (Slack's footer does the same). Without it the footer began wherever
          the previous section happened to stop, so the columns read as loose
          text on the page rather than as a footer. The rule is the footer's
          top edge; the existing one below is its bottom edge. */}
      <div className="mx-auto mb-14 mt-8 h-px max-w-[1160px] bg-stone-900/10" />
      {/* 1160px is the footer's own rail, deliberately narrower than the 1240px
          editorial rail above it so the footer reads as chrome, not one more band. */}
      <PageContainer width="wide" className="grid max-w-[1160px] grid-cols-2 gap-8 md:grid-cols-[1.8fr_1fr_1fr_1fr_1fr]">
        <div className="col-span-2 md:col-span-1">
          <Link to="/" className="inline-flex items-center gap-2 text-[20px] leading-none" aria-label="DormCheck home">
            <img
              src="/dormcheck-logo-new.png"
              alt=""
              draggable={false}
              className="h-7 w-7 shrink-0 select-none object-contain"
              onError={(e) => {
                e.currentTarget.src = "/dormcheck-logo.png";
              }}
            />
            <span className="brand-wordmark">DormCheck</span>
          </Link>
          <p className="mt-3.5 max-w-[30ch] font-semibold leading-relaxed text-stone-600">
            Everything students need to move in, live, and move out of college.
          </p>
        </div>

        <FootColumn heading="Product">
          {PRODUCT_LINKS.map((link) => (
            <li key={link.label}>
              <Link to={link.to} className={footLink}>
                {link.label}
              </Link>
            </li>
          ))}
        </FootColumn>
        <FootColumn heading="Company">
          {COMPANY_LINKS.map((link) => (
            <li key={link.label}>
              <Link to={link.to} className={footLink}>
                {link.label}
              </Link>
            </li>
          ))}
        </FootColumn>
        <FootColumn heading="Legal">
          {LEGAL_LINKS.map((link) => (
            <li key={link.label}>
              <Link to={link.to} className={footLink}>
                {link.label}
              </Link>
            </li>
          ))}
        </FootColumn>
        <FootColumn heading="Get started">
          <li>
            <Link to="/auth" className={footLink}>
              Sign in with your school email
            </Link>
          </li>
          <li>
            <Link to="/waitlist" className={footLink}>
              Bring DormCheck to your campus
            </Link>
          </li>
        </FootColumn>
      </PageContainer>

      {/* Copyright sits hard RIGHT (Slack's footer does the same). It was
          `justify-between` with a single child, which resolves to left — so the
          line sat alone under the brand column and read as one more orphaned
          piece of that column rather than as the page's closing rule. */}
      {/* Same 1160px footer rail as the columns above. */}
      <PageContainer width="wide" className="mt-11 flex max-w-[1160px] flex-wrap justify-center gap-2 border-t border-stone-900/10 pt-6 text-[13.5px] font-semibold text-stone-600 md:justify-end">
        <span>© DormCheck 2026</span>
      </PageContainer>
    </footer>
  );
}
