#!/usr/bin/env node
/**
 * Aggregate the per-page JSON records written by the Playwright crawl into a single
 * human-readable markdown report: docs/audits/app-bug-audit-report/index.md.
 *
 * Run automatically by `npm run audit:app` after the crawl. Safe to run standalone.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// AUDIT_REPORT_DIR exists so the regression suite can point this script at a
// fixture directory. It relocates the RECORDS, never the SHA check below — a
// fixture is still refused unless it is stamped with the real current HEAD.
const REPORT_DIR = process.env.AUDIT_REPORT_DIR
  ? path.resolve(process.env.AUDIT_REPORT_DIR)
  : path.join(root, 'docs/audits/app-bug-audit-report');
const RECORDS_DIR = path.join(REPORT_DIR, 'records');

/**
 * Staleness gate (queue item 8c).
 *
 * A report is only allowed to exist if THIS commit's crawl produced it. The
 * failure this closes: `npm run audit:app` with :8123 occupied used to error,
 * continue, and rebuild the report from the PREVIOUS run's records — handing back
 * pre-fix numbers as post-fix during 8b, caught only by operator suspicion. The
 * bias was toward "we're done", which is the dangerous direction, so the gate
 * fails closed: anything it cannot positively verify is a refusal, and a refusal
 * writes nothing at all rather than leaving a half-truth on disk.
 *
 * Four conditions, all necessary:
 *   1. there are records at all (a crawl that never ran leaves none — run-audit.sh
 *      purges the directory before starting);
 *   2. every record carries a runSha (an unstamped record is from before this
 *      gate existed, i.e. of unknown provenance);
 *   3. all records share ONE runSha (a mixed set means leftovers survived);
 *   4. that runSha is the current HEAD (a matching-but-old set is still stale).
 */
function refuse(reason) {
  console.error(`✗ REFUSING to build the audit report: ${reason}`);
  console.error('  No report was written. The last run\'s numbers are NOT reprinted as current.');
  console.error('  Re-run the crawl on this commit: npm run audit:app');
  process.exit(1);
}

const headSha = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
})();
if (!headSha) refuse('could not resolve HEAD, so record provenance cannot be verified');

if (!fs.existsSync(RECORDS_DIR)) {
  refuse(`no records at ${RECORDS_DIR} — the crawl did not execute`);
}

const recordFiles = fs.readdirSync(RECORDS_DIR).filter((f) => f.endsWith('.json'));
if (recordFiles.length === 0) {
  refuse(`no records in ${RECORDS_DIR} — the crawl did not execute`);
}

const records = recordFiles.map((f) => JSON.parse(fs.readFileSync(path.join(RECORDS_DIR, f), 'utf8')));

const unstamped = recordFiles.filter((f, i) => !records[i].runSha);
if (unstamped.length > 0) {
  refuse(`${unstamped.length} record(s) carry no runSha (e.g. ${unstamped[0]}) — provenance unknown`);
}
const shas = [...new Set(records.map((r) => r.runSha))];
if (shas.length > 1) {
  refuse(`records span ${shas.length} different commits (${shas.join(', ')}) — leftovers from an earlier run`);
}
if (shas[0] !== headSha) {
  refuse(`records were produced at ${shas[0]} but HEAD is ${headSha} — these numbers describe a different commit`);
}
const startedAt = records[0].runStartedAt ?? 'unknown';

const sevRank = { P0: 0, P1: 1, P2: 2 };
// Layout-mode kinds (e2e/lib/layout.ts) get their own grouped section below;
// one row per instance across 15 passes would bury everything else.
const LAYOUT_KINDS = ['overflow-x', 'clipped', 'sheet-overflow', 'nav-occlusion', 'truncation'];
const allFindings = records.flatMap((r) =>
  r.findings.map((fd) => ({ ...fd, persona: r.persona, label: r.label, path: r.path, variant: r.variant })),
);
allFindings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);

const counts = allFindings.reduce((acc, f) => ((acc[f.severity] = (acc[f.severity] ?? 0) + 1), acc), {});
const personas = [...new Set(records.map((r) => r.persona))];

// ---- Accessibility (axe) aggregation ------------------------------------------------
// One row per axe rule, not per node per route - a TopNav violation would otherwise
// repeat across every page visit and drown the report.
const a11yByRule = new Map();
let a11yScannedPages = 0;
for (const r of records) {
  if (!r.axe) continue;
  a11yScannedPages++;
  for (const v of r.axe) {
    const agg = a11yByRule.get(v.ruleId) ?? {
      ruleId: v.ruleId,
      impact: v.impact,
      help: v.help,
      helpUrl: v.helpUrl,
      wcagTags: v.wcagTags,
      routes: new Set(),
      nodes: 0,
      exampleRoute: `${r.persona} ${r.path}`,
      sampleTargets: v.sampleTargets,
      // The offending element's own markup. `runAxeScan` has always captured this
      // and the report has always dropped it, which left a contrast violation
      // identified only by a CSS path like `.line-clamp-1` — a selector that
      // matches several components and names none of them. Chasing one serious
      // contrast node on /marketplace cost three 20-minute crawls on 2026-08-11
      // for want of the one string axe already had.
      sampleHtml: v.sampleHtml ?? [],
    };
    agg.routes.add(`${r.persona}:${r.path}`);
    agg.nodes += v.nodeCount;
    a11yByRule.set(v.ruleId, agg);
  }
}
const impactRank = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const a11yRules = [...a11yByRule.values()].sort(
  (a, b) => (impactRank[a.impact] ?? 9) - (impactRank[b.impact] ?? 9) || b.routes.size - a.routes.size,
);
const a11yImpactCounts = a11yRules.reduce(
  (acc, v) => ((acc[v.impact] = (acc[v.impact] ?? 0) + v.nodes), acc),
  {},
);

const esc = (s) => String(s).replace(/\|/g, '\\|');

let md = `# App Bug Audit - crawl report\n\n`;
md += `_Generated by \`npm run audit:app\` from ${records.length} page visits across personas: ${personas.join(', ')}._\n\n`;
md += `**Commit:** \`${headSha}\` · **Run started:** ${startedAt}\n\n`;
md += `_Every record is stamped with the commit it was crawled at, and this report refuses to build unless all of them match HEAD — so these numbers can never be a previous run's reprinted as current._\n\n`;
md += `## Summary\n\n`;
md += `| Severity | Count |\n|---|---|\n`;
md += `| P0 (crash/blocker) | ${counts.P0 ?? 0} |\n`;
md += `| P1 (broken flow) | ${counts.P1 ?? 0} |\n`;
md += `| P2 (cosmetic) | ${counts.P2 ?? 0} |\n\n`;

if (allFindings.length === 0) {
  md += `✅ **No findings.** Every crawled page rendered with no uncaught exceptions, console errors, failed requests, blank roots, or wrong-persona outcomes.\n\n`;
} else {
  md += `## Findings\n\n`;
  md += `| Sev | Kind | Persona | Pass | Page | Detail |\n|---|---|---|---|---|---|\n`;
  for (const f of allFindings.filter((x) => !LAYOUT_KINDS.includes(x.kind))) {
    md += `| ${f.severity} | ${f.kind} | ${f.persona} | ${f.variant ?? '1280'} | ${esc(f.label)} (\`${esc(f.path)}\`) | ${esc(f.detail).slice(0, 240)} |\n`;
  }
  md += `\n`;
}

// ---- Layout (cut-off detectors) ------------------------------------------------------
const layoutRecords = records.filter((r) => r.layoutScan !== undefined);
if (layoutRecords.length > 0) {
  const lf = allFindings.filter((f) => LAYOUT_KINDS.includes(f.kind));
  const variants = [...new Set(layoutRecords.map((r) => r.variant))].sort();
  const scanned = layoutRecords.filter((r) => r.layoutScan === 'ok').length;
  const failed = layoutRecords.filter((r) => String(r.layoutScan).startsWith('failed'));
  const byKind = Object.fromEntries(LAYOUT_KINDS.map((k) => [k, lf.filter((f) => f.kind === k).length]));
  const kindVariant = {};
  const kindPage = {};
  for (const f of lf) {
    kindVariant[f.kind] ??= {};
    kindVariant[f.kind][f.variant] = (kindVariant[f.kind][f.variant] ?? 0) + 1;
    const page = `${f.path}`;
    kindPage[page] ??= { label: f.label, kinds: {}, passes: new Set() };
    kindPage[page].kinds[f.kind] = (kindPage[page].kinds[f.kind] ?? 0) + 1;
    kindPage[page].passes.add(`${f.persona}@${f.variant}`);
  }
  md += `## Layout (cut-off detectors)\n\n`;
  md += `_${layoutRecords.length} page visits across ${variants.length} passes; layout scan ran on ${scanned}, skipped on ${layoutRecords.length - scanned - failed.length} (redirected to /auth or blank), **failed on ${failed.length}**._\n\n`;
  if (failed.length) {
    md += `> ⚠ A failed scan measured nothing: those pages are NOT clean. First: \`${esc(failed[0].persona)} ${esc(failed[0].path)} @${failed[0].variant}\` ${esc(failed[0].layoutScan).slice(0, 160)}\n\n`;
  }
  md += `| Kind | Sev | Total | ${variants.join(' | ')} |\n|---|---|---|${variants.map(() => '---').join('|')}|\n`;
  for (const k of LAYOUT_KINDS) {
    const sev = k === 'truncation' ? 'P2' : 'P1';
    md += `| ${k} | ${sev} | ${byKind[k]} | ${variants.map((v) => kindVariant[k]?.[v] ?? 0).join(' | ')} |\n`;
  }
  md += `\n### By page\n\n| Page | Path | ${LAYOUT_KINDS.join(' | ')} | Passes affected |\n|---|---|${LAYOUT_KINDS.map(() => '---').join('|')}|---|\n`;
  const pages = Object.entries(kindPage).sort(
    (a, b) => Object.values(b[1].kinds).reduce((x, y) => x + y, 0) - Object.values(a[1].kinds).reduce((x, y) => x + y, 0),
  );
  for (const [p, v] of pages) {
    md += `| ${esc(v.label)} | \`${esc(p)}\` | ${LAYOUT_KINDS.map((k) => v.kinds[k] ?? 0).join(' | ')} | ${v.passes.size} |\n`;
  }
  md += `\n### Instances (P1 first)\n\n| Sev | Kind | Pass | Persona | Page | Detail |\n|---|---|---|---|---|---|\n`;
  for (const f of lf) {
    md += `| ${f.severity} | ${f.kind} | ${f.variant} | ${f.persona} | \`${esc(f.path)}\` | ${esc(f.detail).slice(0, 300)} |\n`;
  }
  md += `\n`;
  fs.writeFileSync(
    path.join(REPORT_DIR, 'layout-summary.json'),
    JSON.stringify(
      {
        runSha: headSha,
        visits: layoutRecords.length,
        scanned,
        failed: failed.map((r) => `${r.persona} ${r.path} @${r.variant}: ${r.layoutScan}`),
        byKind,
        byKindVariant: kindVariant,
        byPage: Object.fromEntries(pages.map(([p, v]) => [p, { ...v.kinds, passes: [...v.passes].sort() }])),
      },
      null,
      2,
    ),
  );
}

if (a11yScannedPages > 0) {
  md += `## Accessibility (axe, WCAG 2.1 AA)\n\n`;
  md += `_${a11yScannedPages} pages scanned. Node counts by impact - `;
  md += `critical: ${a11yImpactCounts.critical ?? 0}, serious: ${a11yImpactCounts.serious ?? 0}, `;
  md += `moderate: ${a11yImpactCounts.moderate ?? 0}, minor: ${a11yImpactCounts.minor ?? 0}._\n\n`;
  if (a11yRules.length === 0) {
    md += `✅ **No WCAG 2.1 AA violations detected by axe.** (Manual checks still required - see docs/audits/accessibility.md.)\n\n`;
  } else {
    md += `| Rule | Impact | WCAG | Pages | Nodes | Example | Element | Docs |\n|---|---|---|---|---|---|---|---|\n`;
    for (const v of a11yRules) {
      const el = (v.sampleHtml?.[0] ?? '').replace(/\s+/g, ' ').slice(0, 200);
      md += `| ${esc(v.ruleId)} | ${v.impact} | ${esc(v.wcagTags.join(' '))} | ${v.routes.size} | ${v.nodes} | \`${esc(v.exampleRoute)}\` ${esc(v.sampleTargets[0] ?? '')} | ${el ? `\`${esc(el)}\`` : '—'} | [help](${v.helpUrl}) |\n`;
    }
    md += `\n`;
  }
}

// ---- Layout shift (CLS) ------------------------------------------------------------
// A measured number per route, worst first, so "the grid doesn't jump" is a value
// someone can diff between runs rather than an impression. Google's bars: <=0.1 good,
// <=0.25 needs improvement.
const clsRows = records
  .filter((r) => r.cls)
  .sort((a, b) => b.cls.value - a.cls.value);
if (clsRows.length > 0) {
  const over = clsRows.filter((r) => r.cls.value > 0.1);
  md += `## Layout shift (CLS)\n\n`;
  md += `_${clsRows.length} pages measured; ${over.length} above the 0.1 "good" bar._\n\n`;
  // "Worst movers" is plural on purpose: one layout-shift entry attributes its
  // score to every node that moved in that frame, so a single 0.1699 can name
  // three elements. The column prints the ENTRY total (shared, and labelled as
  // such) next to each node's own dx/dy — the offsets are what make a score
  // actionable, and pairing one node's rect with a multi-source total is the
  // mis-attribution 8c removed.
  const fmtSource = (s) => {
    const moved = s.dy != null || s.dx != null ? ` ${s.dx ?? 0},${s.dy ?? 0}px` : '';
    const shared = s.sourceCount > 1 ? ` shared/${s.sourceCount}` : '';
    return `\`${esc(s.node)}\`${moved} (entry ${Number(s.entryValue).toFixed(4)}${shared})`;
  };
  md += `| CLS | Persona | Page | Path | Shifts | Worst movers (entry score, per-node offset) |\n|---|---|---|---|---|---|\n`;
  for (const r of clsRows) {
    const flag = r.cls.value > 0.25 ? '🔴' : r.cls.value > 0.1 ? '🟡' : '✅';
    const worst = (r.cls.worst ?? []).slice(0, 3);
    md += `| ${flag} ${r.cls.value} | ${r.persona} | ${esc(r.label)} | \`${esc(r.path)}\` | ${r.cls.shiftCount} | ${worst.length ? worst.map(fmtSource).join('<br>') : '—'} |\n`;
  }
  md += `\n`;
}

md += `## Per-page results\n\n`;
md += `| Persona | Pass | Page | Path | Expected | Outcome | CLS | Findings | Screenshot |\n|---|---|---|---|---|---|---|---|---|\n`;
for (const r of records.sort((a, b) => a.persona.localeCompare(b.persona) || a.label.localeCompare(b.label) || String(a.variant).localeCompare(String(b.variant)))) {
  const status = r.findings.length === 0 ? '✅' : `⚠️ ${r.findings.length}`;
  const cls = r.cls ? String(r.cls.value) : '—';
  md += `| ${r.persona} | ${r.variant ?? '1280'} | ${esc(r.label)} | \`${esc(r.path)}\` | ${r.expected} | ${r.outcome} | ${cls} | ${status} | [img](${r.screenshot}) |\n`;
}
md += `\n_Screenshots and raw per-page JSON live alongside this file (gitignored)._\n`;

fs.writeFileSync(path.join(REPORT_DIR, 'index.md'), md);

// Machine-readable rollup for before/after diffs across remediation batches.
if (a11yScannedPages > 0) {
  const summary = Object.fromEntries(
    a11yRules.map((v) => [
      v.ruleId,
      { impact: v.impact, wcag: v.wcagTags, pages: v.routes.size, nodes: v.nodes, routes: [...v.routes].sort() },
    ]),
  );
  fs.writeFileSync(
    path.join(REPORT_DIR, 'a11y-summary.json'),
    JSON.stringify({ scannedPages: a11yScannedPages, impactNodeCounts: a11yImpactCounts, rules: summary }, null, 2),
  );
  console.log(`A11y summary written: docs/audits/app-bug-audit-report/a11y-summary.json`);
}

console.log(`Report written: docs/audits/app-bug-audit-report/index.md`);
console.log(`Findings - P0: ${counts.P0 ?? 0}  P1: ${counts.P1 ?? 0}  P2: ${counts.P2 ?? 0}`);
if (a11yScannedPages > 0) {
  console.log(
    `A11y nodes - critical: ${a11yImpactCounts.critical ?? 0}  serious: ${a11yImpactCounts.serious ?? 0}  moderate: ${a11yImpactCounts.moderate ?? 0}  minor: ${a11yImpactCounts.minor ?? 0}`,
  );
}
