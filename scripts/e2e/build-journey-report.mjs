#!/usr/bin/env node
/**
 * Aggregate the no-dead-end journey records (e2e/lib/journey.ts) and the
 * Playwright JSON results of the existing flow specs into
 * docs/audits/app-bug-audit-report/journeys.md + journeys-summary.json.
 *
 * Same provenance rule as build-report.mjs: every record must be stamped with
 * HEAD, or nothing is written.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPORT_DIR = process.env.AUDIT_REPORT_DIR
  ? path.resolve(process.env.AUDIT_REPORT_DIR)
  : path.join(root, 'docs/audits/app-bug-audit-report');
const DIR = path.join(REPORT_DIR, 'journeys');

function refuse(reason) {
  console.error(`✗ REFUSING to build the journey report: ${reason}`);
  process.exit(1);
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (!fs.existsSync(DIR)) refuse(`no ${DIR}`);
const files = fs.readdirSync(DIR).filter((f) => f.includes('@') && f.endsWith('.json'));
if (!files.length) refuse('no journey records');
const recs = files.map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
const shas = [...new Set(recs.map((r) => r.runSha))];
if (shas.length !== 1 || shas[0] !== head) refuse(`records stamped ${shas.join(', ')} but HEAD is ${head}`);

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const POINTS = ['entry', 'progress', 'result', 'readback', 'next', 'empty', 'errors', 'cancel', 'a11y', 'responsive', 'trust'];
const tally = (cs, st) => cs.filter((c) => c.status === st).length;

let md = `# No-dead-end journey sweep\n\n**Commit:** \`${head}\` · **Run started:** ${recs[0].runStartedAt}\n\n`;
md += `_Contract: docs/audits/feature-journey-inventory.md §4. Each check asserts a terminal state (a row, a URL, an open dialog, a value that survives reload), never a screenshot. \`blocked\` = a prerequisite check failed or the point needs a device._\n\n`;

const all = recs.flatMap((r) => r.checks.map((c) => ({ ...c, journey: r.id, label: r.label, project: r.project, priority: r.priority })));
md += `## Summary\n\n| | pass | fail | blocked |\n|---|---|---|---|\n| checks | ${tally(all, 'pass')} | ${tally(all, 'fail')} | ${tally(all, 'blocked')} |\n\n`;
md += `| Contract point | pass | fail | blocked |\n|---|---|---|---|\n`;
for (const p of POINTS) {
  const cs = all.filter((c) => c.point === p);
  if (cs.length) md += `| ${p} | ${tally(cs, 'pass')} | ${tally(cs, 'fail')} | ${tally(cs, 'blocked')} |\n`;
}
md += `\n## Journeys\n\n| Journey | Project | Pri | pass | fail | blocked |\n|---|---|---|---|---|---|\n`;
for (const r of recs.sort((a, b) => a.id.localeCompare(b.id) || a.project.localeCompare(b.project))) {
  md += `| ${esc(r.label)} | ${r.project} | ${r.priority} | ${tally(r.checks, 'pass')} | ${tally(r.checks, 'fail')} | ${tally(r.checks, 'blocked')} |\n`;
}
md += `\n## Failed and blocked checks\n\n| Journey | Project | Point | Check | Status | Detail |\n|---|---|---|---|---|---|\n`;
for (const c of all.filter((c) => c.status !== 'pass')) {
  md += `| ${esc(c.label)} | ${c.project} | ${c.point} | ${esc(c.name)} | ${c.status} | ${esc(c.detail).slice(0, 300)} |\n`;
}

// Existing flow specs, from the Playwright JSON reporter.
const pwPath = path.join(DIR, 'playwright.json');
const flows = [];
if (fs.existsSync(pwPath)) {
  const pw = JSON.parse(fs.readFileSync(pwPath, 'utf8'));
  const walk = (suite, file) => {
    for (const s of suite.suites ?? []) walk(s, s.file ?? file);
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        if (/journeys\.|auth\.setup/.test(file ?? spec.file ?? '')) continue;
        const last = t.results?.[t.results.length - 1];
        flows.push({ file: spec.file ?? file, title: spec.title, project: t.projectName, status: last?.status ?? 'unknown', error: (last?.error?.message ?? '').replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '').split('\n')[0] });
      }
    }
  };
  for (const s of pw.suites ?? []) walk(s, s.file);
  md += `\n## Existing flow specs (evidence)\n\n| Spec | Test | Project | Result | Error |\n|---|---|---|---|---|\n`;
  for (const f of flows) md += `| ${esc(f.file)} | ${esc(f.title)} | ${f.project} | ${f.status} | ${esc(f.error).slice(0, 200)} |\n`;
}

fs.writeFileSync(path.join(REPORT_DIR, 'journeys.md'), md);
fs.writeFileSync(
  path.join(REPORT_DIR, 'journeys-summary.json'),
  JSON.stringify({ runSha: head, checks: { pass: tally(all, 'pass'), fail: tally(all, 'fail'), blocked: tally(all, 'blocked') }, failed: all.filter((c) => c.status === 'fail'), flows }, null, 2),
);
console.log(`Journey report: pass ${tally(all, 'pass')}  fail ${tally(all, 'fail')}  blocked ${tally(all, 'blocked')}  · flow specs ${flows.filter((f) => f.status === 'passed').length}/${flows.length} passed`);
