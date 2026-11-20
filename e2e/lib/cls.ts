import type { Page } from '@playwright/test';

/**
 * Cumulative Layout Shift measurement for the audit crawl.
 *
 * IPP-1 scope 2 asks for a MEASURED number per audited route rather than a
 * judgement call about whether a page "jumps". CLS is the standing web-vitals
 * metric for exactly that: every unexpected reflow contributes
 * (impact fraction x distance fraction), and shifts within 500ms of a real user
 * input are excluded as expected. The crawl never types or clicks during the
 * measurement window, so everything observed here is unprompted movement — a
 * skeleton that is not the size of the content replacing it, an image without a
 * reserved box, a font swap, a banner injected above the fold.
 *
 * Google's thresholds: <=0.1 good, <=0.25 needs improvement, above that poor.
 * We hold the app to the "good" bar and record the top contributors so a
 * regression names the element that moved instead of just the score.
 *
 * ATTRIBUTION (queue item 8c). A `layout-shift` PerformanceEntry carries a
 * `sources` ARRAY: one entry is one frame's worth of movement, and the spec
 * attributes it to every node that moved in that frame. The entry's `value` is
 * the total for the frame; there is no per-source breakdown in the API.
 *
 * This file used to take `entry.sources[0]` and pair that one node's rects with
 * the WHOLE entry value, silently dropping every other source. The observed
 * symptom: the identical score 0.16986083984375 was reported as `dy -80` on some
 * routes and `dy -32` on others, purely by which source the browser happened to
 * list first. Since dx/dy is the entire investigative signal — "0.1699" is inert
 * until "main moved -80px" makes it actionable — a wrong offset is worse than no
 * offset. So we now record EVERY source, and the score travels with it under the
 * explicit name `entryValue` (plus `sourceCount`) so a reader can never mistake a
 * shared frame total for one node's own contribution.
 *
 * The browser side is a dumb recorder; all attribution happens in Node in
 * `attributeEntries`, which is a pure function with a regression suite
 * (`src/test/auditHarnessTrust.test.ts`). Logic that can be wrong does not live
 * in an un-unit-testable page script.
 */

/** Google's "good" CLS bar. Above this, the route gets a finding. */
export const CLS_GOOD = 0.1;
/** Above this the route is "poor" — escalate the finding's severity. */
export const CLS_POOR = 0.25;

/** How many attributed sources the report keeps per route, worst first. */
export const CLS_WORST_LIMIT = 6;

/** One node that moved, as the browser reported it — no scores, just identity + travel. */
export interface RawShiftSource {
  /** Best-effort element description (tag + class) of a shifted node. */
  node: string;
  /** How far this node actually moved, in px. */
  dx?: number;
  dy?: number;
}

/** One `layout-shift` entry exactly as observed: a frame total plus all its sources. */
export interface RawShiftEntry {
  /** The entry's score. Belongs to the FRAME, not to any single source. */
  value: number;
  sources: RawShiftSource[];
}

export interface ClsSource {
  /** Best-effort element description (tag + class) of a shifted node. */
  node: string;
  /**
   * The score of the layout-shift ENTRY this source belonged to — deliberately
   * NOT named `value`. The API publishes no per-source share, so this is the
   * whole frame's total; when `sourceCount > 1` several nodes share it. Reading
   * it as "this node contributed 0.1699" is exactly the misread 8c fixes.
   */
  entryValue: number;
  /** How many nodes that entry attributed the shift to. >1 ⇒ `entryValue` is shared. */
  sourceCount: number;
  /** Position of this source within its entry's `sources` array (0-based). */
  sourceIndex: number;
  /** How far the node actually moved, in px. The score alone says "something
   *  jumped"; `dy: 136` says "something above it grew by a nav bar". */
  dx?: number;
  dy?: number;
}

export interface ClsRecord {
  /** Cumulative score across the whole observation window. */
  value: number;
  /** How many discrete shifts made it up. */
  shiftCount: number;
  /** The sources of the biggest individual shifts, worst first. */
  worst: ClsSource[];
}

/** Set to '0' to skip CLS measurement entirely (parity with A11Y=0). */
export const clsEnabled = () => process.env.CLS !== '0';

/**
 * Flatten observed entries into per-source attributions, worst entry first.
 *
 * Every source of an entry is emitted — never just the first — and each carries
 * the entry's own total under `entryValue` with the `sourceCount` it is shared
 * across. An entry with no sources still emits one anonymous row, so a score can
 * never vanish from the report just because the browser attributed it to nothing.
 */
export function attributeEntries(
  entries: RawShiftEntry[],
  limit: number = CLS_WORST_LIMIT,
): ClsSource[] {
  const byWorstEntry = [...entries].sort((a, b) => b.value - a.value);
  const out: ClsSource[] = [];
  for (const entry of byWorstEntry) {
    const sources = entry.sources ?? [];
    if (sources.length === 0) {
      out.push({ node: '(anonymous)', entryValue: entry.value, sourceCount: 0, sourceIndex: 0 });
    } else {
      sources.forEach((s, i) => {
        out.push({
          node: s.node,
          entryValue: entry.value,
          sourceCount: sources.length,
          sourceIndex: i,
          dx: s.dx,
          dy: s.dy,
        });
      });
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/**
 * Install the layout-shift observer. MUST be called before `page.goto`, because
 * the shifts that matter most happen during the initial render — an observer
 * attached afterwards would score a settled page as a perfect 0 and the check
 * would be worthless.
 *
 * `buffered: true` also replays entries the browser recorded before the observer
 * was constructed, so nothing between navigation start and script execution is
 * lost.
 */
export async function installClsObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface LayoutShiftAttribution {
      node?: Node | null;
      previousRect?: DOMRectReadOnly;
      currentRect?: DOMRectReadOnly;
    }
    interface LayoutShift extends PerformanceEntry {
      value: number;
      hadRecentInput: boolean;
      sources?: LayoutShiftAttribution[];
    }
    // Bound memory on a pathological page; the report only ever shows a handful,
    // and attribution sorts by entry value so the worst always survive.
    const MAX_ENTRIES = 60;
    const state = {
      value: 0,
      shiftCount: 0,
      entries: [] as { value: number; sources: { node: string; dx?: number; dy?: number }[] }[],
    };
    (window as unknown as Record<string, unknown>).__dcCls = state;

    const describe = (node: Node | null | undefined): string => {
      if (!node || !(node instanceof Element)) return '(anonymous)';
      const cls = typeof node.className === 'string' ? node.className.trim().split(/\s+/).slice(0, 4).join('.') : '';
      return cls ? `${node.tagName.toLowerCase()}.${cls}` : node.tagName.toLowerCase();
    };

    try {
      const observer = new PerformanceObserver((list) => {
        for (const raw of list.getEntries()) {
          const entry = raw as LayoutShift;
          // A shift within 500ms of a real interaction is expected, not a defect.
          if (entry.hadRecentInput) continue;
          state.value += entry.value;
          state.shiftCount += 1;
          // Record EVERY source, not sources[0]: an entry routinely names several
          // nodes and keeping only the first is how a -32px move got reported as
          // the -80px one. Scoring/attribution happens in Node (attributeEntries).
          const sources = (entry.sources ?? []).map((s) => {
            const prev = s.previousRect;
            const cur = s.currentRect;
            return {
              node: describe(s.node),
              dx: prev && cur ? Math.round(cur.x - prev.x) : undefined,
              dy: prev && cur ? Math.round(cur.y - prev.y) : undefined,
            };
          });
          if (state.entries.length < MAX_ENTRIES) {
            state.entries.push({ value: entry.value, sources });
          } else {
            // Keep the worst rather than the earliest.
            let minIdx = 0;
            for (let i = 1; i < state.entries.length; i++) {
              if (state.entries[i].value < state.entries[minIdx].value) minIdx = i;
            }
            if (state.entries[minIdx].value < entry.value) {
              state.entries[minIdx] = { value: entry.value, sources };
            }
          }
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });
    } catch {
      // layout-shift is Chromium-only; on other engines the score stays 0 and the
      // audit simply reports nothing rather than failing the run.
    }
  });
}

/** Read the accumulated score. Returns null if the observer never installed. */
export async function readCls(page: Page): Promise<ClsRecord | null> {
  const raw = await page
    .evaluate(() => {
      const state = (window as unknown as Record<string, unknown>).__dcCls as
        | { value: number; shiftCount: number; entries: RawShiftEntryLike[] }
        | undefined;
      type RawShiftEntryLike = { value: number; sources: { node: string; dx?: number; dy?: number }[] };
      if (!state) return null;
      return { value: state.value, shiftCount: state.shiftCount, entries: state.entries };
    })
    .catch(() => null);
  if (!raw) return null;
  return {
    value: Number(raw.value.toFixed(4)),
    shiftCount: raw.shiftCount,
    worst: attributeEntries(raw.entries as RawShiftEntry[]),
  };
}

/** Human-readable one-liner for a finding / the report. */
export function formatCls(cls: ClsRecord): string {
  const worst = cls.worst.slice(0, 3).map(describeSource).join(', ');
  return `CLS ${cls.value} over ${cls.shiftCount} shift(s)${worst ? ` — worst: ${worst}` : ''}`;
}

/**
 * One attributed source as text. The score is labelled "entry" and, when the
 * frame had more than one source, says so — so nobody reads a shared frame total
 * as this node's own contribution.
 */
export function describeSource(s: ClsSource): string {
  const moved = s.dy != null || s.dx != null ? `, moved ${s.dx ?? 0},${s.dy ?? 0}px` : '';
  const shared = s.sourceCount > 1 ? ` shared by ${s.sourceCount} sources` : '';
  return `${s.node} (entry ${s.entryValue.toFixed(4)}${shared}${moved})`;
}
