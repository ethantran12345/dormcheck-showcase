#!/usr/bin/env node
/**
 * Component-primitive adoption gate (Component Primitive Adoption ADR 2026-07-22).
 * Sibling of scripts/check-colors.mjs; wired as its own step in ci-dev-push.yml.
 *
 * The whole-app audit (docs/audits/component-primitive-adoption.md) found the app
 * is ~74% adopted on the src/components/ui/ shadcn layer. The reinvention that
 * remains is concentrated in three recurring patterns. This gate stops those
 * patterns from RE-ACCRUING once each tranche closes them.
 *
 * Governing rule (from the ADR): STANDARD controls (button/input/modal/dropdown/
 * tabs/card/table) ALWAYS compose src/components/ui/. PRODUCT surfaces stay custom
 * but are built ON TOP of those primitives. So this gate scans FEATURE CODE ONLY
 * and allowlists src/components/ui/ (the primitives are where the raw elements
 * legitimately live).
 *
 * It counts, per file (comments stripped first so prose never trips it):
 *
 *   RULE A — raw <button>. Use <Button> from @/components/ui/button (focus ring,
 *            disabled handling, opt-in haptics, variant consistency).
 *   RULE B — hand-rolled overlays: a `fixed inset-0` scrim or a raw role="dialog"
 *            shell. Use Dialog / Sheet / Drawer / TallSheet (backdrop + scroll-lock
 *            + Escape + focus-trap come for free). NOTE: `fixed inset-0` has
 *            legitimate non-overlay uses (full-screen map layers, loaders), so
 *            this is deliberately a RATCHET, not a classifier — today's count is
 *            grandfathered and only GROWTH warns.
 *   RULE C — raw <table>. Use @/components/ui/table.
 *
 * SAME SHAPE AS check-colors.mjs RULES 3-5: a per-file count is grandfathered in
 * scripts/primitive-baseline.json and the gate reports only when a file's count
 * GROWS. A migration only ever LOWERS a count, so a legit tranche never trips it;
 * it catches a newly added raw button/overlay/table. The baseline is DEBT, not a
 * blessing — shrink it as tranches land, then re-run --write-baseline.
 *
 * BLOCKING MODE (since Tranche 3, 2026-07-22): BLOCKING is true, so GROWTH over the
 * baseline fails CI. Deliberate exceptions (bespoke product surfaces / parallel
 * mini-kits) live in the ALLOWLIST and are skipped entirely. A migration only ever
 * LOWERS a count, so a legit tranche never trips it; a newly added raw
 * button/overlay/table does.
 *
 * Regenerate the baseline after a legitimate change:  node scripts/check-primitives.mjs --write-baseline
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
const BASELINE_PATH = resolve(ROOT, 'scripts/primitive-baseline.json');

// BLOCKING as of Tranche 3 (2026-07-22): feature code is drawn down and the
// remaining raw patterns are either grandfathered debt (only GROWTH fails) or
// deliberate exceptions in the ALLOWLIST below. Growth now fails CI.
const BLOCKING = true;

// Feature code only. The primitives in src/components/ui/ are exactly where raw
// <button>/<table>/overlays legitimately live, so they are allowlisted.
const isPrimitive = (f) => f.startsWith('src/components/ui/');

// DELIBERATE EXCEPTIONS (Tranche 3). These files legitimately contain a raw
// button/overlay/table that is NOT reinvention-to-fix — a bespoke product surface
// or a parallel mini design-system that was explicitly kept custom (see the
// Component Primitive Adoption ADR + docs/audits/component-primitive-adoption.md).
// They are skipped entirely so the blocking gate never flags them and no future
// pass mistakes them for debt to migrate. Keep the reason current when editing.
const ALLOWLIST = {
  // The floating liquid-glass BottomNav and its pull-session peek-sheet are a
  // bespoke navigation surface (continuous height state machine coupled to the
  // pill/lens drag), not a standard dismiss-only modal. Migrating to vaul Drawer
  // is a high-regression rewrite of primary nav — a product surface, kept custom.
  'src/components/BottomNav.tsx': 'bespoke glass-nav peek-sheet (product surface, not a standard modal)',
  // Native <select> ref-autofocus/Escape inline editor: Radix Select forbids
  // empty-value items and breaks the shared inline-edit ref contract (DECISIONS
  // 2026-07-22). Kept native on purpose.
  'src/pages/admin/DormEditPage.tsx': 'native <select> inline editor kept on purpose (Radix Select breaks the inline-edit contract)',
  // Custom mobile account Drawer with its own full-viewport scrim; deliberately
  // hand-tuned, not a stock overlay.
  'src/components/settings/MobileAccountSheet.tsx': 'bespoke mobile account drawer/scrim, kept custom',
  // Parallel marketing mini design-system (SiteCard/PageHead/Eyebrow + its own
  // button) — explicitly out of scope to consolidate (ADR non-goal).
  'src/components/marketing/landing/ui.tsx': 'parallel marketing mini-kit, consolidation explicitly out of scope',
  // Parallel my-home card mini-kit — separate flagged decision, not folded into Card.
  'src/components/my-home/WidgetCard.tsx': 'parallel my-home card mini-kit (separate flagged decision)',
  'src/components/my-home/cardSystem.tsx': 'parallel my-home card mini-kit (separate flagged decision)',
  // T3.5: evaluated for DropdownMenu/Popover and deliberately KEPT CUSTOM. This
  // is the same bespoke glass nav chrome as BottomNav (already allowlisted
  // above) — its tap-away scrim is non-portaled ON PURPOSE so the bottom-nav's
  // stacking context carries it above page content while the tiles stay
  // clickable, and Radix Popper would replace both that and the framer-motion
  // spring that gives primary nav its identity. Product surface, not a standard
  // dropdown. Its own follow-up (focus move/restore) is tracked in the audit.
  'src/components/nav/NavSectionSwitcher.tsx': 'bespoke glass-nav section popup, sibling of BottomNav (product surface, not a standard dropdown)',
};
const isAllowlisted = (f) => f in ALLOWLIST;

const RAW_BUTTON = /<button[\s>]/g;
const RAW_TABLE = /<table[\s>]/g;
// Overlay heuristic: a full-viewport scrim (`fixed inset-0`) or a raw dialog shell.
const OVERLAY = /fixed\s+inset-0|role=["']dialog["']/g;

/** Feature surfaces only — see scripts/lib/is-feature-file.mjs. */
function listFiles() {
  return featureFilesOnly(
    execSync(
      "git ls-files 'src/*.tsx' 'src/**/*.tsx'",
      { cwd: ROOT, encoding: 'utf8' }
    ).trim().split('\n').filter(Boolean)
  );
}

const countOf = (code, re) => (code.match(re) || []).length;

function scan() {
  const buttonByFile = {};
  const overlayByFile = {};
  const tableByFile = {};
  for (const f of listFiles()) {
    if (isPrimitive(f) || isAllowlisted(f)) continue;
    const code = stripComments(readFileSync(resolve(ROOT, f), 'utf8'));
    const b = countOf(code, RAW_BUTTON);
    const o = countOf(code, OVERLAY);
    const t = countOf(code, RAW_TABLE);
    if (b) buttonByFile[f] = b;
    if (o) overlayByFile[f] = o;
    if (t) tableByFile[f] = t;
  }
  return { buttonByFile, overlayByFile, tableByFile };
}

const { buttonByFile, overlayByFile, tableByFile } = scan();
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

if (process.argv.includes('--write-baseline')) {
  const out = {
    button: sortObj(buttonByFile),
    overlay: sortObj(overlayByFile),
    table: sortObj(tableByFile),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(out, null, 2) + '\n');
  const sum = (o) => Object.values(o).reduce((n, c) => n + c, 0);
  console.log(
    `✍️  wrote primitive baseline: ${sum(buttonByFile)} raw <button> (RULE A), ` +
    `${sum(overlayByFile)} hand-rolled overlays (RULE B), ${sum(tableByFile)} raw <table> (RULE C) — DEBT, shrink don't grow.`,
  );
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { button: {}, overlay: {}, table: {} };

const ratchet = (byFile, base) => {
  const out = [];
  for (const [f, count] of Object.entries(byFile)) {
    const allowed = base?.[f] ?? 0;
    if (count > allowed) out.push({ file: f, count, allowed });
  }
  return out;
};

const buttonV = ratchet(buttonByFile, baseline.button);
const overlayV = ratchet(overlayByFile, baseline.overlay);
const tableV = ratchet(tableByFile, baseline.table);

const report = (viols, letter, name, fix) => {
  if (!viols.length) return;
  console.error(`\n${letter} — ${name}. ${viols.length} file(s) grew past scripts/primitive-baseline.json:`);
  for (const v of viols.slice(0, 50)) console.error(`   ${v.file}  ${v.count} > ${v.allowed} allowed   (${fix})`);
  if (viols.length > 50) console.error(`   …and ${viols.length - 50} more`);
};

report(buttonV, '❌ RULE A', 'new raw <button>', 'use <Button> from @/components/ui/button');
report(overlayV, '❌ RULE B', 'new hand-rolled overlay (fixed inset-0 / role="dialog")', 'use Dialog / Sheet / Drawer / TallSheet');
report(tableV, '❌ RULE C', 'new raw <table>', 'use @/components/ui/table');

const grew = buttonV.length + overlayV.length + tableV.length > 0;
const sum = (o) => Object.values(o).reduce((n, c) => n + c, 0);

if (grew) {
  if (BLOCKING) {
    console.error('\nComponent-primitive gate FAILED. See docs/audits/component-primitive-adoption.md.\n');
    process.exit(1);
  }
  console.error(
    '\n⚠️  Component-primitive gate (WARN mode): the above are NEW reinventions above baseline. ' +
    'Compose src/components/ui/ instead. Not blocking yet — flips to blocking once Tranche 3 lands.\n',
  );
  process.exit(0);
}

console.log(
  `✅ component-primitive gate passed: 0 new raw <button> (RULE A debt: ${sum(buttonByFile)}), ` +
  `0 new hand-rolled overlays (RULE B debt: ${sum(overlayByFile)}), 0 new raw <table> (RULE C debt: ${sum(tableByFile)}) — all tracked, shrinking.`,
);
