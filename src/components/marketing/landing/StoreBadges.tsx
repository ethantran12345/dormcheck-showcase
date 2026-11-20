import { cn } from "@/lib/utils";

/**
 * The two familiar black store badges, drawn in SVG rather than shipped as
 * Apple/Google's badge artwork (their badge images carry brand-guideline
 * constraints, and inline marks stay crisp at every DPR and need no asset).
 *
 * Both stores are live as of 2026-08-12 (iOS 1.0 reached "Ready for
 * Distribution" 2026-08-06; product page verified loading before this URL was
 * set). The `null` branch below is kept, not deleted: it is how a future
 * platform, or a delisting, renders muted and non-interactive with a "· soon"
 * suffix. Set a URL to null and the chip goes back to that state on its own.
 */
const APP_STORE_URL: string | null =
  "https://apps.apple.com/us/app/dormcheck/id6772699231";
const PLAY_STORE_URL: string | null =
  "https://play.google.com/store/apps/details?id=com.dormcheck.android";

/* A quiet ghost chip, not the black slab: two solid black plates plus a
   "coming soon" line made four stacked rows under the CTAs and out-weighted
   the primary button. This borrows the hero's own white/hairline ghost
   language so the row recedes, and the unavailable store carries its own
   "soon" instead of costing a whole extra line. */
const CHIP =
  "inline-flex h-9 items-center gap-2 rounded-pill border border-stone-200 bg-white/70 px-3.5 text-[13px] font-semibold text-stone-700";

function AppleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 fill-current">
      <path d="M16.365 1.43c0 1.14-.42 2.2-1.12 3-.77.88-2.02 1.56-3.06 1.48a3.2 3.2 0 0 1-.02-.38c0-1.1.47-2.23 1.2-3.02.73-.8 1.98-1.4 3-1.44.02.12.02.24.02.36ZM20.5 17.1c-.5 1.15-.74 1.66-1.38 2.68-.9 1.42-2.16 3.19-3.73 3.2-1.39.02-1.75-.9-3.64-.89-1.9.01-2.29.91-3.68.9-1.57-.02-2.77-1.62-3.66-3.04-2.5-3.96-2.77-8.6-1.22-11.07 1.1-1.75 2.83-2.78 4.46-2.78 1.66 0 2.7.91 4.08.91 1.33 0 2.15-.91 4.07-.91 1.45 0 3 .79 4.1 2.16-3.6 1.98-3.02 7.13.6 8.84Z" />
    </svg>
  );
}

function PlayMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0">
      <path d="M3.6 2.2a1 1 0 0 0-.4.82v17.96a1 1 0 0 0 .4.82l9.5-9.8-9.5-9.8Z" fill="#00D3FF" />
      <path d="m13.1 12 3.05-3.14 3.9 2.2c.66.38.66 1.5 0 1.88l-3.9 2.2L13.1 12Z" fill="#FFCE00" />
      <path d="m3.6 2.2 9.5 9.8 3.05-3.14L5.1 2.35a1.35 1.35 0 0 0-1.5-.15Z" fill="#00F076" />
      <path d="m3.6 21.8 9.5-9.8 3.05 3.14L5.1 21.65a1.35 1.35 0 0 1-1.5.15Z" fill="#FF3A44" />
    </svg>
  );
}

function Chip({ href, mark, label }: { href: string | null; mark: React.ReactNode; label: string }) {
  if (!href) {
    // `stone-500`, not `stone-400`: over this chip's effective background
    // (bg-white/70 composites to ~#fefefd on the hero) stone-400 measures
    // 2.59:1, well under the AA 4.5:1 floor for 13px text — axe flagged it P0
    // on the anon crawl (#147). stone-500 measures 5.11:1 and is already the
    // hero's muted token (the waitlist line above uses it), so the chip stays
    // visibly recessive against the live chip's stone-700 (10.6:1) without
    // being unreadable. Do not darken this back toward stone-400.
    return (
      <span className={cn(CHIP, "text-stone-500")}>
        {mark}
        {label}
        <span className="font-normal text-stone-500">· soon</span>
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(CHIP, "transition-colors hover:bg-white hover:text-stone-900 motion-reduce:transition-none")}
    >
      {mark}
      {label}
    </a>
  );
}

export function StoreBadges({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* No "Get the app" lead-in: the chips name their own store, and at 390
          the label pushed the pair onto two lines. */}
      <Chip href={PLAY_STORE_URL} mark={<PlayMark />} label="Google Play" />
      <Chip href={APP_STORE_URL} mark={<AppleMark />} label="App Store" />
    </div>
  );
}

export default StoreBadges;
