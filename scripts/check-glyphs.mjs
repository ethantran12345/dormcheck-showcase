#!/usr/bin/env node
/**
 * Glyph-cascade gate — the [&_svg] trap (Component Primitive Adoption ADR,
 * amended 2026-07-27). Sibling of scripts/check-primitives.mjs and
 * scripts/check-colors.mjs; wired as its own step in ci-dev-push.yml.
 *
 * WHY THIS EXISTS. `Button`'s cva base carries DESCENDANT rules:
 *
 *     [&_svg]:size-4  [&_svg]:shrink-0  [&_svg]:text-current
 *
 * A descendant selector (`.btn svg`) has higher specificity than a utility on
 * the svg itself (`.size-6`). So a glyph written as
 *
 *     <Button><Check className="size-6" /></Button>
 *
 * renders at 16px, NOT 24px — silently. This bit TWICE during workstream A
 * (T3.6 and T3.6b) and NOTHING caught it: typecheck, eslint, 593 tests, build,
 * lint:colors and lint:primitives were all green across both broken states.
 * They stay green because this is a CSS *specificity* outcome — it only exists
 * once real Tailwind CSS is applied, and jsdom does not compute cascaded CSS.
 * A vitest render therefore CANNOT see it. Hence a static-pattern gate.
 *
 * WHAT IT FLAGS, in feature code only (src/components/ui/ is allowlisted — the
 * primitives are where the base rules legitimately live):
 *
 *   RULE G1 — a lucide icon / <svg> inside a <Button> (or any element whose own
 *             className goes through buttonVariants) carrying a bare SIZE class
 *             (size-*, h-*, w-*). Loses to [&_svg]:size-4.
 *   RULE G2 — the same glyph carrying a bare COLOUR class (text-<colour>).
 *             Loses to [&_svg]:text-current (or a variant's [&_svg]:text-*).
 *   RULE G3 — the INHERIT ROUTE: a button that holds a glyph and states a plain
 *             text-<colour> on ITSELF, with no [&_svg]:text-* group. This was
 *             the documented T3.6 remedy and it is WRONG: the tint then depends
 *             on a third thing (whatever the button's own colour actually
 *             resolves to), and measured live the checklist CollapsibleSection
 *             chevrons came out rgb(1,5,14) foreground instead of rgb(117,108,97)
 *             muted. See DECISIONS 2026-07-27.
 *
 * THE FIX, in one line (also printed as the error message so the next dev does
 * not rediscover it): state the override in the SAME descendant-rule group the
 * base uses — `[&_svg]:size-*` / `[&_svg]:text-*` ON THE BUTTON — so
 * tailwind-merge resolves it against the base and exactly one wins. Never put
 * it on the svg, and never rely on inherited currentColor. When ONE button
 * holds glyphs at two different sizes or tints, the odd one out re-asserts with
 * `!` (`!size-3`), which is why `!`-marked classes are deliberately exempt here.
 *
 * SAME RATCHET SHAPE as check-primitives.mjs: a per-file count is grandfathered
 * in scripts/glyph-baseline.json and the gate reports only when a file's count
 * GROWS. A cleanup only ever LOWERS a count, so it never trips on real work; it
 * catches a NEWLY added mis-scoped glyph class. The baseline is DEBT, not a
 * blessing — shrink it, then re-run --write-baseline.
 *
 * Regenerate the baseline after a legitimate change:  node scripts/check-glyphs.mjs --write-baseline
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
const BASELINE_PATH = resolve(ROOT, 'scripts/glyph-baseline.json');

// WARN while the grandfathered list is drawn down; flip to true once feature
// code is clean. Growth is reported either way.
const BLOCKING = process.env.GLYPH_BLOCKING === '0' ? false : true;

// The primitives own the base [&_svg] rules, so raw glyph sizing/colour there
// is legitimate, not the footgun.
const isPrimitive = (f) => f.startsWith('src/components/ui/');

/** Feature surfaces only — see scripts/lib/is-feature-file.mjs. */
function listFiles() {
  return featureFilesOnly(
    execSync("git ls-files 'src/*.tsx' 'src/**/*.tsx'", { cwd: ROOT, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
  );
}

/** Icon components this file imports from lucide-react (plus raw <svg>). */
function lucideNames(code) {
  const names = new Set(['svg']);
  const re = /import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g;
  let m;
  while ((m = re.exec(code))) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Walk JSX opening/closing tags. Returns a flat token list:
 *   { kind: 'open'|'close'|'selfclose', name, raw, index }
 * The scanner tracks quotes and brace depth so `className={cn(a, b)}` and
 * `onClick={() => x > y}` never terminate a tag early.
 */
function scanTags(code) {
  const tags = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '<') continue;
    const after = code[i + 1];
    if (!after) break;
    const closing = after === '/';
    let j = i + (closing ? 2 : 1);
    if (!/[A-Za-z_]/.test(code[j] || '')) continue;
    let name = '';
    while (j < code.length && /[A-Za-z0-9_.$]/.test(code[j])) name += code[j++];
    // Scan to the tag's own '>' honouring strings, template literals, braces.
    let depth = 0, quote = null, k = j;
    for (; k < code.length; k++) {
      const c = code[k];
      if (quote) {
        if (c === '\\') { k++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { depth--; continue; }
      if (c === '>' && depth === 0) break;
    }
    if (k >= code.length) break;
    const raw = code.slice(i, k + 1);
    const selfclose = /\/\s*>$/.test(raw);
    tags.push({ kind: closing ? 'close' : selfclose ? 'selfclose' : 'open', name, raw, index: i });
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
    // Braced expression: take every string literal inside the whole tag.
    body = (raw.slice(attr.index).match(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g) || []).join(' ')
      .replace(/["'`]/g, ' ');
  } else {
    body = attr[1].slice(1, -1);
  }
  return body.split(/\s+/).filter(Boolean);
}

// text-* utilities that are NOT colours.
const TEXT_NON_COLOUR = new Set([
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl',
  'left', 'center', 'right', 'justify', 'start', 'end',
  'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip',
]);

/** Bare = no variant prefix (`hover:`), no `!` important escape hatch. */
const isBare = (t) => !t.includes(':') && !t.startsWith('!') && !t.endsWith('!');

// The base is [&_svg]:size-4, so `size-4` / `h-4 w-4` on the glyph is a no-op
// that renders correctly — noise, not the bug. Only a size that DIVERGES from
// the base actually renders wrong, and that is what this gate is for.
const isSizeClass = (t) => {
  if (!isBare(t) || !/^(?:size|h|w)-/.test(t)) return false;
  const v = t.replace(/^(?:size|h|w)-/, '');
  if (v === '4') return false;
  return /^(?:\d|\[)/.test(v) || v === 'px' || v === 'full' || v === 'auto';
};
const isColourClass = (t) => {
  if (!isBare(t) || !t.startsWith('text-')) return false;
  const rest = t.slice(5);
  return !TEXT_NON_COLOUR.has(rest) && !/^\[\s*length/.test(rest);
};

/** Does this tag open a button whose base carries the [&_svg] rules? */
const isButtonTag = (t) =>
  /^(?:Button|IconButton)$/.test(t.name) || /\bbuttonVariants\s*\(/.test(t.raw);

function scanFile(code) {
  const icons = lucideNames(code);
  const tags = scanTags(code);
  const hits = { g1: 0, g2: 0, g3: 0 };
  const detail = [];

  // Stack of currently-open elements; entries flagged when they are buttons.
  const stack = [];
  for (const tag of tags) {
    const line = code.slice(0, tag.index).split('\n').length;

    if (tag.kind === 'close') {
      // Pop to the matching open tag.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === tag.name) { stack.length = i; break; }
      }
      continue;
    }

    const inButton = [...stack].reverse().find((s) => s.button);

    if (inButton && icons.has(tag.name)) {
      const toks = classTokens(tag.raw);
      const bad1 = toks.filter(isSizeClass);
      const bad2 = toks.filter(isColourClass);
      if (bad1.length) { hits.g1++; detail.push({ rule: 'G1', line, tag: tag.name, cls: bad1.join(' ') }); }
      if (bad2.length) { hits.g2++; detail.push({ rule: 'G2', line, tag: tag.name, cls: bad2.join(' ') }); }
      inButton.holdsGlyph = true;
    }

    if (tag.kind !== 'selfclose') {
      const entry = { name: tag.name, button: isButtonTag(tag), raw: tag.raw, line, holdsGlyph: false };
      stack.push(entry);
    } else if (isButtonTag(tag)) {
      // A self-closing button can't hold a glyph child; nothing to check.
    }
  }

  // RULE G3 — the inherit route. Re-walk buttons that held a glyph and stated a
  // plain colour on themselves with no [&_svg]:text-* group.
  for (const tag of tags) {
    if (tag.kind !== 'open' || !isButtonTag(tag)) continue;
    // Only `ghost`/`outline` (and a computed variant, which may be either) leave
    // the base [&_svg]:text-current in charge. default/destructive/secondary/link
    // each pin their own [&_svg]:text-*, which wins over inheritance outright —
    // an inert class, not the "expected muted, got foreground" trap.
    const vm = tag.raw.match(/\bvariant\s*=\s*(?:"([^"]*)"|'([^']*)'|\{)/);
    const variant = vm ? (vm[1] ?? vm[2] ?? '?') : 'default';
    if (!(variant === 'ghost' || variant === 'outline' || variant === '?')) continue;
    const toks = classTokens(tag.raw);
    const hasGroupTint = toks.some((t) => /^\[&_svg\]:text-/.test(t));
    const plainTint = toks.filter(isColourClass);
    if (hasGroupTint || !plainTint.length) continue;
    // Only counts if this button actually contains a glyph.
    const close = tags.find((t) => t.kind === 'close' && t.name === tag.name && t.index > tag.index);
    const region = tags.filter((t) => t.index > tag.index && (!close || t.index < close.index));
    if (!region.some((t) => icons.has(t.name))) continue;
    const line = code.slice(0, tag.index).split('\n').length;
    hits.g3++;
    detail.push({ rule: 'G3', line, tag: tag.name, cls: plainTint.join(' ') });
  }

  return { hits, detail };
}

const byFile = { g1: {}, g2: {}, g3: {} };
const details = {};
for (const f of listFiles()) {
  if (isPrimitive(f)) continue;
  const code = stripComments(readFileSync(resolve(ROOT, f), 'utf8'));
  if (!/<Button|buttonVariants\s*\(/.test(code)) continue;
  const { hits, detail } = scanFile(code);
  if (hits.g1) byFile.g1[f] = hits.g1;
  if (hits.g2) byFile.g2[f] = hits.g2;
  if (hits.g3) byFile.g3[f] = hits.g3;
  if (detail.length) details[f] = detail;
}

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const sum = (o) => Object.values(o).reduce((n, c) => n + c, 0);

if (process.argv.includes('--write-baseline')) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ g1: sortObj(byFile.g1), g2: sortObj(byFile.g2), g3: sortObj(byFile.g3) }, null, 2) + '\n',
  );
  console.log(
    `✍️  wrote glyph baseline: ${sum(byFile.g1)} mis-scoped glyph SIZE (G1), ` +
    `${sum(byFile.g2)} mis-scoped glyph COLOUR (G2), ${sum(byFile.g3)} inherit-route tints (G3) — DEBT, shrink don't grow.`,
  );
  process.exit(0);
}

if (process.argv.includes('--list')) {
  for (const [f, d] of Object.entries(details)) {
    for (const x of d) console.log(`${f}:${x.line}  ${x.rule}  <${x.tag} ${x.cls}>`);
  }
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { g1: {}, g2: {}, g3: {} };

const ratchet = (map, base) =>
  Object.entries(map)
    .map(([f, count]) => ({ file: f, count, allowed: base?.[f] ?? 0 }))
    .filter((v) => v.count > v.allowed);

const v1 = ratchet(byFile.g1, baseline.g1);
const v2 = ratchet(byFile.g2, baseline.g2);
const v3 = ratchet(byFile.g3, baseline.g3);

const report = (viols, letter, name, fix) => {
  if (!viols.length) return;
  console.error(`\n${letter} — ${name}. ${viols.length} file(s) grew past scripts/glyph-baseline.json:`);
  for (const v of viols.slice(0, 50)) {
    console.error(`   ${v.file}  ${v.count} > ${v.allowed} allowed`);
    for (const d of (details[v.file] || []).filter((d) => d.rule === letter.split(' ')[1])) {
      console.error(`      L${d.line}  <${d.tag} className="… ${d.cls} …">`);
    }
  }
  if (viols.length > 50) console.error(`   …and ${viols.length - 50} more`);
  console.error(`   FIX: ${fix}`);
};

const FIX_SIZE =
  'move the size into the BUTTON\'s own descendant group — className="… [&_svg]:size-6" — not onto the svg. ' +
  'Button\'s base [&_svg]:size-4 is a descendant rule and outranks a utility on the glyph, so the class you wrote is silently dropped. ' +
  'If ONE button holds glyphs at two sizes, the odd one re-asserts with ! (e.g. !size-3).';
const FIX_COLOUR =
  'move the tint into the BUTTON\'s own descendant group — className="… [&_svg]:text-muted-foreground" — not onto the svg. ' +
  'Button\'s base [&_svg]:text-current outranks a colour utility on the glyph. ' +
  'A differently-tinted sibling glyph re-asserts with ! (the group paints every glyph in that button).';
const FIX_INHERIT =
  'state the tint as [&_svg]:text-* ON THE BUTTON, not as a plain text-* the glyph is meant to inherit. ' +
  'Inheritance makes the result depend on whatever the button\'s own colour actually resolves to — measured live, the checklist chevrons ' +
  'came out foreground rgb(1,5,14) instead of muted rgb(117,108,97) (DECISIONS 2026-07-27). ' +
  'Override a descendant-rule utility with a descendant-rule utility, never with an inherited value.';

report(v1, '❌ G1', 'new glyph SIZE class inside a Button', FIX_SIZE);
report(v2, '❌ G2', 'new glyph COLOUR class inside a Button', FIX_COLOUR);
report(v3, '❌ G3', 'new inherit-route tint on a Button holding a glyph', FIX_INHERIT);

if (v1.length + v2.length + v3.length > 0) {
  if (BLOCKING) {
    console.error('\nGlyph-cascade gate FAILED. See the amended [&_svg] contract in docs/audits/component-primitive-adoption.md.\n');
    process.exit(1);
  }
  console.error('\n⚠️  Glyph-cascade gate (WARN mode): the above are NEW mis-scoped glyph classes above baseline.\n');
  process.exit(0);
}

console.log(
  `✅ glyph-cascade gate passed: 0 new mis-scoped glyph sizes (G1 debt: ${sum(byFile.g1)}), ` +
  `0 new mis-scoped glyph colours (G2 debt: ${sum(byFile.g2)}), ` +
  `0 new inherit-route tints (G3 debt: ${sum(byFile.g3)}) — all tracked, shrinking.`,
);
