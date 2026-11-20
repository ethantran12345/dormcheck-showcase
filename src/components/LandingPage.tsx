import { Link } from "react-router";
import { Reveal } from "@/components/marketing/landing/Reveal";
import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { PhoneDemo } from "@/components/marketing/landing/PhoneDemo";
import { StoreBadges } from "@/components/marketing/landing/StoreBadges";
import { VerifiedFlow } from "@/components/marketing/landing/VerifiedFlow";
import { CapabilityRow } from "@/components/marketing/landing/mockups";
import { AppWindow, Band, SplitBand } from "@/components/marketing/landing/bands";
import { FeatureCatalog } from "@/components/marketing/landing/FeatureCatalog";
import {
  GhostCta,
  PrimaryCta,
  WRAP,
} from "@/components/marketing/landing/ui";
import { TYPE } from "@/components/marketing/landing/tokens";
import { PageContainer } from "@/components/ui/page-container";
import { cn } from "@/lib/utils";

/**
 * Public marketing landing (`/`, logged-out web), Granola-inspired redesign
 * (2026-07): one seamless green-on-cream system. Hero with a live phone demo
 * of the real home screen, instant-comprehension strip, the interactive
 * lifecycle feature showcase, serif statement, always-free gradient block,
 * flag-gated testimonials, student/university split, boxed final CTA. Copy
 * stays school-agnostic - never name a specific university. Marketing chrome (`MarketingTopNav` +
 * `MarketingFooter`) is supplied by `LayoutWrapper`; the top nav is fixed over
 * the hero, so the hero carries its own top padding.
 */

/* ---------------- Hero ---------------- */

function Hero() {
  return (
    /* overflow-x-clip is the belt to the bleed's braces below: it can never
       engage at a width the clamp allows, but it guarantees the hero can not
       produce a horizontal scrollbar on the Capacitor WebView. `clip` rather
       than `hidden` so it does not become a scroll container (which would
       break position:sticky elsewhere) and leaves vertical overflow — the
       phone's float and shadow — untouched. */
    /* Mobile top padding only has to clear the fixed nav (~68px) plus a little
       air; 120px was a desktop number applied to a 844px-tall phone, where the
       hero was already 1353px — a screen and a half before the first feature.
       Desktop is untouched. */
    <header className="overflow-x-clip pb-14 pt-[92px] md:pb-32 md:pt-[150px]">
      <div className={cn(WRAP, "grid items-center gap-8 md:grid-cols-[1.32fr_0.68fr] md:gap-12")}>
        <div>
          <h1 className={cn("font-serif font-semibold leading-[1.08] tracking-[-0.01em] text-stone-900", TYPE.display)}>
            Move-in, <em className="italic text-malachite-800">without</em> the guesswork.
          </h1>
          <p className="mb-8 mt-5 max-w-[38ch] text-[19px] leading-relaxed text-stone-700">
            Checklist, marketplace, and building chats. Verified students at your school, nothing
            else.
          </p>
          <div className="flex flex-wrap items-center gap-3.5">
            <PrimaryCta to="/auth">Get started free</PrimaryCta>
            <GhostCta to="/for-universities">For housing teams</GhostCta>
          </div>
          <p className="mt-4 text-sm text-stone-500">
            <Link
              to="/waitlist"
              className="font-semibold text-malachite-800 underline-offset-2 hover:text-malachite-900 hover:underline"
            >
              Not on your campus yet? Join the waitlist
            </Link>
          </p>
          {/* Store badges sit inside the hero's left column, below the waitlist
              line — the conventional placement, and close enough to the CTAs to
              read as a third way in rather than a separate section. */}
          <StoreBadges className="mt-6" />
        </div>
        {/* THE one deliberate container break (PRD Phase 2 item 4, Ethan's
            decision 3 — and the only one on this page by constraint). The phone
            bleeds out of WRAP's 1160px measure into the page gutter instead of
            sitting inside it.

            The bleed is exactly HALF the available gutter, capped at 120px, and
            collapses to 0 the instant the viewport is narrower than WRAP. So it
            is self-limiting: it can never push the phone past the viewport edge
            and never needs clipping to stay safe — at 1440 it breaks out 120px,
            at 1280 it breaks out 60px, and at every width <=1160 (including the
            390x844 Capacitor baseline) it is exactly 0 and the phone sits
            centred in a single column as before. */}
        <PhoneDemo className="md:mr-[calc(-1*clamp(0px,(100vw-1160px)/2,120px))] md:justify-end" />
      </div>
    </header>
  );
}

/* ---------------- The alternating product bands (Slack-inspired pass) ----------------

   REPLACED the bento grid that used to sit here (a 6-col asymmetric tile grid
   of five bordered white cards). It was the single biggest reason the page read
   as "a box of boxes": every feature arrived as a small card on the same cream
   sheet, at the same width, at the same moment. Three full-bleed bands say the
   same three things at page scale instead — dark, cream, white — with the copy
   and the product window swapping sides each time. See bands.tsx for the
   mechanics (the outward bleed and the sticky copy column are load-bearing).   */

function ChecklistBand() {
  return (
    <SplitBand
      /* Concave, not convex: the CREAM below arcs UP into the band, which is
         what slack.com does mid-page. The convex version (band bulging down)
         is reserved for the page's closing block. Fill is `fill-tint-50`
         because MarketplaceBand, which follows, is cream. */
      curveBottomInset="fill-tint-50"
      tone="dark"
      eyebrow="The checklist"
      title={<>Everything you need, <em className="italic text-malachite-300">already listed</em>.</>}
      body="Your list is built from your actual building — not a generic packing article. Split it with your roommates so nobody brings a second mini fridge."
      bullets={[
        "Tuned to your hall's rules and what fits the room",
        "Claim an item and your roommates see it instantly",
        "Shop the exact thing, or bring it from home",
      ]}
      footer={
        <Link
          to="/for-students"
          className="inline-flex items-center gap-2 text-[15px] font-extrabold text-malachite-300 transition-colors hover:text-white motion-reduce:transition-none"
        >
          See the student side
          <span aria-hidden="true">→</span>
        </Link>
      }
      visual={
        <AppWindow bleed="right" title="Your checklist" meta="Move-in week">
          <CapabilityRow label="Building-aware list" detail="Guidance follows your assigned residence hall." />
          <CapabilityRow label="Shared ownership" detail="Roommates can claim items and coordinate purchases." />
          <CapabilityRow label="Move-in through move-out" detail="Planning, packing, and handoff stay in one workspace." />
        </AppWindow>
      }
    />
  );
}

function MarketplaceBand() {
  return (
    <SplitBand
      flip
      tone="cream"
      eyebrow="The marketplace"
      title={<>Buy and sell with the people <em className="italic">down the hall</em>.</>}
      body="A fridge that only has to travel one floor beats a fridge that has to be shipped. Every seller is a verified student at your school, so pickup is a walk, not a risk."
      bullets={[
        "Nobody outside your campus can see or message you",
        "Meet in the lobby, not a parking lot",
        "List your whole setup in one pass at move-out",
      ]}
      visual={
        <AppWindow bleed="left" title="Marketplace" meta="Your building">
          <CapabilityRow label="Verified campus access" detail="Only eligible students can browse or contact sellers." />
          <CapabilityRow label="Student-controlled listings" detail="Create, edit, mark sold, relist, or remove your post." />
          <CapabilityRow label="Built-in safety tools" detail="Save, report, block, and message without exposing contact details." />
        </AppWindow>
      }
    />
  );
}

function ChatsBand() {
  return (
    <SplitBand
      tone="white"
      eyebrow="Building chats"
      title={<>Your floor already has a <em className="italic">group chat</em>.</>}
      body="You are auto-joined to your building and floor the moment you verify. No invite link to chase, no group of strangers, no one who does not go here."
      bullets={[
        "Students only, checked against a school email",
        "Your hall, your floor, and your roommates, separately",
        "Notices from housing land in the same place",
      ]}
      visual={
        <AppWindow bleed="right" title="Floor chat · 7th" meta="Students only">
          <CapabilityRow label="Building channels" detail="Membership follows verified housing context and tenant rules." />
          <CapabilityRow label="Direct and group messages" detail="Photos, voice messages, polls, and reactions share one timeline." />
          <CapabilityRow label="Privacy controls" detail="Reporting and blocking are available from the conversation." />
        </AppWindow>
      }
    />
  );
}

/* Journey / FeatureShowcase DELETED 2026-08-04. It was a four-step interactive
   "Move in · Live · Your building in your pocket · Move out" showcase whose panels
   rendered the SAME checklist, marketplace and chat mockups the three product bands
   above now render at full page scale. Two passes over identical material is not
   reinforcement, it is the reader learning that this page repeats itself — and it cost
   ~780px of scroll to say nothing new. `FeatureShowcase.tsx` is left in the tree: it is
   a real interactive component and the interior pages can still use it.

   SocialProof (the two-row "Built on trust" marquee) is deleted from this page for the
   same reason: all eight of its pills — verified with a school email, students only,
   always free, your building your people — are now the bullet lists inside the bands,
   in context, next to the feature they qualify. A marquee of the same eight claims
   above them was the page asserting trust before it had shown anything. */

/* Statement ("For the move-in ready" + "Always free for students. Always
   verified with a school email.") DELETED 2026-08-04 at the user's request. It
   was a full viewport of scroll spent on a headline that asserts a mood and a
   subline that repeats two claims already made as bullets inside the bands
   ("Nobody outside your campus can see or message you", "Students only, checked
   against a school email") and again by the Verified-by-design section directly
   below it. Big type is not the same thing as new information. Its `useScroll`
   scale/opacity entrance went with it — that is why this file no longer imports
   framer-motion or TYPE.

/* Testimonials section DELETED 2026-08-02. It held three invented students
   ("Maya R., Sophomore" and two others) behind SHOW_LANDING_TESTIMONIALS=false.
   Flag-gated fabricated social proof is still fabricated social proof, and it sat
   one boolean away from shipping on a product whose whole positioning is
   student-verified. The layout does not come back speculatively: it returns only
   with real, attributable pilot quotes, and then it gets designed against that
   content rather than retrofitted to a shape built for placeholders.
   See CLAUDE.md § Design system (never fabricate social proof). */

/* ---------------- Audience router (slim doorways to the two audience pages) ---------------- */

const AUDIENCE_ROUTES = [
  {
    eyebrow: "For students",
    title: "Everything for your room, one login.",
    line: "The checklist, the marketplace, and your building's chats.",
    to: "/for-students",
    cta: "See the student side",
  },
  {
    eyebrow: "For housing teams",
    title: "An extension of the systems you run.",
    line: "Readiness signals by building, with nothing to migrate.",
    to: "/for-universities",
    cta: "See the university side",
  },
];

function AudienceRouter() {
  return (
    /* Was two bordered white cards in a centred grid. Now the two doorways ARE
       the band: a single dark surface split down the middle by one hairline
       rule, each half edge-to-edge and clickable in full. No card, no shadow,
       no gap between them — the split is the design. The curve fill always
       matches whichever section sits directly above this one.

       Curve at the TOP here, at the BOTTOM on the checklist band — Slack's
       rhythm: a solid section near the top of the page bulges down into what
       follows, one near the bottom is dipped into from above. The fill is
       `fill-white` because ChatsBand (white) is what sits above it. */
    <Band
      tone="dark"
      id="students"
      /* Matches whatever sits directly above: the mint FeatureCatalog since
         2026-08-04 (it was `fill-white` when ChatsBand was the neighbour). */
      curveTop="fill-malachite-50"
      /* Tightened: this band is two short link blocks, not a feature section,
         so `Band`'s default mid-page rhythm left far more green than text.
         `curveTop` still forces enough top padding to clear its own wedge. */
      /* Only `pb-*`, never `py-*`: tailwind-merge resolves conflicts last-wins,
         so a `py-0` here would beat the `pt-[124px]` that `curveTop` adds and
         the wedge would slice the headings. */
      className="pb-4 md:pb-8"
    >
      {/* 1240px, not the `wide` role (1152px): the landing rides its own editorial
          rail, set with the band curves and mockup widths. Bespoke override. */}
      <PageContainer width="wide" className="grid max-w-[1240px] px-6 md:grid-cols-2">
        {AUDIENCE_ROUTES.map((a, i) => (
          <Link
            key={a.to}
            to={a.to}
            className={cn(
              /* NO panel-wide hover fill. Two versions were tried and both
                 were rejected: `hover:bg-white/[0.04]` desaturated the green
                 toward grey, and `hover:bg-malachite-500/15` kept the hue but
                 lit a 600px-wide slab, which is a lot of surface to change
                 under a cursor for what is really just a link. The hover now
                 lives entirely on the link line — its colour goes to white and
                 the arrow slides — which is the actual affordance. */
              "group relative flex flex-col justify-between py-10 md:py-14",
              i === 0
                ? "border-b border-white/10 md:border-b-0 md:border-r md:pr-14"
                : "md:pl-14",
            )}
          >
            <Reveal delay={i * 120}>
              <span className="text-[13px] font-extrabold uppercase tracking-[0.14em] text-malachite-300">
                {a.eyebrow}
              </span>
              <h3 className="mb-3 mt-3.5 font-serif text-[30px] font-semibold leading-tight text-white md:text-[34px]">
                {a.title}
              </h3>
              <p className="max-w-[38ch] text-base text-white/65">{a.line}</p>
              <span className="mt-7 inline-flex items-center gap-2 text-[15px] font-extrabold text-malachite-300 group-hover:text-white">
                {a.cta}
                <span
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
                >
                  →
                </span>
              </span>
            </Reveal>
          </Link>
        ))}
      </PageContainer>
    </Band>
  );
}

/* ---------------- Final CTA ---------------- */


function FinalCta() {
  return (
    /* The close, on the Slack pattern the user pointed at: a full-bleed DARK
       block whose bottom edge is a shallow convex arc, with a solid light
       primary and an outlined secondary side by side.

       THE ARC IS AN SVG WEDGE BELOW THE BLOCK — fourth construction, and the
       three before it all failed on the same axis: how much dark sits under the
       buttons.
         1. `rounded-b-[50%_Npx]` — the two corner ellipses meet at the centre so
            the edge is genuinely one curve, but flattened that far it bunches
            all its curvature into the last few percent at either end. A flat
            middle between two abrupt upturns. No depth value fixes that; the
            defect is curvature DISTRIBUTION.
         2. A wide `rounded-[50%]` overhanging ellipse — even curvature at last,
            but widening an ellipse flattens it fast, so the first values gave an
            18px drop that read as a straight line with rounded ends.
         3. The same ellipse narrowed and doubled in height — the drop was right
            (67px) but an ellipse hung by `translate-y-1/2` puts its CENTRE on
            the block's bottom edge, so its rim sat ~134px below that edge across
            the whole width. The arc looked correct and the block was still
            swimming in green, because the dark area under the buttons is the
            overhang, not the drop.

       An SVG wedge decouples the two. `M0 0 Q500 200 1000 0 Z` in a
       `viewBox="0 0 1000 100"` with `preserveAspectRatio="none"`: the quadratic
       sits at y=0 (flush with the block's bottom edge) at both page edges and
       reaches y=100 — the wedge's full height — at the centre. So **the wedge's
       height IS the arc's depth, and there is no extra dark anywhere.** One
       number, `h-[72px]`, and `mb-[72px]` reserves exactly it because the wedge
       hangs entirely below the block (`top-full`). Change one, change the other.

       The section still must NOT clip — `overflow-hidden` would cut the wedge
       off — and the gradient stays vertical, settling on flat `malachite-900`
       to match the wedge's fill, so there is no seam at the join. **This block
       hand-rolls its surface rather than using `Band`, so it does NOT inherit
       `BAND_BG.dark` — when the dark scale moves, BOTH have to move.** They
       drifted apart exactly once (the bands lightened to 900/800/900 while this
       stayed on 950) and the close visibly did not match the rest of the page.

       - The primary is WHITE on the dark block. Our usual `malachite-800` pill
         would be a green button on a green field with almost no separation;
         inverting is what makes it the loudest thing on the page, which the
         final CTA should be.
       - No `Band` here: Band clips its children and its vertical rhythm is tuned
         for mid-page sections. */
    <section className="relative mb-[72px] bg-gradient-to-b from-malachite-900 via-malachite-800 to-malachite-900 px-6 pb-7 pt-12 text-center md:pb-8 md:pt-14">
      <svg
        aria-hidden="true"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-x-0 top-full h-[72px] w-full fill-malachite-900"
      >
        <path d="M0 0 Q500 200 1000 0 Z" />
      </svg>
      <Reveal className="relative">
        {/* Deliberately NOT TYPE.h2 and deliberately a wide measure. Slack's
            closing headline is one line at a modest size; ours was running the
            page's full section-heading scale at `max-w-[18ch]`, so it wrapped
            to two tall serif lines and, with generous padding above and below,
            made the block ~500px deep. That HEIGHT was what read as "thick" —
            the arc was a red herring across two rounds of feedback. One line at
            44px plus tight padding brings the block to roughly Slack's ~300px,
            which is what makes the shallow arc legible as a shallow arc. */}
        <h2 className="mx-auto max-w-[30ch] font-serif text-[34px] font-medium leading-[1.1] text-white md:text-[44px]">
          Ready to figure out your dorm?
        </h2>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3.5">
          <Link
            to="/auth"
            className="inline-flex items-center rounded-pill bg-white px-7 py-3.5 text-base font-extrabold text-malachite-900 transition-all hover:-translate-y-0.5 hover:bg-malachite-50 hover:shadow-overlay active:translate-y-0 active:scale-[0.97] motion-reduce:transition-none"
          >
            Get started free
          </Link>
          <Link
            to="/for-universities"
            className="inline-flex items-center rounded-pill border border-white/45 px-7 py-3.5 text-base font-extrabold text-white transition-all hover:-translate-y-0.5 hover:border-white hover:bg-malachite-500/15 active:translate-y-0 active:scale-[0.97] motion-reduce:transition-none"
          >
            For housing teams
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

export function LandingPage() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <Hero />
      <ChecklistBand />
      <MarketplaceBand />
      <ChatsBand />
      {/* Breadth after depth: the three bands above show three features at page
          scale, which is what sells them but cannot show range. The catalog is
          six more categories for the cost of one band, and none of its panels
          repeat a band's mockup (see FeatureCatalog's header comment). */}
      <FeatureCatalog />
      {/* Order matters here and is not arbitrary: the audience router (dark)
          now sits ABOVE the verified section (mint), because the closing CTA
          became a dark block. Left as it was, two dark surfaces would have met
          with only the footer between them and the page would have ended on a
          single undifferentiated slab. Reordered it reads dark -> light -> dark,
          and the mint section gives the closing block something to arrive
          from. */}
      <AudienceRouter />
      <div className="bg-malachite-50">
        <VerifiedFlow />
      </div>
      <FinalCta />
    </div>
  );
}

export default LandingPage;
