#!/usr/bin/env node
/**
 * Content-width gate — Identity P2 (Renewal Build Queue item 12). Sibling of
 * scripts/check-colors.mjs, check-primitives.mjs and check-glyphs.mjs; wired as
 * its own step in ci-dev-push.yml.
 *
 * WHY THIS EXISTS. Before the convention landed there were 290 `max-w-*`
 * utilities across src/**\/*.tsx in 16+ distinct values, 107 of them sitting on
 * an `mx-auto` page container. Every screen picked its own reading width by
 * hand, so the app's measure visibly jumped between routes (2xl on
 * Notifications, 4xl on Activity, 5xl on Team, 6xl on Dashboard, screen-2xl on
 * DormEdit, 7xl on Marketplace). Nothing caught it: it is not a type error, not
 * a lint error, not a test failure — it is a *design* outcome, and the only way
 * a design outcome stops drifting back is a counter that cannot grow.
 *
 * The fix is src/components/ui/page-container.tsx, which holds the four roles
 * (narrow / content / prose / wide) and the full written contract. THAT file is
 * the thing to read; this file only stops the drift returning.
 *
 * WHAT IT FLAGS, in feature code only (src/components/ui/ is allowlisted — the
 * primitives are where widths legitimately live):
 *
 *   RULE W1 — a hand-rolled page content container: a layout element
 *             (div/main/header/section/article/footer/ul) whose classes carry
 *             BOTH `mx-auto` and a bare `max-w-*`. That combination is the
 *             signature of "this element decides how wide the screen reads",
 *             and it should be <PageContainer width="…"> instead.
 *             Deliberately NOT flagged: `<p className="mx-auto max-w-sm">` and
 *             friends — a text measure is component intrinsic sizing, a
 *             different thing, and correct as written. Same for a Dialog's
 *             max-w-md, a chat bubble's max-w-[85%], an image's max-w-full.
 *
 *   RULE W2 — a PageContainer carrying a responsive or arbitrary width override
 *             (`lg:max-w-[1440px]`, `xl:max-w-6xl`) with NO comment in the three
 *             lines above it. Overrides are allowed — MyHomePage's bento shell
 *             is a real one — but an unexplained bespoke width is precisely the
 *             drift this replaces, so the reason has to be in the file.
 *
 * SAME RATCHET SHAPE as check-glyphs.mjs / check-primitives.mjs: a per-file
 * count is grandfathered in scripts/page-width-baseline.json and the gate
 * reports only when a file's count GROWS. A conversion only ever LOWERS a
 * count, so it never trips on real work; it catches a NEWLY hand-picked width.
 * The baseline is DEBT, not a blessing — the grandfathered entries are the
 * marketing landing system (its own `WRAP` convention in
 * src/components/marketing/landing/ui.tsx), global chrome rails (TopNav,
 * Footer, DormDetail), and the checklist's responsive two-column shells.
 * Shrink it, then re-run --write-baseline.
 *
 * Regenerate the baseline after a legitimate change:
 *     node scripts/check-page-width.mjs --write-baseline
 * Prove the gate still bites (no baseline needed, runs on inline fixtures):
 *     node scripts/check-page-width.mjs --self-test
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/strip-comments.mjs';
import { featureFilesOnly } from './lib/is-feature-file.mjs';

// fileURLToPath, not .pathname: on Windows a file: URL's pathname is "/D:/repo/", and
// resolve() reads the leading slash as root-relative, yielding "D:\D:\repo" — a path that
// does not exist. Every consumer then breaks somewhere far from here; the execSync below
// inherits it as cwd and fails with a spawnSync ENOENT naming cmd.exe, which looks like a
// missing shell rather than a bad directory.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE_PATH = resolve(ROOT, 'scripts/page-width-baseline.json');
const BLOCKING = process.env.PAGE_WIDTH_BLOCKING === '0' ? false : true;

/** The primitives own the width values; a max-w there is the definition, not drift. */
const isPrimitive = (f) => f.startsWith('src/components/ui/');

/** Elements that can plausibly BE a page body. A <p>/<span>/<li> cannot. */
const LAYOUT_TAGS = new Set([
  'div', 'main', 'header', 'section', 'article', 'footer', 'ul', 'nav', 'aside', 'form',
]);

/**
 * Blank out comments (preserving newlines, so line numbers stay true) before
 * scanning. Not cosmetic: the tag scanner below tracks quote characters, and an
 * apostrophe inside a `// the container's width…` note would open a string it
 * never closes, silently swallowing the rest of the file. MyHomePage's bento
 * container hid from this gate exactly that way during development.
 * `//` preceded by `:` is left alone so a `https://` inside a class string or
 * URL survives.
 */
function listFiles() {
  return featureFilesOnly(
    execSync("git ls-files 'src/*.tsx' 'src/**/*.tsx'", { cwd: ROOT, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
  );
}

/**
 * Walk JSX opening tags, quote- and brace-aware so `className={cn(a, b)}` and
 * `onClick={() => x > y}` never terminate a tag early. Same scanner shape as
 * check-glyphs.mjs.
 */
function scanTags(code) {
  const tags = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '<') continue;
    if (code[i + 1] === '/') continue;
    let j = i + 1;
    if (!/[A-Za-z_]/.test(code[j] || '')) continue;
    let name = '';
    while (j < code.length && /[A-Za-z0-9_.$]/.test(code[j])) name += code[j++];
    let depth = 0, quote = null, k = j;
    for (; k < code.length; k++) {
      const c = code[k];
      if (quote) { if (c === '\\') { k++; continue; } if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth--; continue; }
      if (c === '>' && depth === 0) break;
    }
    if (k >= code.length) break;
    tags.push({ name, raw: code.slice(i, k + 1), index: i });
    i = k;
  }
  return tags;
}

/** Every string-literal class token in a tag's className/class attribute. */
function classTokens(raw) {
  const attr = raw.match(/\bclass(?:Name)?\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\{)/);
  if (!attr) return [];
  let body;
  if (attr[1] === '{') {
    body = (raw.slice(attr.index).match(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g) || []).join(' ')
      .replace(/["'`]/g, ' ');
  } else {
    body = attr[1].slice(1, -1);
  }
  return body.split(/\s+/).filter(Boolean);
}

const isBareMaxW = (t) => /^max-w-/.test(t);
const isPrefixedMaxW = (t) => /^[a-z0-9]+:max-w-/.test(t);

/**
 * Is this tag centring itself AND picking its own width — at any single
 * breakpoint? `mx-auto max-w-4xl` is the obvious shape, but a container that
 * only becomes a centred page body on desktop writes it as
 * `md:mx-auto md:max-w-[1400px]` — same decision, same drift, and invisible to
 * a bare-token check. RoommatePage hid from this gate exactly that way.
 * The prefixes have to MATCH: `mx-auto lg:max-w-6xl` on a card is intrinsic
 * sizing, not a page body, so pairing across breakpoints would be a false
 * positive.
 */
function widthDecidingPrefix(tokens) {
  if (tokens.includes('mx-auto') && tokens.some(isBareMaxW)) return '';
  const centred = new Set(
    tokens.map((t) => /^([a-z0-9]+):mx-auto$/.exec(t)?.[1]).filter(Boolean),
  );
  for (const t of tokens) {
    const m = /^([a-z0-9]+):max-w-/.exec(t);
    if (m && centred.has(m[1])) return m[1];
  }
  return null;
}

export function scanCode(code) {
  const src = stripComments(code);
  // Comment lookback reads the ORIGINAL lines — stripComments blanks the
  // `/* … */` markers, so a `{/* reason */}` above the tag would read as absent.
  const lines = code.split('\n');
  const hits = { w1: 0, w2: 0 };
  const detail = [];

  for (const tag of scanTags(src)) {
    const tokens = classTokens(tag.raw);
    if (tokens.length === 0) continue;
    const line = src.slice(0, tag.index).split('\n').length;

    if (tag.name === 'PageContainer') {
      // W2 — an override is fine, an UNEXPLAINED override is not.
      if (!tokens.some(isPrefixedMaxW) && !tokens.some(isBareMaxW)) continue;
      const above = lines.slice(Math.max(0, line - 4), line - 1).join('\n');
      if (/\/\/|\{\s*\/\*/.test(above)) continue;
      hits.w2++;
      detail.push({ rule: 'W2', line, why: 'width override on PageContainer with no reason in the file' });
      continue;
    }

    // W1 — a hand-rolled page content container.
    if (!LAYOUT_TAGS.has(tag.name)) continue;
    const bp = widthDecidingPrefix(tokens);
    if (bp === null) continue;
    hits.w1++;
    detail.push({
      rule: 'W1',
      line,
      why: bp
        ? `hand-picked page width at the ${bp}: breakpoint — use <PageContainer width="…">`
        : 'hand-picked page width — use <PageContainer width="…">',
    });
  }
  return { hits, detail };
}

const FIX = {
  W1: 'Replace the element with <PageContainer width="narrow|content|prose|wide"> and keep padding/spacing in className. Contract: src/components/ui/page-container.tsx.',
  W2: 'Keep the override, but write the reason on the line above it — an unexplained bespoke width is the drift this gate replaces.',
};

// ── self-test: the gate has to be SEEN to fail, not assumed to ────────────────
if (process.argv.includes('--self-test')) {
  const cases = [
    ['off-convention page container is flagged',
      '<div className="mx-auto w-full max-w-4xl px-4">x</div>', 'w1', 1],
    ['PageContainer is not flagged',
      '<PageContainer width="content" className="px-4">x</PageContainer>', 'w1', 0],
    ['a text measure on <p> is NOT a page container',
      '<p className="mx-auto max-w-sm text-sm">x</p>', 'w1', 0],
    ['a component intrinsic width without mx-auto is not flagged',
      '<div className="w-full max-w-[400px]">x</div>', 'w1', 0],
    ['cn() call sites are scanned too',
      '<main className={cn("mx-auto max-w-2xl", isMobile && "px-4")}>x</main>', 'w1', 1],
    ['a breakpoint-prefixed page container is flagged (RoommatePage shape)',
      '<div className="w-full px-4 md:mx-auto md:max-w-[1400px] md:pb-12">x</div>', 'w1', 1],
    ['prefixed centring with a MISMATCHED width breakpoint is not a page body',
      '<div className="md:mx-auto lg:max-w-6xl">x</div>', 'w1', 0],
    ['a prefixed width with no centring at all is intrinsic sizing',
      '<div className="w-full md:max-w-[1400px]">x</div>', 'w1', 0],
    // The comment is MULTI-LINE and contains an apostrophe: the pre-fix
    // stripper deleted it outright, which collapsed both lines into one and
    // reported this container on line 1. Line 3 is the truth.
    ['comments never shift the reported line (offset-preserving strip)',
      '{/* the container\'s width\n    is deliberate */}\n<div className="mx-auto max-w-4xl">x</div>', 'w1', 1, 3],
    ['unexplained override on PageContainer is flagged',
      '<PageContainer width="wide" className="lg:max-w-[1440px]">x</PageContainer>', 'w2', 1],
    ['explained override is allowed',
      '// lg widens for the bento shell\n<PageContainer width="wide" className="lg:max-w-[1440px]">x</PageContainer>', 'w2', 0],
  ];
  let failed = 0;
  for (const [name, code, rule, want, wantLine] of cases) {
    const { hits, detail } = scanCode(code);
    const got = hits[rule];
    const gotLine = detail.find((d) => d.rule === rule.toUpperCase())?.line;
    const ok = got === want && (wantLine === undefined || gotLine === wantLine);
    if (!ok) failed++;
    const lineNote = wantLine === undefined ? '' : `, line want ${wantLine}, got ${gotLine}`;
    console.log(`${ok ? '✓' : '✗'} ${name}  (${rule}: want ${want}, got ${got}${lineNote})`);
  }
  console.log(failed === 0 ? '\nself-test passed — the gate bites.' : `\n${failed} self-test case(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── normal run ───────────────────────────────────────────────────────────────
const files = listFiles();
const counts = { w1: {}, w2: {} };
const details = {};
for (const f of files) {
  if (isPrimitive(f)) continue;
  const { hits, detail } = scanCode(readFileSync(resolve(ROOT, f), 'utf8'));
  if (hits.w1) counts.w1[f] = hits.w1;
  if (hits.w2) counts.w2[f] = hits.w2;
  if (detail.length) details[f] = detail;
}

if (process.argv.includes('--write-baseline')) {
  const sorted = { w1: {}, w2: {} };
  for (const rule of ['w1', 'w2']) {
    for (const k of Object.keys(counts[rule]).sort()) sorted[rule][k] = counts[rule][k];
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + '\n');
  const total = Object.values(sorted.w1).reduce((a, b) => a + b, 0)
    + Object.values(sorted.w2).reduce((a, b) => a + b, 0);
  console.log(`wrote ${BASELINE_PATH} — ${total} grandfathered site(s).`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { w1: {}, w2: {} };

const growth = [];
for (const rule of ['w1', 'w2']) {
  for (const [file, n] of Object.entries(counts[rule])) {
    const was = baseline[rule]?.[file] ?? 0;
    if (n > was) growth.push({ rule: rule.toUpperCase(), file, was, now: n });
  }
}

const debt = Object.values(baseline.w1 ?? {}).reduce((a, b) => a + b, 0)
  + Object.values(baseline.w2 ?? {}).reduce((a, b) => a + b, 0);

if (growth.length === 0) {
  console.log(`✓ content-width gate: no new hand-picked page widths (${debt} grandfathered).`);
  process.exit(0);
}

console.error(`\n✗ content-width gate: ${growth.length} file(s) grew off-convention page containers.\n`);
for (const g of growth) {
  console.error(`  [${g.rule}] ${g.file}  ${g.was} → ${g.now}`);
  for (const d of (details[g.file] ?? []).filter((d) => d.rule === g.rule)) {
    console.error(`         line ${d.line}: ${d.why}`);
  }
  console.error(`         FIX: ${FIX[g.rule]}\n`);
}
console.error('A page\'s body width is a ROLE, not a number: narrow / content / prose / wide.');
console.error('Contract + the four roles: src/components/ui/page-container.tsx');
console.error('If a conversion legitimately lowered counts elsewhere, re-run with --write-baseline.\n');
process.exit(BLOCKING ? 1 : 0);
