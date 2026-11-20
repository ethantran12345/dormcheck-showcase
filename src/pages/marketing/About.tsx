import { useState } from "react";
import { FaLinkedin, FaXTwitter } from "react-icons/fa6";
import { Reveal } from "@/components/marketing/landing/Reveal";
import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { ClosingCta, Eyebrow, GhostCta, PrimaryCta, WRAP } from "@/components/marketing/landing/ui";
import { Band } from "@/components/marketing/landing/bands";
import { TYPE } from "@/components/marketing/landing/tokens";
import founderImg from "@/assets/founder.jpg";
import { PageContainer } from "@/components/ui/page-container";
import { RouteMeta } from "@/components/seo/RouteMeta";
import { pageTitle } from "@/lib/seo";

/**
 * /about (marketing site 2026-07, ported from the approved mockup): the
 * founding story, verbatim from the approved copy, with the founder photo
 * (initials fallback) and the three operating principles.
 */
const PRINCIPLES = [
  {
    title: "Students first, always",
    body: "Every decision runs through one test: does it keep DormCheck free and genuinely useful for the student? If not, we don't ship it.",
  },
  {
    title: "Verified, not viral",
    body: "One school email is the only way in. No bots, no resellers, no strangers. Just the students who actually live in your building.",
  },
  {
    title: "Built with campus, not against it",
    body: "DormCheck extends the tools universities already use. We make housing teams' lives easier, we don't compete with them.",
  },
];

export default function About() {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className={PAGE}>
      <RouteMeta title={pageTitle("About")} />
      <AuroraField />
      <div className={WRAP}>
        {/* 880px: a centred title measure, narrower than any named role — this is
            a headline block, not a body. Documented bespoke override. */}
        <PageContainer width="wide" className="max-w-[880px] pt-10 text-center md:pt-16">
          <Eyebrow>About</Eyebrow>
          <h1 className={`mt-3 font-serif font-medium leading-[1.05] text-stone-900 ${TYPE.display}`}>
            Why DormCheck <em className="italic text-malachite-800">exists</em>.
          </h1>
          <blockquote className="mx-auto mt-6 max-w-[720px] font-serif text-xl leading-[1.45] text-stone-800 md:text-2xl">
            Moving into college is guesswork. You commit to a room you've never seen, get a
            roommate you've never met, and pack for a hall you know nothing about.
          </blockquote>
        </PageContainer>

        {/* Founder: the portrait leads and the card overlaps it, so the card must
            stay SHORTER than the photo — keep this copy to a few lines or the
            proportion inverts and the photo becomes a sidebar again. */}
        {/* Bespoke and RESPONSIVE (856 -> 940): the photo/copy pair is sized to the
            portrait, not to a page role. Documented override per the contract. */}
        <PageContainer width="wide" className="py-12 md:mx-auto md:flex md:max-w-[856px] md:items-center md:py-16 lg:max-w-[940px]">
          {/* The overlap/flex geometry lives on these plain wrappers, never on
              `Reveal` itself — it owns the transform + transition and swallowed
              the responsive margins when they were passed through its className. */}
          <div className="md:flex-shrink-0">
            <Reveal>
              <div className="mx-auto grid aspect-square w-full max-w-[440px] place-items-center overflow-hidden rounded-editorial border border-stone-900/10 bg-gradient-to-br from-malachite-200 to-malachite-100 shadow-raised md:mx-0 md:h-[400px] md:w-[400px] md:max-w-none lg:h-[460px] lg:w-[460px]">
                {imgFailed ? (
                  <span className="font-serif text-[112px] text-malachite-800">ET</span>
                ) : (
                  <img
                    src={founderImg}
                    alt="Ethan Tran, founder of DormCheck"
                    className="h-full w-full object-cover object-[center_22%]"
                    onError={() => setImgFailed(true)}
                  />
                )}
              </div>
            </Reveal>
          </div>

          <div className="relative z-10 -mt-12 md:mt-0 md:-ml-16 md:max-w-[520px] md:flex-1 lg:-ml-20 lg:max-w-[560px]">
            <Reveal delay={80}>
              <div className="rounded-editorial border border-stone-900/5 bg-white p-7 shadow-overlay md:p-9">
                <h2 className="font-display text-3xl font-extrabold leading-[1.15] tracking-tight text-stone-900">
                  Ethan Tran
                </h2>
                <p className="mt-2 text-[15px] font-semibold text-stone-500">Founder, DormCheck</p>

                <p className="mt-5 text-[17px] leading-[1.62] text-stone-700">
                  Junior at the University of Pittsburgh studying business and AI. I started
                  DormCheck in December 2025 because I lived that guesswork and watched everyone
                  around me live it too. Big Idea Competition finalist, building it hall by hall
                  with the students who live there.
                </p>

                <div className="mt-7 flex gap-3">
                  <a
                    href="https://linkedin.com/in/ethanvutran"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Connect with Ethan on LinkedIn"
                    className="grid h-12 w-12 place-items-center rounded-pill bg-stone-900 text-white transition-all hover:-translate-y-0.5 hover:bg-malachite-800 motion-reduce:transition-none"
                  >
                    <FaLinkedin className="h-5 w-5" aria-hidden="true" />
                  </a>
                  <a
                    href="https://x.com/etran_101"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Follow Ethan on X"
                    className="grid h-12 w-12 place-items-center rounded-pill bg-stone-900 text-white transition-all hover:-translate-y-0.5 hover:bg-malachite-800 motion-reduce:transition-none"
                  >
                    <FaXTwitter className="h-5 w-5" aria-hidden="true" />
                  </a>
                </div>
              </div>
            </Reveal>
          </div>
        </PageContainer>
      </div>

      {/* The three operating principles. Was a `md:grid-cols-3` of `SiteCard`s
          on a mint plate — the same "box of boxes" reading the landing page was
          rebuilt to escape (2026-08-04). It is now the landing's dark band
          treatment: one full-bleed deep-green surface, three columns separated
          by a single hairline rule, no card and no shadow anywhere. The numerals
          carry the rhythm the card frames used to. */}
      <Band tone="dark" label="Our operating principles" className="mt-16 md:mt-24">
        {/* The same 1240px editorial rail the landing bands ride. */}
        <PageContainer width="wide" className="grid max-w-[1240px] gap-0 px-6 md:grid-cols-3">
          {PRINCIPLES.map((p, i) => (
            <Reveal key={p.title} delay={i * 110}>
              <div
                className={
                  i === 0
                    ? "border-b border-white/10 pb-10 md:border-b-0 md:border-r md:pb-0 md:pr-10"
                    : i === 1
                      ? "border-b border-white/10 py-10 md:border-b-0 md:border-r md:px-10 md:py-0"
                      : "pt-10 md:pl-10 md:pt-0"
                }
              >
                <span className="font-serif text-[34px] font-semibold leading-none text-malachite-300">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 className="mb-3 mt-5 font-serif text-[26px] font-semibold leading-tight text-white">
                  {p.title}
                </h2>
                <p className="text-[15px] leading-relaxed text-white/70">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </PageContainer>
      </Band>

      <ClosingCta
        title={<>Want to bring DormCheck to <em className="italic">your</em> campus?</>}
        sub="Whether you're a student, a housing team, or a partner, start here."
      >
        <PrimaryCta to="/auth">Get started free</PrimaryCta>
        <GhostCta to="/partners">Partner with us</GhostCta>
      </ClosingCta>
    </div>
  );
}
