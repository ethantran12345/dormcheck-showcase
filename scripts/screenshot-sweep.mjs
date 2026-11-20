#!/usr/bin/env node
/**
 * Screenshot sweep — capture every public route at two viewports into one
 * timestamped folder, so a design direction can be judged SIDE BY SIDE instead
 * of one page at a time in a dev server. Sequential viewing is exactly the view
 * that hides templating.
 *
 *   npm run sweep
 *   npm run sweep -- --label warm-neutral-before
 *   npm run sweep -- --routes /,/for-students --label hero-only
 *
 * OUTPUT PATH IS A CONTRACT. Command Center's Taste tab reads
 * `the repo root/.screenshots/` directly to build its contact sheets:
 *
 *   .screenshots/<timestamp>/<route>-<width>.png
 *   .screenshots/<timestamp>/manifest.json    (so nothing has to glob filenames)
 *   .screenshots/<timestamp>/index.html       (a plain contact sheet, one scroll)
 *
 * Do not relocate or rename any of those. `<timestamp>` sorts lexicographically,
 * which is how the Taste tab orders runs newest-first.
 *
 * LOCAL STACK ONLY. This drives its own Vite server on a dedicated port with
 * `.env.e2e` injected — the same override `playwright.config.ts` and
 * `scripts/e2e/serve-verify.mjs` use, including the blank Turnstile site key.
 * A real (domain-bound) Turnstile key can never issue a token in a headless
 * localhost browser, so sign-in would be permanently disabled and look exactly
 * like a P0 auth bug. Never point this at prod.
 *
 * FRESH BROWSER PROCESS EVERY ~10 NAVIGATIONS. A long-lived Playwright session
 * degrades and screenshots start hanging indefinitely — a known failure mode
 * (it is why this script exists rather than the MCP browser). This is designed
 * around, not debugged: each batch launches its own Chromium process, captures
 * at most BATCH_SIZE pages, and is closed before the next batch starts.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Dedicated port: 8080 is Ethan's, 8123 is the audit crawl's. */
const PORT = 8124;
const BASE_URL = `http://127.0.0.1:${PORT}`;
/** Navigations per browser process. Past ~10 a session starts hanging. */
const BATCH_SIZE = 10;
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
];

/**
 * Public routes, curated rather than derived. Routes are declared across several
 * modules in `src/routes/`, and the parameterised ones (`/checklist/shared/:token`)
 * cannot be visited without seeded data — a glob of the router would produce
 * captures of the 404 page and call it coverage.
 */
const DEFAULT_ROUTES = [
  '/',
  '/for-students',
  '/for-universities',
  '/partners',
  '/about',
  '/ads',
  '/contact',
  '/feedback',
  '/waitlist',
  '/auth',
  '/privacy',
  '/terms',
];

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { routes: null, label: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--routes' && argv[i + 1]) {
      out.routes = argv[++i]
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => (r.startsWith('/') ? r : `/${r}`));
    } else if (argv[i] === '--label' && argv[i + 1]) {
      out.label = argv[++i].trim();
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('usage: npm run sweep -- [--routes /,/about] [--label <name>] [--rebuild-sheets]');
      process.exit(0);
    }
  }
  return out;
}

/** `/` → `home`, `/for-students` → `for-students`, `/a/b` → `a-b`. */
function slug(route) {
  const s = route.replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
  return s || 'home';
}

/** 2026-07-31T14-02-11 — lexicographically sortable, which the Taste tab relies on. */
function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}

// ---------------------------------------------------------------------------
// dev server (local stack only)
// ---------------------------------------------------------------------------

function requireFreePort() {
  const r = spawnSync('node', [path.join(ROOT, 'scripts/e2e/require-free-port.mjs'), String(PORT)], {
    stdio: 'inherit',
  });
  if (r.status !== 0) process.exit(1);
}

function loadLocalEnv() {
  const envFile = path.join(ROOT, '.env.e2e');
  if (!existsSync(envFile)) {
    console.error(
      `✗ ${envFile} not found.\n` +
        '  Run `npm run lane:bootstrap` first (it brings up the local stack and writes .env.e2e).',
    );
    process.exit(1);
  }
  loadEnv({ path: envFile });
  const url = process.env.VITE_SUPABASE_URL ?? '';
  if (!/127\.0\.0\.1|localhost/.test(url)) {
    console.error(`✗ Refusing to sweep: VITE_SUPABASE_URL (${url || 'empty'}) is not a local stack.`);
    process.exit(1);
  }
  // Mirrors playwright.config.ts webServerEnv exactly. Shell env beats
  // .env/.env.local, so the committed prod-pointing config cannot leak in.
  return {
    ...process.env,
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? '',
    VITE_MAPBOX_TOKEN: process.env.VITE_MAPBOX_TOKEN ?? 'pk.e2e.dummy',
    VITE_SITE_URL: BASE_URL,
    VITE_E2E_AUTOLOGIN: '0',
    VITE_TURNSTILE_SITE_KEY: '', // the trap — keep empty
  };
}

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

/**
 * Capture one batch in its own Chromium process. Returns the files written.
 * Any single page that fails is recorded and skipped — one bad route must not
 * cost the whole sweep.
 */
async function captureBatch(jobs, outDir) {
  const browser = await chromium.launch();
  const written = [];
  try {
    for (const job of jobs) {
      const context = await browser.newContext({
        viewport: { width: job.width, height: job.height },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce', // freeze scroll/entrance animation so runs are comparable
      });
      const page = await context.newPage();
      try {
        await page.goto(`${BASE_URL}${job.route}`, { waitUntil: 'networkidle', timeout: 30_000 });
        // Settle: reduced motion kills the reveals, but fonts and images still land.
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(outDir, job.file), fullPage: true, timeout: 30_000 });
        written.push(job);
        console.log(`  ✓ ${job.route} @ ${job.width}  →  ${job.file}`);
      } catch (err) {
        job.error = String(err?.message ?? err).split('\n')[0];
        console.error(`  ✗ ${job.route} @ ${job.width}: ${job.error}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return written;
}

// ---------------------------------------------------------------------------
// contact sheet
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Read one capture back as a `data:` URI.
 *
 * THE CONTACT SHEET MUST BE SELF-CONTAINED. It used to reference captures by
 * bare relative filename, which only resolves when the browser's base URL is the
 * run directory itself. It is not, in the one place the sheet is read most:
 * Command Center serves it from a FLAT query URL
 * (`/api/taste/shot?run=<ts>&file=index.html`), against which `foo.png` resolves
 * to `/api/taste/foo.png` and 404s — every image broken. Inlining costs a larger
 * HTML file and buys a sheet that renders identically over `file://`, over that
 * query URL, and after the folder is moved or copied anywhere.
 */
function dataUri(outDir, file) {
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${readFileSync(path.join(outDir, file)).toString('base64')}`;
}

/**
 * A plain, dependency-free contact sheet: every capture in one grid, labelled,
 * so a whole sweep is one scroll. Grouped by viewport because comparing a phone
 * shot against a desktop shot teaches nothing. Images are inlined — see
 * `dataUri` for why the sheet cannot rely on relative paths.
 */
function contactSheet(manifest, outDir) {
  const groups = manifest.viewports
    .map((w) => {
      const cells = manifest.routes
        .map((r) => {
          const file = r.files[String(w)];
          if (!file) return '';
          const src = dataUri(outDir, file);
          // The link keeps the relative filename: opening the full-resolution
          // PNG in its own tab is a file operation, not a rendering one, and a
          // multi-megabyte data: URI in the address bar helps nobody.
          return `<figure class="shot">
      <a href="${esc(file)}" target="_blank" rel="noreferrer"><img src="${src}" alt="${esc(r.route)} at ${w}px" loading="lazy"></a>
      <figcaption>${esc(r.route)} <span class="vp">${w}</span></figcaption>
    </figure>`;
        })
        .join('\n');
      return `<section>
    <h2>${w}px <span class="sub">${w === 390 ? 'phone' : 'desktop'}</span></h2>
    <div class="grid ${w === 390 ? 'narrow' : 'wide'}">${cells}</div>
  </section>`;
    })
    .join('\n');

  const failed = manifest.failures.length
    ? `<div class="warn"><b>${manifest.failures.length} capture(s) failed</b><ul>${manifest.failures
        .map((f) => `<li>${esc(f.route)} @ ${f.width}: ${esc(f.error)}</li>`)
        .join('')}</ul></div>`
    : '';

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sweep ${esc(manifest.label || manifest.startedAt)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; padding:24px; font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:#faf9f7; color:#1c1917; }
  @media (prefers-color-scheme: dark) { body { background:#1c1917; color:#f5f5f4; } figure.shot { background:#292524; border-color:#44403c; } }
  header { margin-bottom:20px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .meta { color:#78716c; font-size:12.5px; }
  h2 { font-size:15px; margin:28px 0 10px; }
  .sub { color:#78716c; font-weight:400; }
  .grid { display:grid; gap:14px; }
  .grid.narrow { grid-template-columns: repeat(auto-fill, minmax(210px,1fr)); }
  .grid.wide { grid-template-columns: repeat(auto-fill, minmax(340px,1fr)); }
  figure.shot { margin:0; background:#fff; border:1px solid #e7e5e4; border-radius:10px; overflow:hidden; }
  figure.shot img { display:block; width:100%; height:auto; }
  figcaption { padding:7px 10px; font-size:12px; border-top:1px solid #e7e5e4; display:flex; justify-content:space-between; gap:8px; }
  @media (prefers-color-scheme: dark) { figcaption { border-color:#44403c; } }
  .vp { color:#78716c; }
  .warn { border:1px solid #f2a900; background:#f2a90018; border-radius:10px; padding:10px 14px; margin:14px 0; font-size:13px; }
  .warn ul { margin:6px 0 0 18px; padding:0; }
</style>
<header>
  <h1>Screenshot sweep${manifest.label ? ` — ${esc(manifest.label)}` : ''}</h1>
  <div class="meta">${esc(manifest.startedAt)} · ${manifest.routes.length} routes · ${manifest.viewports.join('px, ')}px · captures are full-page, reduced-motion</div>
</header>
${failed}
${groups}
`;
}

/**
 * Re-emit index.html for every run already on disk, from its manifest — no
 * capture, no Vite, no browser. Runs swept before the images were inlined still
 * have a sheet that breaks when it is served rather than opened, and re-shooting
 * them would produce different pixels against today's code, destroying the very
 * comparison the folder exists to preserve.
 *
 *   npm run sweep -- --rebuild-sheets
 */
function rebuildSheets() {
  const root = path.join(ROOT, '.screenshots');
  if (!existsSync(root)) {
    console.error('✗ no .screenshots/ directory — nothing to rebuild.');
    process.exit(1);
  }
  const runs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  let rebuilt = 0;
  for (const run of runs) {
    const outDir = path.join(root, run);
    const manifestPath = path.join(outDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      console.log(`  · ${run} — no manifest.json, skipped`);
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    // Drop any capture whose PNG is gone, so one missing file cannot throw away
    // the whole sheet.
    manifest.routes = manifest.routes
      .map((r) => ({
        ...r,
        files: Object.fromEntries(
          Object.entries(r.files).filter(([, f]) => existsSync(path.join(outDir, f))),
        ),
      }))
      .filter((r) => Object.keys(r.files).length);
    writeFileSync(path.join(outDir, 'index.html'), contactSheet(manifest, outDir));
    console.log(`  ✓ ${run} — ${manifest.routes.length} route(s) inlined`);
    rebuilt++;
  }
  console.log(`\n✅ rebuilt ${rebuilt}/${runs.length} contact sheet(s); images are now inlined.\n`);
}

// ---------------------------------------------------------------------------

async function main() {
  if (process.argv.includes('--rebuild-sheets')) {
    console.log('\n📄 Rebuilding contact sheets from existing manifests (no capture)…\n');
    rebuildSheets();
    process.exit(0);
  }

  const args = parseArgs(process.argv.slice(2));
  const routes = args.routes ?? DEFAULT_ROUTES;

  console.log(`\n📸 Screenshot sweep — ${routes.length} routes × ${VIEWPORTS.length} viewports`);
  if (args.label) console.log(`   label: ${args.label}`);

  requireFreePort();
  const env = loadLocalEnv();

  const startedAt = new Date();
  const runId = stamp(startedAt);
  const outDir = path.join(ROOT, '.screenshots', runId);
  mkdirSync(outDir, { recursive: true });

  console.log(`   out:   .screenshots/${runId}\n`);
  console.log(`[1/3] starting Vite on ${BASE_URL} (local stack, Turnstile disabled)…`);
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  let exitCode = 0;

  try {
    if (!(await waitForServer(BASE_URL))) {
      console.error('✗ Vite did not come up in time.');
      process.exit(1);
    }

    // One job per (route, viewport), ordered viewport-major so a batch shares a
    // viewport and the browser is not resized mid-process.
    const jobs = [];
    for (const vp of VIEWPORTS) {
      for (const route of routes) {
        jobs.push({
          route,
          width: vp.width,
          height: vp.height,
          file: `${slug(route)}-${vp.width}.png`,
        });
      }
    }

    console.log(`[2/3] capturing ${jobs.length} screenshots in batches of ${BATCH_SIZE}…`);
    const done = [];
    const failures = [];
    for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
      const batch = jobs.slice(i, i + BATCH_SIZE);
      console.log(`  · batch ${Math.floor(i / BATCH_SIZE) + 1} (fresh browser process, ${batch.length} pages)`);
      const written = await captureBatch(batch, outDir);
      done.push(...written);
      failures.push(...batch.filter((b) => b.error));
    }

    console.log('[3/3] writing manifest.json + index.html…');
    const byRoute = new Map();
    for (const j of done) {
      const entry = byRoute.get(j.route) ?? { route: j.route, files: {} };
      entry.files[String(j.width)] = j.file;
      byRoute.set(j.route, entry);
    }
    const manifest = {
      label: args.label,
      startedAt: startedAt.toISOString(),
      viewports: VIEWPORTS.map((v) => v.width),
      routes: routes.filter((r) => byRoute.has(r)).map((r) => byRoute.get(r)),
      failures: failures.map((f) => ({ route: f.route, width: f.width, error: f.error })),
    };
    writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(path.join(outDir, 'index.html'), contactSheet(manifest, outDir));

    console.log(
      `\n✅ ${done.length}/${jobs.length} captured${failures.length ? ` · ${failures.length} failed` : ''}\n` +
        `   open .screenshots/${runId}/index.html\n` +
        '   (Command Center → Taste → Variants reads this folder directly)\n',
    );
    if (failures.length) exitCode = 1;
  } finally {
    vite.kill('SIGTERM');
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
