import { expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { a11yEnabled, a11yStrict, runAxeScan, type AxeViolationRecord } from './a11y';
import {
  CLS_GOOD,
  CLS_POOR,
  clsEnabled,
  formatCls,
  installClsObserver,
  readCls,
  type ClsRecord,
} from './cls';
import { detectLayoutIssues, type LayoutKind } from './layout';
import type { Persona, RouteSpec } from './routes';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPORT_DIR = path.resolve(HERE, '../../docs/audits/app-bug-audit-report');
const SCREENS_DIR = path.join(REPORT_DIR, 'screens');
const RECORDS_DIR = path.join(REPORT_DIR, 'records');

for (const d of [REPORT_DIR, SCREENS_DIR, RECORDS_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

/**
 * The commit this crawl is measuring, and when it started. `run-audit.sh` exports
 * both so every worker agrees; a standalone `npx playwright test` falls back to
 * resolving HEAD itself rather than emitting unstamped (and therefore
 * unrenderable) records.
 */
export const RUN_SHA: string =
  process.env.AUDIT_RUN_SHA ||
  (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  })();
export const RUN_STARTED_AT: string = process.env.AUDIT_RUN_STARTED_AT || new Date().toISOString();

export type Severity = 'P0' | 'P1' | 'P2';
export type FindingKind =
  | 'pageerror' // uncaught JS exception
  | 'console-error'
  | 'network' // 4xx / 5xx response
  | 'blank-root'
  | 'wrong-outcome' // route did not behave as the persona expected
  | 'a11y' // axe-core WCAG 2.1 AA violation
  | 'cls' // cumulative layout shift over the "good" bar
  // Layout detectors (e2e/lib/layout.ts), only in layout mode:
  | 'overflow-x' // page scrolls sideways / content cut at the right edge
  | 'clipped' // control partly outside its container, or covered by fixed UI
  | 'sheet-overflow' // open dialog/sheet taller than the viewport with no scroll
  | 'nav-occlusion' // last content hidden behind the bottom nav / notice at max scroll
  | 'truncation'; // ellipsis/line-clamp with no way to read the full value

/** Severity per layout kind. A cut-off control is a broken flow (P1); a cut-off label is P2. */
const LAYOUT_SEVERITY: Record<LayoutKind, Severity> = {
  'overflow-x': 'P1',
  clipped: 'P1',
  'sheet-overflow': 'P1',
  'nav-occlusion': 'P1',
  truncation: 'P2',
};

/**
 * One layout pass = one viewport × theme × (optional) locale / legal-notice
 * state, e.g. `390-dark`, `390-light-zh`. Set by e2e/playwright.layout.config.ts
 * through project metadata; absent on the classic 1280 crawl.
 */
export interface AuditOptions {
  variant?: string;
  /** Run the layout detectors (AUDIT_LAYOUT=1 runs). */
  layout?: boolean;
  /** Override the A11Y env switch for this visit. */
  a11y?: boolean;
  /** Open the state to measure (a sheet, a palette) after the page settles. */
  afterLoad?: (page: Page) => Promise<void>;
}

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  detail: string;
}

export interface PageRecord {
  /**
   * Provenance stamp (queue item 8c). Every record says which commit produced it
   * and when the run started, so build-report.mjs can refuse to render a record
   * set left behind by an earlier run. Without this, a crawl that never executed
   * (occupied :8123) left the previous run's records on disk and the report was
   * rebuilt from them and printed as current — pre-fix numbers presented as
   * post-fix, biased toward "we're done".
   */
  runSha: string;
  runStartedAt: string;
  persona: Persona;
  routeId: string;
  label: string;
  path: string;
  finalUrl: string;
  expected: string;
  outcome: string;
  screenshot: string;
  findings: Finding[];
  ignored: string[]; // benign noise we filtered out (kept for transparency)
  variant?: string; // layout pass, e.g. "390-dark" (absent on the classic crawl)
  layoutScan?: string; // 'ok' | 'skipped' | 'failed: …' (layout mode only)
  axe?: AxeViolationRecord[]; // WCAG 2.1 AA violations on this page (absent when A11Y=0 or page redirected)
  cls?: ClsRecord; // measured cumulative layout shift (absent when CLS=0)
}

/**
 * Noise that is NOT an app bug in this local/dev audit context:
 *  - Mapbox tiles/telemetry (we run with a dummy token on purpose)
 *  - Vercel analytics/speed-insights beacons (no backend on the dev server)
 *  - Vite HMR, React DevTools nag, Router future-flag warnings
 *  - favicon / Google Fonts 404s
 */
const BENIGN_URL = [
  'mapbox.com',
  'mapbox-gl',
  '/_vercel/',
  'vercel-insights.com',
  'vercel-scripts.com',
  'vercel-analytics',
  'speed-insights',
  'favicon',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  '.hot-update.',
  'chrome-extension',
];

const BENIGN_CONSOLE = [
  'download the react devtools',
  '[vite]',
  'react router future flag',
  'mapbox',
  'webgl',
  'failed to load resource', // the network listener captures these with a real status
  'punycode',
  'the above error occurred', // React's own re-log of an error we already catch via pageerror
  '404 error: user attempted to access non-existent route', // NotFound.tsx logs this BY DESIGN
];

const isBenignUrl = (url: string) => BENIGN_URL.some((s) => url.includes(s));
const isBenignConsole = (msg: string) => {
  const m = msg.toLowerCase();
  return BENIGN_CONSOLE.some((s) => m.includes(s));
};

/**
 * CLS and axe belong to the route the crawl requested, not to a different page
 * reached through an automatic auth, authorization, or canonical redirect.
 * Destination routes are crawled separately, after their own navigation starts.
 */
export function stayedOnRequestedRoute(requestedPath: string, finalPath: string): boolean {
  const normalize = (value: string) => value === '/' ? value : value.replace(/\/+$/, '');
  return normalize(requestedPath) === normalize(finalPath);
}

/** Did the DOM end up effectively blank (white screen / unmounted app)? */
async function isBlankRoot(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return true;
    const text = (root.textContent ?? '').trim();
    // Only a spinner / nothing visible counts as blank.
    return root.children.length === 0 || text.length === 0;
  });
}

/**
 * Is this page the `ComingSoon` placeholder (`src/components/ComingSoon.tsx`)?
 *
 * This asks the DOM for the component, not for the words. It used to test
 * `/coming soon/i` against the whole body text, which made any page that merely
 * SAYS "coming soon" indistinguishable from the gate. `/my-home` says it twice
 * in ordinary copy — `HomeHero` renders "Move-in date coming soon" and
 * `MyHomePage` renders "date coming soon" for a student whose dorm has no exact
 * move-in date yet — so every persona's My Home was classified `coming-soon`,
 * and with it every route that redirects there (`/`, `/auth`, and `/admin*` for
 * a non-admin). That was 10 of the 13 P1 "wrong-outcome" findings in the
 * 2026-08-16 audit: one substring, ten false alarms, and no way to see a real
 * gate regression underneath them.
 *
 * `data-testid` first because it survives copy edits; the `h1` is a fallback so
 * an accidentally-dropped testid degrades to the old (still component-shaped)
 * signal instead of silently reporting every gated route as rendered.
 */
async function looksComingSoon(page: Page): Promise<boolean> {
  if ((await page.locator('[data-testid="coming-soon"]').count()) > 0) return true;
  return (await page.locator('h1', { hasText: /is coming soon$/i }).count()) > 0;
}

/**
 * Drive one route as one persona, collect findings, screenshot, and persist a record.
 * Returns the findings so the calling test can assert.
 */
export async function auditRoute(
  page: Page,
  testInfo: TestInfo,
  persona: Persona,
  route: RouteSpec,
  opts: AuditOptions = {},
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const ignored: string[] = [];

  page.on('pageerror', (err) => {
    findings.push({ kind: 'pageerror', severity: 'P0', detail: `${err.name}: ${err.message}` });
  });
  const seenConsole = new Set<string>();
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (isBenignConsole(text)) {
      ignored.push(`console: ${text}`);
      return;
    }
    // Dedupe: a render loop fires the same warning dozens of times - record it once.
    const key = text.slice(0, 120);
    if (seenConsole.has(key)) return;
    seenConsole.add(key);
    findings.push({ kind: 'console-error', severity: 'P1', detail: text });
  });
  page.on('response', (res) => {
    const status = res.status();
    if (status < 400) return;
    const url = res.url();
    if (isBenignUrl(url)) {
      ignored.push(`net ${status}: ${url}`);
      return;
    }
    findings.push({ kind: 'network', severity: status >= 500 ? 'P0' : 'P1', detail: `${status} ${res.request().method()} ${url}` });
  });

  // The layout-shift observer has to exist before the first paint, so install it
  // ahead of the navigation — attached afterwards it would score every settled
  // page as a flawless 0.
  const measureCls = clsEnabled();
  if (measureCls) await installClsObserver(page);

  // Navigate. A navigation failure itself is a P0.
  try {
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
  } catch (e) {
    findings.push({ kind: 'pageerror', severity: 'P0', detail: `navigation failed: ${(e as Error).message}` });
  }
  // Let lazy chunks, redirects, and data loads settle.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);

  if (opts.afterLoad) {
    try {
      await opts.afterLoad(page);
    } catch (e) {
      findings.push({ kind: 'wrong-outcome', severity: 'P1', detail: `could not open the state under test: ${(e as Error).message}` });
    }
  }

  const finalUrl = new URL(page.url()).pathname;
  const stayedOnRoute = stayedOnRequestedRoute(route.path.split('?')[0], finalUrl);
  if (!stayedOnRoute) {
    ignored.push(`surface checks skipped: ${route.path} redirected to ${finalUrl}`);
  }

  // Determine outcome vs expectation.
  const expected = route.expect[persona];
  let outcome: string;
  // The auth funnel is /auth plus the /select-school picker, which /auth
  // redirects to when more than one school is active and none is chosen yet
  // (multi-university). A protected route bouncing an anon user to either one is
  // a valid auth redirect. Landing ON the funnel because the route itself is in
  // it is not a "redirect" - only count it when sent there from another path.
  const inAuthFunnel = (u: string) => u.startsWith('/auth') || u.startsWith('/select-school');
  const routeIsAuth =
    route.path === '/auth' || route.path.startsWith('/auth/') || route.path === '/select-school';
  const redirectedToAuth = inAuthFunnel(finalUrl) && !routeIsAuth;
  const comingSoon = await looksComingSoon(page);
  const blank = await isBlankRoot(page);

  if (redirectedToAuth) outcome = 'redirect-auth';
  else if (comingSoon) outcome = 'coming-soon';
  else outcome = 'render';

  if (blank && !redirectedToAuth) {
    findings.push({ kind: 'blank-root', severity: 'P0', detail: `#root rendered blank at ${finalUrl}` });
  }

  // Read the layout-shift score BEFORE axe injects its bundle and before the
  // full-page screenshot, so the number describes the app's own settling and
  // nothing the harness did to the page.
  let cls: ClsRecord | undefined;
  if (measureCls && stayedOnRoute && !redirectedToAuth && !blank) {
    cls = (await readCls(page)) ?? undefined;
    if (cls && cls.value > CLS_GOOD) {
      findings.push({
        kind: 'cls',
        // Over 0.25 the page visibly jumps under the user's thumb — treat it like
        // any other quality regression, not a crash.
        severity: cls.value > CLS_POOR ? 'P1' : 'P2',
        detail: formatCls(cls),
      });
    }
  }

  // Axe WCAG 2.1 AA scan. Skip pages that redirected to /auth - the persona never saw
  // the route's real UI, and /auth itself is scanned via its own route entry.
  let axe: AxeViolationRecord[] | undefined;
  if ((opts.a11y ?? a11yEnabled()) && stayedOnRoute && !redirectedToAuth && !blank) {
    try {
      axe = await runAxeScan(page);
      for (const v of axe) {
        const severe = v.impact === 'critical' || v.impact === 'serious';
        findings.push({
          kind: 'a11y',
          severity: severe ? (a11yStrict() ? 'P0' : 'P1') : 'P2',
          detail: `${v.ruleId} (${v.impact}): ${v.help} [${v.nodeCount} nodes, e.g. ${v.sampleTargets[0] ?? '?'}] ${v.helpUrl}`,
        });
      }
    } catch (e) {
      ignored.push(`axe scan failed: ${(e as Error).message}`);
    }
  }

  // Layout detectors run before the screenshot: they scroll the page to measure
  // and return it to the top, so the full-page shot still starts at the header.
  // `layoutScan` is stamped on the record so the report can count failed scans:
  // a detector that throws on every page would otherwise read as "0 cut-offs".
  let layoutScan: string | undefined;
  if (opts.layout && (redirectedToAuth || blank)) layoutScan = 'skipped';
  if (opts.layout && !redirectedToAuth && !blank) {
    layoutScan = 'ok';
    try {
      for (const issue of await detectLayoutIssues(page)) {
        findings.push({ kind: issue.kind, severity: issue.severity ?? LAYOUT_SEVERITY[issue.kind], detail: issue.detail });
      }
    } catch (e) {
      layoutScan = `failed: ${(e as Error).message.slice(0, 200)}`;
    }
  }

  if (expected !== 'any' && expected !== outcome && !(route.allowNotFound && outcome === 'render')) {
    // A gated route that renders for admin, or a not-found that still renders, are fine.
    const tolerable =
      (expected === 'render' && route.allowNotFound) ||
      // anon hitting a gated route may land on ComingSoon OR be allowed to render an empty public shell
      false;
    if (!tolerable) {
      findings.push({
        kind: 'wrong-outcome',
        severity: 'P1',
        detail: `expected "${expected}" but got "${outcome}" (final: ${finalUrl})`,
      });
    }
  }

  // Screenshot (full page) regardless of pass/fail - the report needs visuals.
  const stem = `${persona}-${route.id}${opts.variant ? `@${opts.variant}` : ''}`;
  const shotName = `${stem}.png`;
  const shotPath = path.join(SCREENS_DIR, shotName);
  await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});

  const record: PageRecord = {
    runSha: RUN_SHA,
    runStartedAt: RUN_STARTED_AT,
    persona,
    routeId: route.id,
    label: route.label,
    path: route.path,
    finalUrl,
    expected,
    outcome,
    screenshot: path.relative(REPORT_DIR, shotPath),
    findings,
    ignored,
    variant: opts.variant,
    layoutScan,
    axe,
    cls,
  };
  fs.writeFileSync(
    path.join(RECORDS_DIR, `${stem}.json`),
    JSON.stringify(record, null, 2),
  );

  // Attach to the Playwright HTML report too.
  await testInfo.attach(shotName, { path: shotPath, contentType: 'image/png' }).catch(() => {});

  return findings;
}

/** Split findings into hard (crash-class) vs soft (quality) for assertion strategy. */
export function partitionFindings(findings: Finding[]) {
  const hard = findings.filter((f) => f.kind === 'pageerror' || f.kind === 'blank-root' || f.severity === 'P0');
  const soft = findings.filter((f) => !hard.includes(f));
  return { hard, soft };
}

/** Assert no findings, with crash-class issues failing hard and quality issues soft. */
export function assertNoFindings(findings: Finding[]) {
  const { hard, soft } = partitionFindings(findings);
  // Hard: a crash/blank/5xx is always a real failure.
  expect(hard, `crash-class findings:\n${hard.map((f) => `  [${f.severity}] ${f.kind}: ${f.detail}`).join('\n')}`).toEqual([]);
  // Soft: console-errors / 4xx / wrong-outcome are reported but don't abort the crawl.
  expect.soft(soft, `quality findings:\n${soft.map((f) => `  [${f.severity}] ${f.kind}: ${f.detail}`).join('\n')}`).toEqual([]);
}
