#!/usr/bin/env node
/**
 * smoke - does the deployed site actually WORK, not just "did the deploy succeed".
 *
 *   npm run smoke -- https://dormcheck.com
 *   npm run smoke -- http://localhost:4173      # a local `vite preview` build
 *
 * A green Vercel build says the bundle compiled; it says nothing about whether the app
 * boots in a browser. This loads the URL headlessly and asserts the things a user would
 * notice first:
 *   1. the document responds 200,
 *   2. the SPA actually mounts (#root gets children — an empty #root = white screen),
 *   3. the page boots with ZERO uncaught/console errors (minus known third-party noise),
 *   4. the /auth route is reachable and also mounts.
 *
 * Exit 0 = all assertions pass. Exit 1 = something broke, printed loudly with the cause.
 * It only reads the page; it changes nothing and signs into nothing.
 *
 * Console noise: real prod pages log some benign third-party errors (blocked analytics,
 * favicon). Those are ignored by DEFAULT_IGNORE; extend with DC_SMOKE_IGNORE="re1,re2".
 * Every ignored line is still printed (dimmed) so nothing hides.
 */
import { chromium } from '@playwright/test';

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const say = (s = '') => console.log(s);

const url = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!url) {
  say(`${C.r}✗ smoke: no URL given.${C.x}  Usage: npm run smoke -- <url>`);
  process.exit(1);
}
const NAV_TIMEOUT = Number(process.env.DC_SMOKE_NAV_TIMEOUT_MS) || 30_000;
const MOUNT_TIMEOUT = Number(process.env.DC_SMOKE_MOUNT_TIMEOUT_MS) || 15_000;
const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

const DEFAULT_IGNORE = [
  /favicon\.ico/i,
  /ResizeObserver loop/i,
  /analytics|speed-insights|web-vitals|vercel\.live|va\.vercel/i,
  /net::ERR_(BLOCKED_BY_CLIENT|ABORTED)/i,
  // Third-party asset CDNs — a font/tile outage degrades the page (fallback fonts) but
  // does not mean the deploy is broken, so it must not fail the smoke.
  /fonts\.googleapis\.com|fonts\.gstatic\.com/i,
  /Loading the stylesheet .*(fonts\.googleapis|gstatic)/i,
];
const IGNORE = [
  ...DEFAULT_IGNORE,
  ...(process.env.DC_SMOKE_IGNORE ? process.env.DC_SMOKE_IGNORE.split(',').map((s) => new RegExp(s.trim(), 'i')) : []),
];
const ignored = (msg) => IGNORE.some((re) => re.test(msg));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); };

const browser = await chromium.launch();
const errors = []; // {text, fatal}
try {
  // Preview deployments may keep Vercel Authentication enabled. The bypass is an
  // ignored local release credential; it is never bundled or committed.
  const page = await browser.newPage(protectionBypass ? {
    extraHTTPHeaders: {
      'x-vercel-protection-bypass': protectionBypass,
      'x-vercel-set-bypass-cookie': 'true',
    },
  } : {});
  page.on('console', (m) => { if (m.type() === 'error') { const t = m.text(); errors.push({ text: t, fatal: !ignored(t) }); } });
  page.on('pageerror', (e) => { const t = `[pageerror] ${e.message}`; errors.push({ text: t, fatal: !ignored(t) }); });
  page.on('requestfailed', (req) => {
    const t = `[requestfailed] ${req.url()} ${req.failure()?.errorText || ''}`;
    if (!ignored(t)) errors.push({ text: t, fatal: true });
  });

  // 1. Root document responds 200.
  let resp;
  try { resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }); }
  catch (e) { check(`GET ${url}`, false, `navigation failed: ${String(e.message || e).split('\n')[0]}`); throw new Abort(); }
  check(`GET ${url} → 200`, resp?.status() === 200, `status ${resp?.status()}`);

  // 2. SPA mounts — #root gets children (empty #root = white screen of death).
  try {
    await page.waitForFunction(() => { const r = document.querySelector('#root'); return r && r.children.length > 0; }, null, { timeout: MOUNT_TIMEOUT });
    check('app mounts (#root has children)', true);
  } catch { check('app mounts (#root has children)', false, '#root never populated within timeout'); }

  // 4. /auth route reachable + mounts (do it before the console verdict so its errors count too).
  const authUrl = new URL('/auth', url).toString();
  try {
    const ar = await page.goto(authUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    const ok200 = ar?.status() === 200;
    let mounted = false;
    try { await page.waitForFunction(() => { const r = document.querySelector('#root'); return r && r.children.length > 0; }, null, { timeout: MOUNT_TIMEOUT }); mounted = true; } catch { /* stays false */ }
    check(`auth page reachable (${authUrl})`, ok200 && mounted, ok200 ? (mounted ? '' : 'reached but did not mount') : `status ${ar?.status()}`);
  } catch (e) { check(`auth page reachable (${authUrl})`, false, `navigation failed: ${String(e.message || e).split('\n')[0]}`); }

  // 3. Zero fatal console errors across the whole run.
  const fatal = errors.filter((e) => e.fatal);
  check('zero console errors', fatal.length === 0, fatal.length ? `${fatal.length} error(s)` : '');
} catch (e) {
  if (!(e instanceof Abort)) check('unexpected', false, String(e.message || e).split('\n')[0]);
} finally {
  await browser.close();
}

// Report.
say(`${C.b}smoke${C.x}  ${C.d}${url}${C.x}`);
for (const r of results) say(`  ${r.ok ? `${C.g}✓${C.x}` : `${C.r}✗${C.x}`} ${r.name}${r.detail ? `  ${C.d}${r.detail}${C.x}` : ''}`);
if (errors.length) {
  say(`  ${C.d}console/network:${C.x}`);
  for (const e of errors) say(`    ${e.fatal ? `${C.r}✗${C.x}` : `${C.d}∘ ignored${C.x}`} ${(e.fatal ? '' : C.d) + e.text.slice(0, 200) + C.x}`);
}
const failed = results.filter((r) => !r.ok);
say('');
if (failed.length) {
  say(`${C.r}${C.b}✗ SMOKE FAILED${C.x} — ${failed.length} assertion(s): ${failed.map((f) => f.name).join('; ')}`);
  process.exit(1);
}
say(`${C.g}${C.b}✓ SMOKE PASSED${C.x} — site responds, mounts, auth reachable, no console errors.`);
process.exit(0);

function Abort() {}
