#!/usr/bin/env node
/**
 * First-paint budget for the two public HTML entries.
 *
 * `dist/index.html` (the signed-out landing page) and `dist/waitlist.html` are
 * the same SPA shell with different OG tags, so whatever the entry graph drags
 * in is downloaded before either page paints. Two regressions have already
 * happened here and both were invisible in review:
 *
 *   1. `mapbox-gl` pinned to a `manualChunks` name became the home of the
 *      bundler's shared `__vite__preload` helper, which every chunk with a
 *      dynamic import() imports statically -> 1.8 MB of map engine on first
 *      paint of a page with no map (see the note in vite.config.ts).
 *   2. A static `import { ChatWidget }` in App.tsx made the whole messaging
 *      surface eager -> ~470 KB for a widget that paints nothing until opened.
 *
 * Run after `npm run build`:  node scripts/check-first-paint.mjs
 * Env: DC_FIRST_PAINT_KB to override the byte budget.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

// Package name fragments that must never be reachable from an entry without a
// dynamic import() in between. Matched against eager chunk file names AND the
// chunks' own contents, since chunk names are derived from an arbitrary module.
const BANNED = [
  { label: 'mapbox-gl', test: (name, body) => name.includes('mapbox') || (body.includes('mapboxgl') && body.includes('meshoptUrl')) },
];

const BUDGET_KB = Number(process.env.DC_FIRST_PAINT_KB || 1800);

if (!fs.existsSync(DIST)) {
  console.error('✗ dist/ not found — run `npm run build` first.');
  process.exit(1);
}

let failed = false;

for (const page of ['index.html']) {
  const file = path.join(DIST, page);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  const eager = [...new Set([...scripts, ...preloads])];

  let bytes = 0;
  const hits = [];
  for (const ref of eager) {
    const p = path.join(DIST, ref.replace(/^\//, ''));
    if (!fs.existsSync(p)) continue;
    bytes += fs.statSync(p).size;
    const name = path.basename(p);
    const body = fs.readFileSync(p, 'utf8');
    for (const b of BANNED) if (b.test(name, body)) hits.push(`${b.label} via ${name}`);
  }

  const kb = bytes / 1024;
  console.log(`${page}: ${eager.length} eager chunk(s), ${kb.toFixed(1)} KB JS`);

  for (const h of [...new Set(hits)]) {
    console.error(`  ✗ ${h} is on the critical path — it must load behind a dynamic import().`);
    failed = true;
  }
  if (kb > BUDGET_KB) {
    console.error(`  ✗ first-paint JS ${kb.toFixed(1)} KB exceeds the ${BUDGET_KB} KB budget.`);
    failed = true;
  }
}

if (failed) {
  console.error('\nFirst-paint budget failed. Trace the eager import chain before raising the budget.');
  process.exit(1);
}
console.log('✓ first-paint budget OK');
