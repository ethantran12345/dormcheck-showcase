import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router";
import {
  BOUNDARY_FACTS,
  LANDING_VARIANTS,
  TOURNAMENT,
  findVariant,
  type LandingVariant,
} from "@/components/marketing/landing/variants";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * DEV-ONLY landing decision board (`/__variants`).
 *
 * This surface answers exactly one question — WHICH VARIANT DO WE SHIP, AND WHY —
 * so it opens on the ten finalists ranked by rubric score and nothing else. It is
 * deliberately not a pipeline dashboard: round counters, rubric sliders and
 * per-round strips were removed because they described how the ranking was
 * produced rather than what it concluded. Provenance is one line; the rubric
 * itself lives in docs/taste-rubric.md.
 *
 * EVERY FACT ON SCREEN IS READ FROM `LANDING_VARIANTS` — score, round, the bet,
 * the trade, the cause of death. Nothing is restated as a literal here, so the
 * board and docs/taste-finalists.md cannot drift apart.
 *
 * CHROME: the board and the solo view render with NO site nav or footer by
 * default. It is a tool, not a page of the site, and every variant already draws
 * its own nav inside its own composition — the outer marketing nav was a second
 * one stacked on top. `C` (or the button in the bar) brings the real app shell
 * back for judging a variant in situ.
 *
 * That toggle is implemented as a `<style>` element rendered BY THIS FILE, not as
 * a flag threaded through `LayoutWrapper`, a context or a provider. This is
 * deliberate and load-bearing: the moment anything in `src/` outside `pages/dev/`
 * has to know this route exists, the dead-branch gate in `App.tsx` stops being
 * able to drop the whole graph from a production build. The board is allowed to
 * reach UP into the shell's DOM; the shell is never allowed to reach DOWN to it.
 *
 * Thumbnails are live iframes pinned to 390×844 and clipped, i.e. the phone's
 * FIRST VIEWPORT rather than a full-page strip. Iframes rather than inline
 * mounts on purpose: each variant is a full landing composition with its own
 * viewport-relative CSS, and ten of them in one document would all resolve `vw`,
 * media queries and sticky offsets against the gallery instead of the phone. A
 * live frame also cannot go stale against a re-run the way a checked-in capture
 * does.
 *
 * NEVER SHIPS. `App.tsx` creates this lazy import behind `import.meta.env.DEV`,
 * which Vite replaces with a literal `false` in a production build, so Rollup
 * drops the branch and the whole variants graph with it. Proven on every build by
 * `npm run guard:dev-only` (scripts/check-dev-only-excluded.mjs), in dev-push CI.
 */

/** The phone viewport every thumbnail is cropped to. 390 is the iOS baseline. */
const PHONE = { w: 390, h: 844 } as const;

/** Height of the fixed jump bar; the document is pushed down by exactly this. */
const BAR_H = 92;

/** Chrome preference, per tab. Deliberately NOT app state — see the file header. */
const CHROME_KEY = "dc-variants-chrome";

/**
 * How long an AMBIGUOUS digit waits for its partner. With 16 variants only a
 * leading `1` is ambiguous (`1` vs `12`), so this timer is the exception, not the
 * path — every other digit jumps on keydown. See `pushDigit`.
 */
const DIGIT_WINDOW_MS = 700;

/**
 * Highest score first; a tie keeps the earlier variant ahead — earlier meaning
 * the earlier TOURNAMENT first, then the earlier round within it. Two
 * tournaments both number their rounds 1–4, so round alone is not an ordering.
 */
function byScore(a: LandingVariant, b: LandingVariant) {
  return (
    b.score - a.score ||
    (a.tournament ?? 1) - (b.tournament ?? 1) ||
    a.round - b.round
  );
}

/**
 * The one canonical ordering: finalists ranked by score, then the culled, also
 * ranked. The grid, the jump bar and the number-key indices all read this, so
 * "press 4" and "the fourth card" are the same variant.
 */
const BOARD_ORDER: LandingVariant[] = [
  ...LANDING_VARIANTS.filter((v) => v.finalist).sort(byScore),
  ...LANDING_VARIANTS.filter((v) => !v.finalist).sort(byScore),
];

function boundaryFactsFor(id: string) {
  return BOUNDARY_FACTS.filter((f) => f.affects.includes(id));
}

/** Free-text match over the fields the decision actually turns on. */
function matches(v: LandingVariant, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = v.tournament ?? 1;
  return [
    v.label,
    v.id,
    `round ${v.round}`,
    `r${v.round}`,
    `t${t}`,
    `t${t}r${v.round}`,
    v.note,
    v.tradesAway,
    v.culledBecause,
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/** True when this document is a gallery thumbnail rather than a top-level tab. */
function useIsEmbedded() {
  return useMemo(() => {
    try {
      return window.self !== window.top;
    } catch {
      return true; // cross-origin access throwing means we are framed
    }
  }, []);
}

/**
 * Hides the app shell around this route, and reserves the bar's height.
 *
 * The chrome (`MarketingTopNav`, `AppSidebar`, the footer) are siblings of
 * `<main id="main-content">` inside `LayoutWrapper`, so one structural selector
 * removes all of it without this file knowing any of their names — and without
 * `LayoutWrapper` knowing this route exists.
 */
function BoardStyle({ chrome, bar = true }: { chrome: boolean; bar?: boolean }) {
  const css = [
    bar ? `#root { padding-top: ${BAR_H}px; }` : "",
    chrome
      ? ""
      : [
          "div:has(> #main-content) > :not(#main-content) { display: none !important; }",
          "#main-content { padding-top: 0 !important; }",
        ].join("\n"),
  ].join("\n");
  return <style>{css}</style>;
}

/** One variant in the jump bar. Finalist and culled must be readable apart at a glance. */
function JumpChip({
  index,
  variant,
  active,
  onJump,
}: {
  index: number;
  variant: LandingVariant;
  active: boolean;
  onJump: (id: string) => void;
}) {
  return (
    <a
      href={`/__variants/${variant.id}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onJump(variant.id);
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[12px] leading-none transition-colors",
        variant.finalist
          ? "border-stone-600 text-white hover:border-malachite-500"
          : "border-stone-700 text-stone-400 hover:border-stone-500",
        active && "border-malachite-500 bg-malachite-800 text-white dark:bg-malachite-800",
      )}
      title={variant.finalist ? `Finalist · ${variant.note}` : `Culled · ${variant.culledBecause}`}
    >
      <span className="tabular-nums text-stone-500">{index}</span>
      <span className="font-bold">{variant.label}</span>
      <span className="tabular-nums text-stone-400">{variant.score}</span>
      {!variant.finalist && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-stone-500">culled</span>
      )}
    </a>
  );
}

/**
 * The board's own shell: the fixed jump bar, the keyboard map, and the chrome
 * toggle. Children get the live filter query, so the grid and the bar can never
 * disagree about what is being looked at.
 *
 * Keys: 1–16 (typed as digits) jump to a variant, G returns to the grid, Esc
 * leaves the solo view, C toggles the site chrome, / focuses the filter.
 */
function DevBoardShell({
  activeId,
  children,
}: {
  activeId?: string;
  children: (query: string) => ReactNode;
}) {
  const navigate = useNavigate();
  const embedded = useIsEmbedded();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [chrome, setChrome] = useState(() => {
    try {
      return sessionStorage.getItem(CHROME_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleChrome = useCallback(() => {
    setChrome((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(CHROME_KEY, next ? "1" : "0");
      } catch {
        /* private mode — the toggle still works for this view */
      }
      return next;
    });
  }, []);

  const jump = useCallback((id: string) => navigate(`/__variants/${id}`), [navigate]);

  useEffect(() => {
    if (embedded) return;
    const commit = () => {
      const n = Number.parseInt(pendingRef.current, 10);
      pendingRef.current = "";
      setPending("");
      const target = BOARD_ORDER[n - 1];
      if (target) jump(target.id);
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        if (e.key === "Escape") {
          setQuery("");
          el.blur();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        filterRef.current?.focus();
        return;
      }
      if (e.key === "g" || e.key === "G") {
        navigate("/__variants");
        return;
      }
      if (e.key === "c" || e.key === "C") {
        toggleChrome();
        return;
      }
      if (e.key === "Escape") {
        if (activeId) navigate("/__variants");
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        // 16 variants do not fit in ten keys, so a jump can be two digits. Waiting
        // out a timer on EVERY digit would make the common case (1 of 9) feel
        // broken, so we only wait when the buffer could still grow into a real
        // index — with 16 variants that is a leading `1` and nothing else.
        const buf = (pendingRef.current + e.key).slice(-2);
        pendingRef.current = buf;
        clearTimeout(timerRef.current);
        const extendable = BOARD_ORDER.some(
          (_, i) => String(i + 1).length > buf.length && String(i + 1).startsWith(buf),
        );
        if (extendable) {
          setPending(buf);
          timerRef.current = setTimeout(commit, DIGIT_WINDOW_MS);
        } else {
          commit();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timerRef.current);
    };
  }, [activeId, embedded, jump, navigate, toggleChrome]);

  // A thumbnail is a variant, full stop: no bar, no chrome, no key handling.
  if (embedded) {
    return (
      <>
        <BoardStyle chrome={false} bar={false} />
        {children("")}
      </>
    );
  }

  const visible = BOARD_ORDER.filter((v) => matches(v, query));

  return (
    <>
      <BoardStyle chrome={chrome} />
      <div
        className="fixed inset-x-0 top-0 z-[100] flex flex-col justify-center gap-1.5 border-b border-stone-700 bg-stone-900 px-3 py-2 text-white"
        style={{ height: BAR_H }}
      >
        <div className="flex items-center gap-2">
          <a
            href="/__variants"
            onClick={(e) => {
              e.preventDefault();
              navigate("/__variants");
            }}
            className="shrink-0 text-[12px] font-extrabold uppercase tracking-wider text-stone-300 hover:text-white"
          >
            Landing board
          </a>
          <span className="hidden shrink-0 text-[11px] text-stone-500 sm:inline">
            1–{BOARD_ORDER.length} jump · G grid · Esc back · C chrome · / filter
          </span>
          {pending && (
            <span className="shrink-0 rounded-control bg-malachite-800 px-1.5 py-0.5 text-[11px] font-extrabold tabular-nums dark:bg-malachite-800">
              →{pending}
            </span>
          )}
          <label htmlFor="variant-filter" className="sr-only">
            Filter variants by name, round, bet or trade
          </label>
          <input
            id="variant-filter"
            ref={filterRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter name, round, bet, trade…"
            className="ml-auto w-40 min-w-0 rounded-control border border-stone-600 bg-stone-800 px-2 py-1 text-[12px] text-white placeholder:text-stone-500 focus:border-malachite-500 focus:outline-none md:w-64"
          />
          <Button
            type="button"
            onClick={toggleChrome}
            aria-pressed={chrome}
            className={cn(
              "h-7 shrink-0 rounded-control px-2.5 text-[12px] font-bold",
              chrome
                ? "bg-malachite-800 text-white hover:bg-malachite-700 dark:bg-malachite-800"
                : "bg-stone-700 text-stone-200 hover:bg-stone-600",
            )}
          >
            Site chrome: {chrome ? "on" : "off"}
          </Button>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {visible.map((v) => (
            <JumpChip
              key={v.id}
              index={BOARD_ORDER.indexOf(v) + 1}
              variant={v}
              active={v.id === activeId}
              onJump={jump}
            />
          ))}
          {!visible.length && (
            <span className="text-[12px] text-stone-500">No variant matches “{query}”.</span>
          )}
        </div>
      </div>
      {children(query)}
    </>
  );
}

/**
 * One finalist. The card is the whole argument: what it bets, what that costs,
 * and any boundary fact that makes its number softer than it looks.
 */
function FinalistCard({ rank, variant }: { rank: number; variant: LandingVariant }) {
  const { id, label, round, score, note, tradesAway, tournament = 1 } = variant;
  const caveats = boundaryFactsFor(id);

  return (
    <article className="flex flex-col overflow-hidden rounded-card border border-stone-200 bg-white shadow-raised">
      <header className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <div className="flex items-baseline gap-2.5">
          <span
            className="rounded-pill bg-malachite-800 px-2.5 py-0.5 text-[13px] font-extrabold tabular-nums text-white dark:bg-malachite-800"
            aria-label={`Rank ${rank}`}
          >
            {rank}
          </span>
          <h3 className="text-[17px] font-extrabold text-stone-900">{label}</h3>
        </div>
        <span className="shrink-0 pt-0.5 text-right">
          <span className="block text-[15px] font-extrabold tabular-nums text-stone-900">
            {score}
            <span className="text-[12px] font-bold text-stone-500">/{TOURNAMENT.rubricMax}</span>
          </span>
          <span className="block text-[11px] font-bold uppercase tracking-wider text-stone-500">
            T{tournament} · Round {round}
          </span>
        </span>
      </header>

      {/* Live first-viewport crop. The wrapper owns the scaled height so the card
          does not reserve 844px of empty space below the frame. */}
      <a
        href={`/__variants/${id}`}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden border-b border-stone-200 bg-stone-50 [--thumb:0.85] md:[--thumb:0.62]"
        style={{ height: `calc(${PHONE.h}px * var(--thumb))` }}
        aria-label={`Open the ${label} variant full size`}
      >
        <iframe
          src={`/__variants/${id}`}
          title={`${label} landing variant, phone viewport`}
          width={PHONE.w}
          height={PHONE.h}
          loading="lazy"
          scrolling="no"
          tabIndex={-1}
          className="pointer-events-none origin-top-left border-0"
          style={{ transform: "scale(var(--thumb))" }}
        />
      </a>

      <div className="flex flex-1 flex-col gap-2.5 px-4 py-3.5">
        <p className="text-[13.5px] leading-relaxed text-stone-700">{note}</p>
        <p className="text-[13px] leading-relaxed text-stone-600">
          <span className="font-extrabold uppercase tracking-wider text-stone-500">
            Trades away ·{" "}
          </span>
          {tradesAway}
        </p>
        {caveats.map((f) => (
          <p
            key={f.id}
            className="rounded-control border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-stone-800"
          >
            <span className="font-extrabold">Read this before trusting the number · </span>
            {f.text}
          </p>
        ))}
        <a
          href={`/__variants/${id}`}
          target="_blank"
          rel="noreferrer"
          className="mt-auto pt-1 text-[13px] font-extrabold text-malachite-800 underline-offset-2 hover:underline"
        >
          Open {label} full size ↗
        </a>
      </div>
    </article>
  );
}

export default function VariantsPage() {
  const ranked = LANDING_VARIANTS.filter((v) => v.finalist).sort(byScore);
  const culledAll = LANDING_VARIANTS.filter((v) => !v.finalist).sort(byScore);

  return (
    <DevBoardShell>
      {(query) => {
        const finalists = ranked.filter((v) => matches(v, query));
        const culled = culledAll.filter((v) => matches(v, query));
        const filtering = query.trim().length > 0;

        return (
          <div className="min-h-screen bg-tint-50 px-4 py-8 text-stone-900 md:px-6">
            <header className="mb-6 max-w-[70ch]">
              <h1 className="font-serif text-[26px] font-semibold leading-tight md:text-[30px]">
                Landing — which one do we ship?
              </h1>
              <p className="mt-2 text-[13.5px] leading-relaxed text-stone-600">
                The {ranked.length} finalists, ranked by rubric score. Each card carries the bet it
                makes and what that bet costs; the trade, not the score, is what the decision turns
                on.
              </p>
              <p className="mt-3 text-[12.5px] leading-relaxed text-stone-500">
                {TOURNAMENT.tournaments} tournaments · {TOURNAMENT.rounds} rounds (
                {TOURNAMENT.runs} runs) · {LANDING_VARIANTS.length} variants scored · rubric{" "}
                {TOURNAMENT.rubric} (max {TOURNAMENT.rubricMax}) · {TOURNAMENT.date} ·{" "}
                <code className="text-stone-600">{TOURNAMENT.rubricDoc}</code> ·{" "}
                <code className="text-stone-600">{TOURNAMENT.finalistsDoc}</code>. Dev-only; this
                route does not exist in a production build.
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-stone-500">
                {TOURNAMENT.provenance}
              </p>
            </header>

            {filtering && (
              <p className="mb-3 text-[12.5px] font-bold text-stone-600">
                Filtering “{query}” — {finalists.length} finalist(s), {culled.length} culled.
              </p>
            )}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {finalists.map((v) => (
                <FinalistCard key={v.id} rank={ranked.indexOf(v) + 1} variant={v} />
              ))}
            </div>

            {culled.length > 0 && (
              <details
                className="mt-8 max-w-[80ch] rounded-card border border-stone-200 bg-white"
                open={filtering}
              >
                <summary className="cursor-pointer list-none px-4 py-3 text-[14px] font-extrabold text-stone-800 [&::-webkit-details-marker]:hidden">
                  Culled — how we got here ({culled.length}) ▾
                </summary>
                <ul className="border-t border-stone-200 px-4 py-2">
                  {culled.map((v) => (
                    <li
                      key={v.id}
                      className="flex flex-col gap-1 border-b border-stone-100 py-3 last:border-b-0 md:flex-row md:gap-4"
                    >
                      <span className="flex shrink-0 items-baseline gap-2 md:w-40">
                        <a
                          href={`/__variants/${v.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[14px] font-extrabold text-stone-900 underline-offset-2 hover:underline"
                        >
                          {v.label}
                        </a>
                        <span className="text-[12px] font-bold tabular-nums text-stone-500">
                          {v.score}/{TOURNAMENT.rubricMax} · R{v.round}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "text-[13px] leading-relaxed text-stone-600",
                          boundaryFactsFor(v.id).length && "text-stone-800",
                        )}
                      >
                        {v.culledBecause}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      }}
    </DevBoardShell>
  );
}

/**
 * A single variant at `/__variants/:id` — what the board's thumbnails load, and
 * what "Open full size" opens.
 *
 * It renders WITHOUT the marketing chrome by default: every variant composes its
 * own nav, so the shell's `MarketingTopNav` above it was a second nav that no
 * shipped page will ever have. `C` puts the real shell back for an in-situ read.
 */
export function VariantSolo() {
  const { id } = useParams();
  const variant = findVariant(id);
  if (!variant) {
    return (
      <DevBoardShell>
        {() => (
          <div className="p-10 text-stone-700">
            <h1 className="font-serif text-2xl font-semibold text-stone-900">No such variant</h1>
            <p className="mt-2 text-[14px]">
              Known ids: {LANDING_VARIANTS.map((v) => v.id).join(", ")}.
            </p>
          </div>
        )}
      </DevBoardShell>
    );
  }
  const { Component } = variant;
  return (
    <DevBoardShell activeId={variant.id}>
      {() => (
        <Suspense fallback={<div className="p-10 text-stone-500">Loading {variant.label}…</div>}>
          <Component />
        </Suspense>
      )}
    </DevBoardShell>
  );
}
