import type { Page } from '@playwright/test';

/**
 * Layout detectors for the audit crawl: the "is anything cut off?" pass.
 *
 * One shared, page-agnostic detector that `auditRoute` runs on every page visit
 * when the crawl is in layout mode (AUDIT_LAYOUT=1, see
 * e2e/playwright.layout.config.ts). It never knows which page it is on. That is
 * the point: a per-page assertion would only find what someone already guessed.
 *
 * Kinds (severity is assigned in audit.ts):
 *   overflow-x      the page scrolls sideways, or a visible element runs past the
 *                   right edge without a clipping/scrolling container to hold it.
 *   clipped         an interactive control (button, link, input, tab…) that, at
 *                   its scrolled-into-view position, is partly outside the
 *                   viewport or its clipping container, or has its centre covered
 *                   by a fixed element (bottom nav, LegalUpdateNotice, toast…).
 *   sheet-overflow  an open dialog/sheet/drawer extends past the viewport with no
 *                   scrolling ancestor, or clips its own content with no scroller.
 *   nav-occlusion   at maximum scroll, content still sits under a fixed bottom bar
 *                   (bottom nav / notice card): the last list item can't be seen.
 *   truncation      ellipsis or line-clamp actually cutting text, with no title,
 *                   no link to a detail view, and no card around it to open one.
 *
 * Deliberate exclusions, so the signal stays worth reading:
 *   · anything aria-hidden, inert, opacity 0, visibility hidden or under 3px
 *     (sr-only text, Radix's hidden native inputs, closed drawers);
 *   · elements that are FULLY clipped or fully off-screen (a collapsed accordion
 *     or an off-canvas menu is hidden by design; only PARTIAL clipping is a bug);
 *   · coverage by non-fixed overlays (labels, decorative layers): only fixed or
 *     sticky UI counts, because that is the class that follows the user around.
 *
 * Native caveat: the web crawl has no safe-area insets and no home indicator, so
 * env(safe-area-inset-bottom) is 0 here. A bar that is fine on the web can still
 * cover content on a notched iPhone; that needs the Simulator.
 */

export type LayoutKind = 'overflow-x' | 'clipped' | 'sheet-overflow' | 'nav-occlusion' | 'truncation';

export interface LayoutIssue {
  kind: LayoutKind;
  detail: string;
  /** Overrides the kind's default severity (audit.ts LAYOUT_SEVERITY). */
  severity?: 'P1' | 'P2';
}

/** Runs inside the page. Must be self-contained: no closures over Node values. */
function detect(): { kind: string; detail: string; severity?: string }[] {
  const issues: { kind: string; detail: string; severity?: string }[] = [];
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const vh = window.innerHeight;
  const SLACK = 2;

  const INTERACTIVE =
    'a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],' +
    '[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],[role="menuitem"],[role="combobox"]';

  const describe = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const tid = el.getAttribute('data-testid');
    const aria = el.getAttribute('aria-label');
    const cls =
      typeof (el as HTMLElement).className === 'string'
        ? (el as HTMLElement).className.split(/\s+/).filter(Boolean).slice(0, 4).join('.')
        : '';
    const raw = ((el as HTMLElement).innerText || (el as HTMLInputElement).value || '').trim();
    const text = raw.replace(/\s+/g, ' ').slice(0, 48);
    return (
      `${tag}${id}${tid ? `[data-testid=${tid}]` : ''}${cls ? `.${cls}` : ''}` +
      `${aria ? ` [aria-label="${aria.slice(0, 40)}"]` : ''}${text ? ` "${text}"` : ''}`
    );
  };

  const shown = (el: Element): boolean => {
    if (el.closest('[aria-hidden="true"],[inert],[hidden]')) return false;
    const he = el as HTMLElement & { checkVisibility?: (o: object) => boolean };
    if (he.checkVisibility && !he.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 3 && r.height >= 3;
  };

  const clips = (cs: CSSStyleDeclaration, axis: 'x' | 'y') => {
    const v = axis === 'x' ? cs.overflowX : cs.overflowY;
    return v !== 'visible';
  };

  const isFixedish = (el: Element) => {
    const p = getComputedStyle(el).position;
    return p === 'fixed' || p === 'sticky';
  };
  const fixedAncestor = (el: Element | null): Element | null => {
    for (let n = el; n && n !== doc; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') return n;
    }
    return null;
  };
  const fixedOrStickyAncestor = (el: Element | null): Element | null => {
    for (let n = el; n && n !== doc; n = n.parentElement) if (isFixedish(n)) return n;
    return null;
  };

  /** Visible rect of `el` after every clipping ancestor and the viewport. */
  const visibleRect = (el: Element) => {
    const r = el.getBoundingClientRect();
    let l = Math.max(r.left, 0);
    let t = Math.max(r.top, 0);
    let ri = Math.min(r.right, vw);
    let b = Math.min(r.bottom, vh);
    for (let n = el.parentElement; n && n !== document.body && n !== doc; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const cr = n.getBoundingClientRect();
      if (clips(cs, 'x')) {
        l = Math.max(l, cr.left);
        ri = Math.min(ri, cr.right);
      }
      if (clips(cs, 'y')) {
        t = Math.max(t, cr.top);
        b = Math.min(b, cr.bottom);
      }
      if (cs.position === 'fixed') break; // ancestors above a fixed box don't clip it
    }
    const area = Math.max(0, ri - l) * Math.max(0, b - t);
    return { frac: area / Math.max(1, r.width * r.height), r };
  };

  const ellipsisNear = (el: Element) => {
    for (let n: Element | null = el, i = 0; n && i < 3; n = n.parentElement, i++) {
      const cs = getComputedStyle(n);
      if (cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none')) return true;
    }
    return false;
  };

  // A drag/swipe carousel clips its slides on purpose; they are reachable by
  // swiping or its chevrons (src/components/ui/horizontal-scroll-carousel.tsx,
  // shadcn Carousel). Partial slides there are the affordance, not a defect.
  const inCarousel = (el: Element) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      if (n.matches('[aria-roledescription="carousel"],[data-embla],.embla')) return true;
      if (getComputedStyle(n).cursor === 'grab' && getComputedStyle(n).overflowX !== 'visible') return true;
    }
    return false;
  };

  const scrollers = (): Element[] => {
    const out: Element[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
        out.push(el);
      }
    }
    return out;
  };

  const all = Array.from(document.querySelectorAll('body *'));

  // ── 1. horizontal overflow ─────────────────────────────────────────────────
  {
    const docOverflow = doc.scrollWidth > vw + 1;
    const offenders = new Set<Element>();
    for (const el of all) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (!(r.right > vw + SLACK && r.left < vw - SLACK)) continue;
      // Held by a clipping/scrolling container that itself fits? Then it's a
      // carousel or a clipped decoration, not page overflow.
      let held = false;
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (clips(cs, 'x') && n.getBoundingClientRect().right <= vw + SLACK) {
          held = true;
          break;
        }
        if (cs.position === 'fixed') break;
      }
      if (held) continue;
      if (!docOverflow) {
        // Body hides the overflow: only meaningful content counts (cut-off text
        // or a control), not a decorative blob bleeding off the edge.
        const meaningful = el.matches(INTERACTIVE) || el.matches('img,video,input') ||
          Array.from(el.childNodes).some((c) => c.nodeType === 3 && (c.textContent ?? '').trim().length > 0);
        if (!meaningful) continue;
      }
      offenders.add(el);
    }
    const outermost = [...offenders].filter((el) => !el.parentElement || !offenders.has(el.parentElement));
    if (docOverflow || outermost.length) {
      const ex = outermost
        .slice(0, 4)
        .map((el) => `${describe(el)} (right ${Math.round(el.getBoundingClientRect().right)}px)`)
        .join(' · ');
      issues.push({
        kind: 'overflow-x',
        detail: `${docOverflow ? `page scrolls sideways (scrollWidth ${doc.scrollWidth} > ${vw})` : `content cut at right edge (${vw}px)`}; ${outermost.length} element(s): ${ex || 'none identifiable'}`,
      });
    }
  }

  // ── 2. sheets / dialogs ────────────────────────────────────────────────────
  const dialogs = Array.from(
    document.querySelectorAll('[role="dialog"],[role="alertdialog"],[data-vaul-drawer]'),
  ).filter(shown);
  for (const d of dialogs) {
    const r = d.getBoundingClientRect();
    const past = Math.max(0, r.bottom - vh, -r.top);
    let ancestorScrolls = false;
    for (let n = d.parentElement; n && n !== doc; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 1) {
        ancestorScrolls = true;
        break;
      }
    }
    const inner = [d, ...Array.from(d.querySelectorAll('*'))];
    const scrollerInside = inner.some((n) => {
      const cs = getComputedStyle(n);
      return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 1;
    });
    const name = d.getAttribute('aria-label') || d.querySelector('h1,h2,h3,[id$="title"]')?.textContent?.trim().slice(0, 40) || describe(d);
    if (past > SLACK && !ancestorScrolls) {
      // P1 only when something a student needs is out of reach: with every
      // inner scroller at its end, a control or text still lies off-screen.
      // A sheet whose overhang is padding (content and submit fully visible)
      // is P2 (Ethan, 2026-10-11).
      const innerScrollers = inner.filter((n) => {
        const cs = getComputedStyle(n);
        return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 1;
      });
      const saved = innerScrollers.map((n) => n.scrollTop);
      for (const n of innerScrollers) n.scrollTop = n.scrollHeight;
      // Inside an inner scroller = reachable by scrolling, UNLESS that scroller
      // itself ends below the screen. Outside every scroller = reachable only if
      // it is on screen.
      const cutScroller = innerScrollers.find((n) => n.getBoundingClientRect().bottom > vh + SLACK);
      const unreachable = cutScroller ?? inner.find((n) => {
        if (n === d || !shown(n)) return false;
        if (innerScrollers.some((sc) => sc !== n && sc.contains(n))) return false;
        const meaningful = n.matches(INTERACTIVE) ||
          Array.from(n.childNodes).some((c) => c.nodeType === 3 && (c.textContent ?? '').trim().length > 0);
        if (!meaningful) return false;
        const r = n.getBoundingClientRect();
        return r.bottom > vh + SLACK || r.top < -SLACK;
      });
      innerScrollers.forEach((n, i) => (n.scrollTop = saved[i]));
      issues.push({
        kind: 'sheet-overflow',
        severity: unreachable ? 'P1' : 'P2',
        detail: `dialog "${name}" extends ${Math.round(past)}px past the ${vh}px viewport${
          unreachable ? `; unreachable: ${describe(unreachable).slice(0, 80)}` : '; only padding/chrome overhangs (all content reachable)'
        }`,
      });
      continue;
    }
    if (!scrollerInside) {
      const cut = inner.find((n) => {
        const cs = getComputedStyle(n);
        return (cs.overflowY === 'hidden' || cs.overflowY === 'clip') && n.scrollHeight > n.clientHeight + 4 &&
          !ellipsisNear(n) && n.querySelector(INTERACTIVE);
      });
      if (cut) {
        issues.push({
          kind: 'sheet-overflow',
          detail: `dialog "${name}" clips ${cut.scrollHeight - cut.clientHeight}px of content containing controls, with no scroll: ${describe(cut)}`,
        });
      }
    }
  }

  // ── 3. clipped / covered interactive controls ──────────────────────────────
  {
    const seen = new Set<string>();
    const controls = Array.from(document.querySelectorAll(INTERACTIVE)).filter(shown).slice(0, 400);
    let reported = 0;
    for (const el of controls) {
      if (reported >= 12) break;
      // scrollIntoView also scrolls overflow:hidden boxes, which no finger can.
      // Put those back, or a control clipped by one would be measured as fine.
      // Per AXIS: `overflow-x-hidden overflow-y-auto` is an ordinary vertical
      // scroller, and restoring its scrollTop undid a legitimate scroll (read as
      // "only 28% visible" for controls a finger can reach).
      const pinned: [Element, number | null, number | null][] = [];
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const pinX = /hidden|clip/.test(cs.overflowX);
        const pinY = /hidden|clip/.test(cs.overflowY);
        if (pinX || pinY) pinned.push([n, pinX ? n.scrollLeft : null, pinY ? n.scrollTop : null]);
      }
      (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
      for (const [n, x, y] of pinned) {
        if (x !== null) n.scrollLeft = x;
        if (y !== null) n.scrollTop = y;
      }
      const { frac, r } = visibleRect(el);
      if (frac === 0) continue; // hidden by design (collapsed, off-canvas)
      if (frac < 0.9 && inCarousel(el)) continue;
      let problem = '';
      if (frac < 0.9 && !ellipsisNear(el)) {
        problem = `only ${Math.round(frac * 100)}% visible (outside viewport or clipping container)`;
      } else {
        const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
        const hit = document.elementFromPoint(cx, cy);
        if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
          const cover = fixedOrStickyAncestor(hit);
          if (cover && !cover.contains(el)) {
            problem = `centre covered by fixed UI ${describe(cover).slice(0, 90)}`;
          }
        }
      }
      if (!problem) continue;
      const key = `${describe(el).slice(0, 80)}|${problem.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reported++;
      issues.push({ kind: 'clipped', detail: `${describe(el)}: ${problem}` });
    }
  }

  // ── 4. content hidden behind a fixed bottom bar at max scroll ──────────────
  {
    const bars = all.filter((el) => {
      if (!shown(el)) return false;
      if (getComputedStyle(el).position !== 'fixed') return false;
      const r = el.getBoundingClientRect();
      return r.bottom >= vh - 24 && r.top > vh * 0.55 && r.width >= vw * 0.5 && r.height < vh * 0.4;
    });
    if (bars.length) {
      window.scrollTo({ top: doc.scrollHeight, behavior: 'instant' as ScrollBehavior });
      for (const s of scrollers()) s.scrollTop = s.scrollHeight;
      const barTop = Math.min(...bars.map((b) => b.getBoundingClientRect().top));
      const bar = bars.find((b) => b.getBoundingClientRect().top === barTop)!;
      const hidden: Element[] = [];
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        if (hidden.length >= 3) break;
        if (fixedAncestor(el)) continue;
        if (!shown(el)) continue;
        const ownText = Array.from(el.childNodes).some((c) => c.nodeType === 3 && (c.textContent ?? '').trim().length > 0);
        if (!ownText && !el.matches(INTERACTIVE) && !el.matches('img')) continue;
        const { frac, r } = visibleRect(el);
        if (frac === 0) continue;
        if (!(r.bottom > barTop + 4 && r.top < vh)) continue;
        // Hit-test, don't trust the bar's box: a nav wrapper is often a
        // full-width pointer-events-none strip around a smaller pill, and text
        // beside the pill is not hidden. Sample across the element's visible row.
        const y = Math.min(Math.max(r.top + r.height / 2, barTop + 2), vh - 2);
        const covered = [0.15, 0.5, 0.85].some((fx) => {
          const x = Math.min(Math.max(r.left + r.width * fx, 1), vw - 2);
          const hit = document.elementFromPoint(x, y);
          return !!hit && !el.contains(hit) && bars.some((b) => b.contains(hit));
        });
        if (covered) hidden.push(el);
      }
      if (hidden.length) {
        issues.push({
          kind: 'nav-occlusion',
          detail: `at max scroll ${hidden.length}+ element(s) sit under fixed bar ${describe(bar).slice(0, 70)} (top ${Math.round(barTop)}px): ${hidden.map((h) => describe(h).slice(0, 70)).join(' · ')}`,
        });
      }
    }
  }

  // ── 5. silent truncation ───────────────────────────────────────────────────
  {
    const groups = new Map<string, { n: number; sample: string }>();
    for (const el of all) {
      const cs = getComputedStyle(el);
      const ellipsis = cs.textOverflow === 'ellipsis' && cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1;
      const clamped = !!cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1;
      if (!ellipsis && !clamped) continue;
      if (!shown(el)) continue;
      const text = ((el as HTMLElement).innerText || '').trim();
      if (!text) continue;
      if (el.closest('[title]') && el.closest('[title]')!.contains(el)) continue;
      if (el.closest('a[href],[role="link"]')) continue; // the full value is one tap away
      const card = el.closest('button,[role="button"]');
      if (card && ((card as HTMLElement).innerText || '').trim().length > text.length + 10) continue; // a card that opens a detail view
      const sig = describe(el).replace(/ ".*"$/, '').slice(0, 90);
      const g = groups.get(sig) ?? { n: 0, sample: text.replace(/\s+/g, ' ').slice(0, 60) };
      g.n++;
      groups.set(sig, g);
    }
    for (const [sig, g] of groups) {
      issues.push({ kind: 'truncation', detail: `${g.n}× ${sig} cut, e.g. "${g.sample}"` });
    }
  }

  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  for (const s of scrollers()) s.scrollTop = 0;
  return issues;
}

export async function detectLayoutIssues(page: Page): Promise<LayoutIssue[]> {
  // Measure settled geometry, not an entrance slide in flight: tailwindcss-animate
  // keyframes ignore prefers-reduced-motion. Finite animations only (a spinner
  // never finishes), capped so a stuck one cannot stall the crawl.
  await page
    .evaluate(() =>
      Promise.race([
        Promise.all(
          document
            .getAnimations()
            .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
            .map((a) => a.finished.catch(() => undefined)),
        ),
        new Promise((r) => setTimeout(r, 2_000)),
      ]),
    )
    .catch(() => undefined);
  return (await page.evaluate(detect)) as LayoutIssue[];
}
