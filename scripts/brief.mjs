#!/usr/bin/env node
/**
 * brief - one command that catches any session up on what happened. Cowork reads
 * this repo directly, so its work is visible to Claude Code; the reverse isn't, and
 * a fresh session starts blind to what the last one shipped. This prints the three
 * things that answer "what changed recently?" in one screen:
 *
 *   npm run brief            # default: last 15 commits
 *   npm run brief -- 30      # last 30 commits
 *
 *   1. recent commits grouped by area (src feature, supabase, api, docs, ...)
 *   2. current lane status (parallel-agent worktrees, if any)
 *   3. the newest 3 docs/DECISIONS.md entries (the "why", not just the "what")
 *
 * Exit 0 always - a read-only catch-up report, never a gate.
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { readLanes, ageMs, human, laneIsLive, laneInactive } from './lib/lanes.mjs';

const g = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
};

const N = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 15;

const out = [];
const p = (s = '') => out.push(s);
const H = (s) => p(`\n${s}`);

// Map a changed path to the area it belongs to (same rule as scripts/wip.mjs):
// src/components/<feat> -> <feat>, src/<dir> -> <dir>, else the top-level dir.
function areaOf(pathRaw) {
  let f = pathRaw.trim();
  if (f.includes(' -> ')) f = f.split(' -> ').pop();
  f = f.replace(/^"|"$/g, '');
  const seg = f.split('/');
  if (seg.length === 1) return 'root';   // a top-level file (README, config, proof junk)
  if (seg[0] === 'src') {
    if (seg[1] === 'components' && seg[2]) return seg[2];
    if (seg[1]) return seg[1];
    return 'src';
  }
  return seg[0] || 'root';
}

// ── 1. recent commits grouped by area ────────────────────────────────────────
p(`BRIEF  the repo root   (last ${N} commits on ${g('git rev-parse --abbrev-ref HEAD') || 'HEAD'})`);
H(`RECENT COMMITS BY AREA`);
// One record per commit: sha, subject, and the dominant area of its changed files.
// Git's %x1f emits a literal unit-separator byte between sha and subject; the same
// byte splits them back apart in JS. A filename line never contains that byte, so
// it's an unambiguous "header vs changed-file" test.
const SEP = String.fromCharCode(31);
const log = g(`git log -n ${N} --no-merges --pretty=format:%h%x1f%s --name-only`);
const commits = [];
let cur = null;
for (const line of log.split('\n')) {
  if (line.includes(SEP)) {
    const [sha, subject] = line.split(SEP);
    cur = { sha, subject, counts: {} };
    commits.push(cur);
  } else if (line.trim() && cur) {
    const a = areaOf(line);
    cur.counts[a] = (cur.counts[a] || 0) + 1;
  }
}
// Assign each commit to its most-touched area, then bucket by area.
const byArea = {};
for (const c of commits) {
  const top = Object.entries(c.counts).sort((a, b) => b[1] - a[1])[0];
  const area = top ? top[0] : 'root';
  (byArea[area] ||= []).push(c);
}
const areasSorted = Object.entries(byArea).sort((a, b) => b[1].length - a[1].length);
if (!areasSorted.length) p('  (no commits)');
for (const [area, cs] of areasSorted) {
  p(`  ${area}  (${cs.length})`);
  for (const c of cs) p(`      ${c.sha}  ${c.subject.slice(0, 88)}`);
}

// ── 2. current lane status ───────────────────────────────────────────────────
H(`LANES (parallel-agent worktrees)`);
const lanes = readLanes();
if (!lanes.length) p('  none ✓');
for (const l of lanes) {
  const parked = l.status === 'parked';
  const inactive = !parked && laneInactive(l);
  const glyph = parked ? '⏸' : inactive ? '☾' : '●';
  const tag = parked ? '  [parked — ownership released]' : inactive ? '  [inactive — not enforced]' : '';
  const ahead = g(`git rev-list --count origin/dev..${l.branch}`) || '?';
  const dirty = existsSync(l.worktree)
    ? (g(`git -C "${l.worktree}" status --porcelain`) ? 'dirty' : 'clean')
    : 'NO WORKTREE';
  p(`  ${glyph} ${l.name}  (${human(ageMs(l.startedAt))})  ${dirty}  ${ahead} ahead of dev${tag}`);
  if ((l.owns || []).length) p(`      owns: ${l.owns.join(', ')}${laneIsLive(l) ? '' : '  (not enforced)'}`);
}

// ── 3. newest 3 decisions ────────────────────────────────────────────────────
H(`LATEST DECISIONS (docs/DECISIONS.md — the "why")`);
const decPath = 'docs/DECISIONS.md';
if (!existsSync(decPath)) {
  p('  (docs/DECISIONS.md not found)');
} else {
  // Entries are lines beginning "- YYYY-MM-DD:". Take the last 3, and show the
  // bracketed decision title (before " - Why:"), truncated to keep one screen.
  const entries = readFileSync(decPath, 'utf8').split('\n')
    .filter((l) => /^- \d{4}-\d{2}-\d{2}:/.test(l));
  const latest = entries.slice(-3).reverse();
  if (!latest.length) p('  (no dated entries)');
  for (const e of latest) {
    const m = e.match(/^- (\d{4}-\d{2}-\d{2}): (.*)$/);
    if (!m) continue;
    const [, date, rest] = m;
    // Prefer the [decision] bracket; fall back to the text before " - Why:".
    const bracket = rest.match(/^\[([^\]]+)\]/);
    const title = (bracket ? bracket[1] : rest.split(' - Why:')[0]).trim();
    p(`  ${date}  ${title.slice(0, 140)}${title.length > 140 ? '…' : ''}`);
  }
}

p('');
process.stdout.write(out.join('\n') + '\n');
process.exit(0);
