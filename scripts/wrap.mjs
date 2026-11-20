#!/usr/bin/env node
/**
 * wrap - generate a session record from git FACTS, not prose. Session records used to
 * depend on an agent remembering to journal, and what it wrote was narrative that could
 * drift from what actually happened. This derives everything git can prove — commits by
 * area, files touched, lanes shipped/abandoned, tags cut, and anything still uncommitted
 * or unpushed — and writes it to the shared Git metadata directory. Session hooks must never
 * dirty the integration checkout: tracked project journals are deliberate, lane-owned commits.
 *
 *   npm run wrap                     # range = session-start stamp..HEAD (or today's commits)
 *   npm run wrap -- --since <ref>    # explicit baseline (a sha/tag/branch)
 *
 * Wired to the SessionEnd hook AFTER `npm run wip`, so the last edits are committed first
 * and this records them. Exit 0 always — a record, never a gate. Invents NOTHING: every
 * line is something `git` returned.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const g = (cmd, opts = {}) => {
  try { return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim(); }
  catch { return ''; }
};
const gLines = (cmd) => g(cmd).split('\n').filter(Boolean);

const REPO_ROOT = resolve(g('rev-parse --show-toplevel') || '.');
const commonDir = resolve(g('rev-parse --git-common-dir') || '.git');
const SESSION_STAMP = join(commonDir, 'dc-session-start'); // {sha} written by session-begin (SessionStart)
const WRAP_STAMP = join(commonDir, 'dc-last-wrap');        // epoch ms of the last wrap (state freshness)

// ── same area rule as wip.mjs / brief.mjs (keep the three in step) ─────────────
function areaOf(pathRaw) {
  let f = pathRaw.trim();
  if (f.includes(' -> ')) f = f.split(' -> ').pop();
  f = f.replace(/^"|"$/g, '');
  const seg = f.split('/');
  if (seg[0] === 'src') {
    if (seg[1] === 'components' && seg[2]) return seg[2];
    if (seg[1]) return seg[1];
    return 'src';
  }
  return seg[0] || 'root';
}

// ── resolve the baseline (what counts as "this session") ──────────────────────
const args = process.argv.slice(2);
const sinceIdx = args.findIndex((a) => a === '--since');
let base = sinceIdx !== -1 ? args[sinceIdx + 1] : '';
let baseSource = '';
if (base) {
  baseSource = `--since ${base}`;
} else if (existsSync(SESSION_STAMP)) {
  const sha = readFileSync(SESSION_STAMP, 'utf8').trim().split(/\s+/)[0];
  if (sha && g(`cat-file -e ${sha}^{commit} && echo ok`)) { base = sha; baseSource = 'session-start stamp'; }
}
// Fallback: commits since local midnight today (a session with no stamp still records).
const head = g('rev-parse HEAD');
let range, commits;
if (base && base !== head) {
  range = `${base}..HEAD`;
  commits = gLines(`log --no-merges --format=%H ${range}`);
  baseSource = baseSource || 'range';
} else if (base === head) {
  range = `${base}..HEAD`;
  commits = [];
  baseSource = baseSource || 'session-start stamp';
} else {
  // No baseline at all: today's non-merge commits.
  const today = new Date().toISOString().slice(0, 10);
  range = `since ${today} 00:00`;
  commits = gLines(`log --no-merges --format=%H --since="${today} 00:00"`);
  baseSource = 'today';
}

// ── gather the facts ──────────────────────────────────────────────────────────
const branch = g('rev-parse --abbrev-ref HEAD') || '(detached)';
const nowIso = new Date().toISOString().slice(0, 16).replace('T', ' ');
const today = new Date().toISOString().slice(0, 10);

// commits, grouped by dominant area of their touched files
const commitRows = commits.map((sha) => {
  const short = sha.slice(0, 8);
  const subject = g(`show -s --format=%s ${sha}`);
  const files = gLines(`show --name-only --format= ${sha}`);
  const counts = {};
  for (const f of files) { const a = areaOf(f); counts[a] = (counts[a] || 0) + 1; }
  const area = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'root';
  return { short, subject, area };
});
const byArea = {};
for (const c of commitRows) (byArea[c.area] ||= []).push(c);

// files touched across the whole range (with net line delta)
let fileStats = [];
if (commits.length) {
  const first = commits[commits.length - 1];
  const numstat = gLines(`diff --numstat ${first}^..HEAD`);
  fileStats = numstat.map((l) => {
    const [add, del, ...rest] = l.split('\t');
    return { file: rest.join('\t'), add, del };
  }).filter((f) => f.file);
}

// tags pointing at any commit in range — split lanes (archive/salvage) from the rest
const tagsInRange = new Set();
for (const sha of commits) for (const t of gLines(`tag --points-at ${sha}`)) tagsInRange.add(t);
const tags = [...tagsInRange];
const shipped = tags.filter((t) => t.startsWith('archive/lane-')).map((t) => t.replace('archive/lane-', ''));
const abandoned = tags.filter((t) => t.startsWith('salvage/lane-')).map((t) => t.replace('salvage/lane-', ''));
const otherTags = tags.filter((t) => !t.startsWith('archive/lane-') && !t.startsWith('salvage/lane-'));

// uncommitted / unpushed — the loud part
const dirty = gLines('status --porcelain');
const aheadDev = branch ? (g(`rev-list --count origin/${branch}..${branch}`) || '') : '';
const hasUpstream = !!g(`rev-parse --abbrev-ref ${branch}@{upstream}`);

// ── render the markdown block (only facts) ────────────────────────────────────
const out = [];
const p = (s = '') => out.push(s);
p(`## Session wrap — ${nowIso} UTC`);
p('');
p(`- Branch: \`${branch}\`  ·  range: \`${range}\` (baseline: ${baseSource})  ·  ${commits.length} commit(s)`);
p('');

if (commits.length) {
  p('### Commits by area');
  for (const area of Object.keys(byArea).sort((a, b) => byArea[b].length - byArea[a].length)) {
    p(`- **${area}** (${byArea[area].length})`);
    for (const c of byArea[area]) p(`  - \`${c.short}\` ${c.subject}`);
  }
  p('');
  p(`### Files touched (${fileStats.length})`);
  for (const f of fileStats.slice(0, 40)) p(`- \`${f.file}\`  (+${f.add}/-${f.del})`);
  if (fileStats.length > 40) p(`- …and ${fileStats.length - 40} more`);
  p('');
} else {
  p('### Commits');
  p('- none in range');
  p('');
}

p('### Lanes & tags');
p(`- lanes shipped: ${shipped.length ? shipped.join(', ') : 'none'}`);
p(`- lanes abandoned/salvaged: ${abandoned.length ? abandoned.join(', ') : 'none'}`);
p(`- other tags cut: ${otherTags.length ? otherTags.join(', ') : 'none'}`);
p('');

p('### Uncommitted / unpushed');
let clean = true;
if (dirty.length) { p(`- ⚠ ${dirty.length} uncommitted change(s) still in the working tree — NOT saved by this wrap`); clean = false; }
if (!hasUpstream) { p(`- ⚠ \`${branch}\` has no upstream — nothing is pushed`); clean = false; }
else if (aheadDev && aheadDev !== '0') { p(`- ⚠ \`${branch}\` is ${aheadDev} commit(s) ahead of \`origin/${branch}\` — UNPUSHED`); clean = false; }
if (clean) p('- ✓ tree clean, branch pushed — nothing at risk');
p('');

// ── write a local session record (never dirties a worktree) ───────────────────
// A clean no-op session has no durable delta. Updating the heartbeat is enough; writing
// a markdown record for every lookup-only session created local metadata churn without
// improving recovery or handoff quality.
if (clean && commits.length === 0) {
  writeFileSync(WRAP_STAMP, String(Date.now()));
  console.log('wrap: no durable changes; heartbeat refreshed, no session record written.');
  process.exit(0);
}

const sessionsDir = join(commonDir, 'dc-session-wraps');
if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });
const safeStamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = join(sessionsDir, `${safeStamp}-${process.pid}.md`);
const block = out.join('\n') + '\n';
writeFileSync(file, `# Session record — ${today}\n\nFactual, git-derived session wrap (\`npm run wrap\`). Local Git metadata; this file never changes the checkout.\n\n${block}`);
writeFileSync(WRAP_STAMP, String(Date.now()));

console.log(`wrap: wrote ${commits.length}-commit local record (baseline: ${baseSource}).`);
if (!clean) console.log('wrap: ⚠ uncommitted or unpushed work — see the record.');
