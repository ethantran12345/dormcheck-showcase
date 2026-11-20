#!/usr/bin/env node
/**
 * repo-state - one screen, plain English: where is every scrap of work, and which
 * git state has NO recovery path? Built after a 10-hour day where every loss lived
 * in a stash, an untracked file, or a dangling commit - never in anything committed.
 *
 *   npm run state            (also: /state slash command; warn-only step in pre-push)
 *
 * Exit 0 always, EXCEPT: STRICT=1 exits 1 when something stale is found (for CI/hooks).
 *
 * Design rule (learned the hard way): never address a stash by index - indices
 * renumber on every create/drop. Enumerate, resolve to SHA, operate by SHA.
 */
import { execSync } from 'node:child_process';
import { statSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { readLanes, ageMs, human, STALE_LANE_MS, mainRoot, ownsFile, laneIsLive, laneInactive, porcelainPaths } from './lib/lanes.mjs';
import { scanPendingDestructive } from './lib/migrations.mjs';

const g = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
};
// Line-oriented output for formats where no leading whitespace is significant
// (log, for-each-ref, ls-files, diff --name-only, worktree list, fsck). Porcelain
// status is NOT one of those — it must go through porcelainPaths(), never here.
const gLines = (cmd) => g(cmd).split('\n').filter(Boolean);
const SRC = (f) => /^(src|supabase)\//.test(f);
const now = Date.now();
const hrs = (ms) => (ms / 3.6e6);
const agoH = (ms) => { const h = hrs(ms); return h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h`; };

let offenders = []; // {sev, msg}  sev: 3=no-recovery, 2=parked-risk, 1=hygiene
const flag = (sev, msg) => offenders.push({ sev, msg });

const out = [];
const p = (s = '') => out.push(s);
const H = (s) => p(`\n${s}`);

// ── 1. HEAD + cleanliness ────────────────────────────────────────────────────
const branch = g('git rev-parse --abbrev-ref HEAD') || '(detached)';
// Parsed, not sliced — these paths are matched against live lanes' --owns globs
// in the COLLISION RISK check below, where a single mangled character silently
// turns a real collision into "no overlap". See porcelainPaths() in lib/lanes.mjs.
const dirtyPaths = porcelainPaths();
const dirtyN = dirtyPaths.length;
p(`REPO  the repo root`);
p(`HEAD  ${branch}   ${dirtyN ? `⚠ DIRTY (${dirtyN} change${dirtyN > 1 ? 's' : ''})` : '✓ clean'}`);
if (dirtyN) flag(1, `${dirtyN} uncommitted change(s) on ${branch}`);

// ── 1b. Stale git locks ──────────────────────────────────────────────────────
// A .git/*.lock left by a killed git process blocks every later write with NO other
// signal — commits just fail, and an editor that commits for you (Obsidian) stops
// silently. The vault held a 0-byte index.lock from 2026-08-10 to 2026-08-16 with
// ~30 files uncommitted and nothing anywhere pointing at the cause. Both repos are
// checked, because the one that went silent is the one nobody runs `git status` in.
// Warn only, never auto-remove: a lock younger than the threshold IS a live git op.
const LOCK_STALE_MIN = 5;
const lockRoots = [
  { label: 'the repo root', dir: resolve(g('git rev-parse --git-common-dir') || '.git') },
];
// Locks live in exactly three places; never walk objects/ (256 shards of loose objects).
const scanLocks = (dir) => {
  const found = [];
  const kids = (d) => { try { return readdirSync(d, { withFileTypes: true }); } catch { return []; } };
  const add = (full) => {
    if (!full.endsWith('.lock')) return;
    try { found.push({ path: full, age: now - statSync(full).mtimeMs }); } catch { /* raced away — fine */ }
  };
  for (const e of kids(dir)) if (e.isFile()) add(join(dir, e.name));                       // index/HEAD/config/shallow
  for (const e of kids(join(dir, 'objects'))) if (e.isFile()) add(join(dir, 'objects', e.name)); // maintenance
  const walkRefs = (d) => { for (const e of kids(d)) { const f = join(d, e.name); e.isDirectory() ? walkRefs(f) : add(f); } };
  walkRefs(join(dir, 'refs'));
  return found;
};
H(`STALE GIT LOCKS (a lock with no git process behind it blocks every write, silently)`);
let staleLocks = 0;
for (const { label, dir } of lockRoots) {
  if (!existsSync(dir)) continue;
  for (const l of scanLocks(dir)) {
    const rel = `${label}/.git${l.path.slice(dir.length)}`;
    if (l.age / 6e4 < LOCK_STALE_MIN) { p(`  · ${rel}  (${Math.round(l.age / 6e4)}m — assumed live git op, leave it)`); continue; }
    staleLocks++;
    p(`  ⚠ ${rel}  (${agoH(l.age)} old)`);
    p(`      → prove no git process owns it, then:  rm "${l.path}"`);
    p(`         (a com.apple/mdworker FD in lsof is Spotlight indexing the leftover, NOT an owner)`);
    flag(2, `stale git lock ${basename(l.path)} in ${label} (${agoH(l.age)} old — blocks writes silently)`);
  }
}
if (!staleLocks) p(`  none ✓  (both repos; a lock younger than ${LOCK_STALE_MIN}m is treated as a live git op)`);

// ── 2. dev / main sync ───────────────────────────────────────────────────────
H('SYNC');
for (const b of ['dev', 'main']) {
  const local = g(`git rev-parse ${b}`);
  const remote = g(`git rev-parse origin/${b}`);
  if (!local) { p(`  ${b}: (no local branch)`); continue; }
  if (!remote) { p(`  ${b}: local ${local.slice(0, 8)}, no origin/${b}`); continue; }
  if (local === remote) { p(`  ${b} = origin/${b}  ✓ (${local.slice(0, 8)})`); }
  else {
    const ahead = g(`git rev-list --count origin/${b}..${b}`) || '?';
    const behind = g(`git rev-list --count ${b}..origin/${b}`) || '?';
    p(`  ${b} ≠ origin/${b}  ⚠ ahead ${ahead}, behind ${behind}`);
    if (Number(ahead) > 0) flag(2, `${b} has ${ahead} commit(s) not pushed to origin/${b}`);
  }
}
if (g('git rev-parse dev') && g('git rev-parse main')) {
  const diff = gLines('git diff --name-only dev main').length;
  p(`  dev vs main: ${diff === 0 ? 'content-identical ✓' : `${diff} file(s) differ`}`);
}

// ── 3. Branches (non dev/main) ───────────────────────────────────────────────
H('BRANCHES (beyond dev/main)');
const branches = gLines(`git for-each-ref --format='%(refname:short)|%(committerdate:relative)' refs/heads`)
  .map((l) => l.split('|')).filter(([b]) => b && b !== 'dev' && b !== 'main');
if (!branches.length) p('  none ✓');
for (const [b, age] of branches) {
  const unmerged = g(`git rev-list --count dev..${b}`);
  const merged = unmerged === '0';
  p(`  ${b}  (${age})  ${merged ? '✓ merged into dev' : `⚠ ${unmerged} commit(s) NOT on dev`}`);
  p(`      → ${merged ? `npm run finish-branch ${b}` : `review before deleting: git log dev..${b}`}`);
  flag(merged ? 1 : 2, `stray branch ${b} (${merged ? 'merged, run finish-branch' : `${unmerged} unmerged commits`})`);
}

// ── 4. Stashes (the killer section) ──────────────────────────────────────────
H('STASHES');
const stashLines = gLines(`git stash list --format='%H|%gs'`);
if (!stashLines.length) p('  none ✓  (parked work belongs in a WIP commit or a pushed wip/* tag)');
for (const line of stashLines) {
  const [sha, ...subjParts] = line.split('|');
  const subject = subjParts.join('|');
  const files = gLines(`git diff --name-only ${sha}^1 ${sha}`).filter(SRC);
  p(`  ✱ ${sha.slice(0, 8)}  "${subject}"`);
  let landed = 0, diverged = 0, gone = 0;
  const dirs = new Set();
  for (const f of files) {
    dirs.add(f.split('/').slice(0, 3).join('/'));
    const onDev = g(`git cat-file -e dev:${f} && echo y`) === 'y';
    const numstat = g(`git diff --numstat dev ${sha} -- ${f}`);
    if (!numstat) { landed++; p(`      ${f}  — landed on dev`); continue; }
    const [add, del] = numstat.split('\t');
    if (!onDev) { gone++; p(`      ${f}  +${add}/-${del}  ⚠ file deleted on dev (stash predates removal)`); }
    else { diverged++; p(`      ${f}  +${add}/-${del}  ⚠ differs from dev`); }
  }
  const summary = `${files.length} src/supabase file(s): ${landed} landed, ${diverged} diverged, ${gone} gone-on-dev`;
  p(`      ${summary}`);
  // label-vs-content heuristic: does the label name a feature the files don't touch?
  const tokens = ['tenant', 'pitt', 'resource', 'verification', 'map', 'transit', 'marketplace', 'roommate', 'setting', 'checklist'];
  const labelTok = tokens.filter((t) => subject.toLowerCase().includes(t));
  const pathBlob = files.join(' ').toLowerCase();
  const missing = labelTok.filter((t) => !pathBlob.includes(t) && !(t === 'setting' && pathBlob.includes('settings')));
  if (labelTok.length && missing.length) {
    p(`      ⚠ LABEL/CONTENT MISMATCH: label says "${missing.join(', ')}" but no such files changed. Trust the SHA, not the label.`);
    flag(2, `stash ${sha.slice(0, 8)} label mentions "${missing.join(', ')}" but content doesn't match`);
  }
  if (diverged || gone) flag(2, `stash ${sha.slice(0, 8)} "${subject}" holds ${diverged + gone} file(s) not cleanly on dev`);
  else flag(1, `stash ${sha.slice(0, 8)} fully landed — safe to drop once tagged`);
}

// ── 5. Untracked files older than 2h (the ONLY state with no recovery path) ──
H('UNTRACKED > 2h old (no recovery path — commit or delete)');
const untracked = gLines('git ls-files --others --exclude-standard');
let oldUntracked = 0;
for (const f of untracked) {
  let mtime;
  try { mtime = statSync(f).mtimeMs; } catch { continue; }
  const age = now - mtime;
  if (hrs(age) >= 2) { oldUntracked++; p(`  ⚠ ${f}  (${agoH(age)} old)`); flag(3, `untracked ${f} (${agoH(age)}, unrecoverable)`); }
}
if (!oldUntracked) p(`  none ✓  (${untracked.length} untracked file(s), all < 2h)`);

// ── 6. Dangling commits < 7 days ─────────────────────────────────────────────
// NOTE: no --no-reflogs — a reflog-reachable commit HAS a recovery path, so it is
// not "dangling". Only commits reachable from neither a ref nor a reflog count.
// Filter to commits that touch src/supabase (a 0-src-file dangling commit is a
// merge parent / empty internal, pure noise) and cap the list to keep one screen.
H('DANGLING commits < 7 days, touching src (no ref/reflog — git checkout <sha> to recover)');
const dangling = gLines('git fsck --unreachable 2>/dev/null')
  .filter((l) => l.startsWith('unreachable commit'))
  .map((l) => l.split(' ')[2])
  .map((sha) => {
    const when = g(`git show -s --format=%ct ${sha}`);
    if (!when) return null;
    const age = now - Number(when) * 1000;
    const nfiles = gLines(`git diff --name-only ${sha}^ ${sha} 2>/dev/null`).filter(SRC).length;
    return { sha, age, nfiles };
  })
  .filter((e) => e && hrs(e.age) <= 24 * 7 && e.nfiles >= 1)
  .sort((a, b) => a.age - b.age);
if (!dangling.length) p('  none ✓');
for (const e of dangling.slice(0, 6)) {
  const date = g(`git show -s --format=%cd --date=format:%Y-%m-%d\\ %H:%M ${e.sha}`);
  p(`  ${e.sha.slice(0, 8)}  ${date}  (${agoH(e.age)} ago)  ${e.nfiles} src file(s)`);
}
if (dangling.length > 6) p(`  …and ${dangling.length - 6} more (git fsck --unreachable).`);
// Informational only — a dangling commit < 7d still has a recovery path (checkout),
// and most are git internals (stash drops, autosnapshot, reflog). Not a verdict
// offender; scan the list yourself for a genuinely lost commit.
if (dangling.length) p('  (informational — recoverable 7 days; scan for a real loss)');

// ── 7. Worktrees ─────────────────────────────────────────────────────────────
H('WORKTREES');
const worktrees = gLines('git worktree list');
worktrees.forEach((w, i) => p(`  ${i === 0 ? '·' : '⚠'} ${w}${i > 0 ? '   ← stray worktree (git worktree remove)' : ''}`));
if (worktrees.length > 1) flag(2, `${worktrees.length - 1} extra worktree(s) — a stray worktree holding dev blocks other sessions`);

// ── 7.5 Lanes ────────────────────────────────────────────────────────────────
// Read-only here (never pushes) — auto-salvage of a dead lane happens on the next
// `npm run lane:*` command. This section just makes lanes visible + flags trouble.
H('LANES (parallel-agent worktrees)');
const lanes = readLanes();
if (!lanes.length) p('  none ✓');
for (const l of lanes) {
  const age = ageMs(l.startedAt);
  const stale = age > STALE_LANE_MS;
  const parked = l.status === 'parked';
  const inactive = !parked && laneInactive(l);   // live status but agent looks gone
  const ahead = g(`git rev-list --count origin/dev..${l.branch}`) || '?';
  const wtOk = existsSync(l.worktree);
  const dirty = wtOk ? (g(`git -C "${l.worktree}" status --porcelain`) ? 'dirty' : 'clean') : 'NO WORKTREE';
  const marks = [];
  if (parked) marks.push(l.parkedReason === 'inactive' ? '⏸ PARKED (auto, inactive — ownership released)' : '⏸ PARKED (ownership released)');
  else if (inactive) marks.push('☾ INACTIVE (agent gone/idle — ownership NOT enforced)');
  else if (stale) marks.push('⏰ STALE >8h');
  const glyph = parked ? '⏸' : inactive ? '☾' : '●';
  p(`  ${glyph} ${l.name}  (${human(age)})  ${dirty}  ${ahead} ahead of dev${marks.length ? '  ' + marks.join('  ') : ''}`);
  p(`      owns: ${(l.owns || []).join(', ')}${laneIsLive(l) ? '' : '  (not enforced)'}`);
  if (parked) flag(1, `lane "${l.name}" is parked — resume (npm run lane:resume ${l.name}) or ship it when ready`);
  else if (inactive) flag(1, `lane "${l.name}" looks inactive — will auto-park on the next lane command; resume to re-claim`);
  else if (stale) flag(2, `lane "${l.name}" is ${human(age)} old (>8h) — ship or abandon it`);
}

// Main-worktree hazard: a lane is live, yet THIS is the main worktree and it's dirty —
// i.e. a second session is editing in main (unprotected) while a lane owns files. That's
// exactly the gap the SessionStart hook (scripts/session-begin.mjs) warns about; the
// warning is easy to miss mid-session, so `state` flags the same condition in its verdict.
const liveLanes = lanes.filter((l) => laneIsLive(l));
const inMain = resolve(g('git rev-parse --show-toplevel') || '.') === mainRoot();
if (liveLanes.length && inMain && dirtyN) {
  // porcelainPaths already yields raw, unquoted paths and resolves a rename to its
  // DESTINATION, so the old slice/unquote/" -> "-split trio is gone with the bug.
  const dirtyFiles = dirtyPaths;
  const collisions = [];
  for (const l of liveLanes) for (const f of dirtyFiles) if (ownsFile(l.owns, f)) collisions.push({ lane: l.name, file: f });
  if (collisions.length) {
    p(`  ⚠ COLLISION RISK: main worktree is editing ${collisions.length} file(s) a live lane owns:`);
    for (const c of collisions.slice(0, 5)) p(`      ${c.file}  ← owned by live lane "${c.lane}"`);
    flag(3, `main-worktree editing ${collisions.length} file(s) owned by live lane "${collisions[0].lane}" — start a lane or you WILL collide`);
  } else {
    p(`  ⚠ ${liveLanes.length} live lane(s), but the main worktree has ${dirtyN} uncommitted change(s) — main-worktree work is NOT lane-protected.`);
    flag(2, `main worktree dirty (${dirtyN}) while ${liveLanes.length} lane(s) live — start your own lane before editing`);
  }
}

// ── 7.6 Autosave (auto-wip safety net) ───────────────────────────────────────
// A net nobody verified isn't a net (finish-branch + autosnapshot were both silently
// broken until tested). So this section reports BOTH halves out loud: when the last
// auto-wip actually ran, AND whether the Claude Code hooks that trigger it are wired.
H('AUTOSAVE (auto-wip safety net — npm run wip)');
const gitCommon = g('git rev-parse --git-common-dir');
const stampPath = join(gitCommon ? resolve(gitCommon) : '.git', 'dc-last-wip');
if (existsSync(stampPath)) {
  let last = 0;
  try { last = Number(readFileSync(stampPath, 'utf8').trim()) || 0; } catch { /* unreadable */ }
  if (last) {
    const when = new Date(last).toISOString().slice(0, 16).replace('T', ' ');
    p(`  last auto-wip: ${agoH(now - last)} ago  (${when} UTC)`);
  } else p('  last auto-wip: stamp present but unreadable');
} else {
  p('  last auto-wip: never (no dc-last-wip stamp yet)');
}
// Are the Stop + SessionEnd hooks actually registered and pointed at wip?
let stopWired = false, endWired = false;
try {
  const s = JSON.parse(readFileSync('.claude/settings.json', 'utf8'));
  const hooks = s.hooks || {};
  const points = (evt) => (hooks[evt] || []).some((grp) => (grp.hooks || []).some((h) => /\bwip\b/.test(h.command || '')));
  stopWired = points('Stop');
  endWired = points('SessionEnd');
} catch { /* no settings / bad JSON -> treated as not wired */ }
if (stopWired && endWired) {
  p('  hooks: Stop ✓  SessionEnd ✓  (wired in .claude/settings.json → npm run wip)');
} else {
  p(`  hooks: Stop ${stopWired ? '✓' : '✗ MISSING'}  SessionEnd ${endWired ? '✓' : '✗ MISSING'}`);
  p('     ⚠ AUTOSAVE IS NOT FULLY WIRED — clearing a chat can lose uncommitted work.');
  p('     → restore the wip hooks in .claude/settings.json (Stop + SessionEnd → npm run wip).');
  flag(3, `AUTOSAVE hooks not wired (Stop ${stopWired ? 'ok' : 'MISSING'}, SessionEnd ${endWired ? 'ok' : 'MISSING'}) — auto-save on chat-clear is OFF`);
}

// ── 7.7 Journal freshness (session wrap + vault bridge) ──────────────────────
// Both depend on stamps written by their scripts (wrap on SessionEnd, vault:sync on
// release). Report when each last ran and flag it stale: wrap vs the newest commit
// anywhere (it records every session), vault:sync vs the newest commit on main (it
// only bridges what's been released, so comparing to dev HEAD would flag it forever).
H('JOURNAL (session wrap + vault bridge)');
const jCommon = gitCommon ? resolve(gitCommon) : '.git';
const readStampMs = (name) => {
  const f = join(jCommon, name);
  if (!existsSync(f)) return 0;
  try { return Number(readFileSync(f, 'utf8').trim()) || 0; } catch { return 0; }
};
// wrap-freshness compares to the newest commit that touched code OUTSIDE docs/sessions/ —
// a commit that only records a session must not mark the recorder as stale (else it churns).
const codeTimeMs = Number(g("git log -1 --format=%ct -- . ':(exclude)docs/sessions'") || g('git show -s --format=%ct HEAD') || 0) * 1000;
const mainRef = g('git rev-parse -q --verify origin/main') ? 'origin/main' : (g('git rev-parse -q --verify main') ? 'main' : '');
const mainTimeMs = mainRef ? Number(g(`git show -s --format=%ct ${mainRef}`) || 0) * 1000 : 0;

const lastWrap = readStampMs('dc-last-wrap');
if (!lastWrap) { p('  wrap: never run (no dc-last-wrap stamp) — `npm run wrap` records the session'); flag(1, 'session wrap has never run — no factual session record'); }
else {
  const stale = codeTimeMs && codeTimeMs > lastWrap;
  p(`  wrap: last ran ${agoH(now - lastWrap)} ago${stale ? '  ⚠ STALE — commits landed since the last wrap' : '  ✓ up to date with HEAD'}`);
  if (stale) flag(1, `session wrap is stale — commit(s) landed after the last wrap (run npm run wrap)`);
}

const lastSync = readStampMs('dc-last-vault-sync');
if (!lastSync) { p('  vault:sync: never run (no dc-last-vault-sync stamp) — runs from `npm run release`'); }
else {
  const stale = mainTimeMs && mainTimeMs > lastSync;
  p(`  vault:sync: last ran ${agoH(now - lastSync)} ago${stale ? '  ⚠ STALE — main advanced since the last vault sync' : '  ✓ up to date with main'}`);
  if (stale) flag(1, `vault:sync is stale — main advanced after the last sync (runs on npm run release)`);
}

// ── 7.8 Migrations pending vs the release base ───────────────────────────────
// COUNT ONLY, and only over one domain: migration files not yet on origin/main (plus
// uncommitted ones). This banner deliberately renders NO destructiveness verdict — its
// domain excludes a migration already merged to origin/main but never applied in prod,
// which is exactly the destructive case that matters most. `npm run db:preflight` is the
// only thing that decides destructiveness, because it adds the Management API's applied
// set to the scan. See the domain note in scripts/lib/migrations.mjs.
H('MIGRATIONS PENDING VS RELEASE BASE (count only — not a destructiveness verdict)');
try {
  const { base, files } = scanPendingDestructive();
  const vs = base || 'main';
  p(`  ${files.length ? `${files.length} pending vs ${vs}` : `none pending vs ${vs} ✓`}`);
  // Names only — deliberately no destructive/safe annotation per name. Capped so a big
  // queue can't push the rest of the banner off screen.
  const CAP = 5;
  for (const f of files.slice(0, CAP)) p(`      ${basename(f)}`);
  if (files.length > CAP) p(`      …+${files.length - CAP} more`);
  p(`     → this list is git-pending vs ${vs} ONLY: a migration already merged to main and unapplied in prod does not appear here at all.`);
  p(`     → destructiveness is determined by \`npm run db:preflight\` only (it also verifies a fresh backup).`);
} catch (e) { p(`  (migration scan skipped: ${String(e.message || e).split('\n')[0]})`); }

// ── 8. Agent lock ────────────────────────────────────────────────────────────
H('AGENT LOCK');
p('  ' + (g('node scripts/agent-lock.mjs status').replace(/^·\s*/, '') || 'free.'));

// ── 9. Verdict ───────────────────────────────────────────────────────────────
offenders.sort((a, b) => b.sev - a.sev);
H('─'.repeat(64));
if (!offenders.length) {
  p('VERDICT: Clean. Nothing parked, nothing at risk. ✓');
} else {
  const top = offenders[0];
  const sevWord = { 3: 'NO RECOVERY PATH', 2: 'parked/at-risk', 1: 'hygiene' }[top.sev];
  p(`VERDICT: ${offenders.length} item(s) need attention. Top [${sevWord}]: ${top.msg}`);
  for (const o of offenders.slice(1, 6)) p(`         · ${o.msg}`);
}
p('');

process.stdout.write(out.join('\n') + '\n');

const strict = process.env.STRICT === '1';
const stale = offenders.some((o) => o.sev >= 1);
process.exit(strict && stale ? 1 : 0);
