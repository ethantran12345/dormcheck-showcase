#!/usr/bin/env node
/**
 * lane - one worktree per parallel agent, with ENFORCED path ownership, so
 * concurrent Claude Code sessions on this repo physically cannot collide, and
 * every lane merges to dev the SAME session. Supersedes the warn-only agent lock.
 *
 *   npm run lane:start <name> --owns "src/components/map/**,src/lib/transit*"
 *   npm run lane:status
 *   npm run lane:ship            (from inside a lane worktree)
 *   npm run lane:abandon         (from inside a lane worktree — salvages, does NOT merge)
 *   npm run lane:diff [name]     (--full for the patch; --stat is the default)
 *   npm run since <ref>          (plain-English summary of changes since a tag/SHA)
 *
 * Internal: `node scripts/lane.mjs check-staged` is called by .githooks/pre-commit.
 *
 * Model of the world (agreed 2026-07-21):
 *   - The MAIN worktree is a PREVIEW surface, not an editing surface. lane:ship
 *     merges into dev THERE (keeping :8080 honest), so it refuses if the main
 *     worktree is dirty. Agents edit in lanes, never in the main checkout.
 *   - Lanes are ephemeral: start → work → ship (or abandon) same session. Every
 *     close leaves a PUSHED tag (archive/lane-* on ship, salvage/lane-* on abandon
 *     or death), so any lane is recoverable by name forever.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, symlinkSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';

// Link a directory into a lane worktree, preferring the mechanism that works unprivileged
// on the host. On Windows a 'junction' needs no Developer Mode or elevation, where a
// 'dir' symlink does; elsewhere a symlink is the only option. Returns success so the
// caller can report a failure instead of leaving a half-built worktree behind.
function linkDir(src, dest) {
  if (!existsSync(src)) return false;
  for (const type of process.platform === 'win32' ? ['junction', 'dir'] : ['dir']) {
    try { symlinkSync(src, dest, type); return true; } catch { /* try the next mechanism */ }
  }
  return false;
}
import { resolve, join, dirname, basename } from 'node:path';
import {
  git, tryGit, gLines, mainRoot, readLanes, writeLanes, laneForPath,
  ownsFile, expandOwns, ownershipConflicts, reapDeadLanes, pidAlive, ageMs, human,
  STALE_LANE_MS, acquireShipLock, releaseShipLock, sessionAnchor, stagedSnapshotPath,
  laneIsLive, laneInactive, inactiveMs, touchLane, touchLaneForWorktree, LANE_INACTIVE_MS,
  OVERDUE_LANE_MS, LANE_DEFER_MAX_MS, laneOverdue, laneAgeMs, deferralActive, overdueBlockText,
} from './lib/lanes.mjs';

import { activeClaudeCliSessions } from './lib/agent-sessions.mjs';

const say = (s = '') => console.log(s);
const die = (s) => { console.error(`✗ ${s}`); process.exit(1); };
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
// Unlike `tryGit`, this intentionally preserves leading spaces and NUL delimiters.
// Git porcelain encodes its status in those first two bytes.
const tryGitRaw = (cmd, opts = {}) => {
  try { return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }); }
  catch { return ''; }
};
const gitSucceeds = (cmd, opts = {}) => {
  try { execSync(`git ${cmd}`, { stdio: 'ignore', ...opts }); return true; }
  catch { return false; }
};

// ── arg parsing ──────────────────────────────────────────────────────────────
const [, , cmd, ...rest] = process.argv;
function flagValue(name) {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : null;
}
const hasFlag = (name) => rest.includes(name);
const positionals = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--')));

// `git status --porcelain -z` is the machine interface. Splitting ordinary
// porcelain lines (or slicing three characters off them) breaks on quoted paths,
// renames, and embedded whitespace — exactly the files an ownership guard must
// recognize reliably.
function porcelainPaths(cwd) {
  const raw = tryGitRaw('status --porcelain=v1 -z', { cwd });
  if (!raw) return [];
  const entries = raw.split('\0');
  const paths = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const status = entry.slice(0, 2);
    paths.push(entry.slice(3));
    // In -z porcelain rename/copy entries carry the original path in the next
    // NUL-delimited record. Check both sides so ownership is conservative.
    if ((status.includes('R') || status.includes('C')) && entries[i + 1]) paths.push(entries[++i]);
  }
  return paths;
}

function writerAdvisory(prefix = '⚠') {
  const sessions = activeClaudeCliSessions();
  if (!sessions.available || sessions.pids.length <= 1) return null;
  return `${prefix} ${sessions.pids.length} active Claude CLI sessions detected (PIDs ${sessions.pids.join(', ')}). Confirm the others are read-only or in lanes before editing; this excludes Claude.app helper processes.`;
}

// Broad ownership prevents useful parallelism. It is occasionally legitimate (for
// an intentionally repo-wide migration), but it must be a conscious, reviewable
// exception rather than the convenient default.
const BROAD_OWNERSHIP_GLOBS = new Set([
  'src/**', 'src/hooks/**', 'src/lib/**', 'src/pages/**', 'docs/**',
]);
const laneHandoffPath = (lane) => `docs/handoffs/lane-${lane.name}.md`;
const DEPENDENCY_FILES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'];
const CONTRACT_HEADINGS = ['## Objective', '## Owned paths', '## Touched interfaces', '## Dependencies & blockers', '## Verification', '## Ready to ship', '## Known limitations', '## Documentation & journaling'];
function isDependencyPath(path) { return DEPENDENCY_FILES.includes(path); }
// The keys that actually change the RESOLVED dependency graph. `scripts` does not, and
// gating it has now cost real work twice (2026-08-16): adding a one-line docs:assemble
// script would have needed a whole dependency lane, and check-gate-parity.mjs had to be
// widened from "npm script name" to "the command the gate runs" for the same reason —
// because giving a gate an npm script meant staging package.json, which this rule
// refused. A rule that reshapes unrelated tooling to avoid it is mis-scoped.
const DEPENDENCY_KEYS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides', 'resolutions'];
/**
 * Does the STAGED package.json change a dependency-bearing key?
 *
 * Compares the staged blob against HEAD rather than reading the worktree file, so an
 * unstaged edit elsewhere in package.json neither triggers nor suppresses the gate.
 *
 * FAILS CLOSED, alone in this file. Every other guard here fails open, because blocking
 * a commit it cannot reason about is worse than the thing it prevents. This one inverts
 * that: an unreadable or unparseable package.json means gate it, because a missed
 * dependency change is a silently different graph for every other session and for CI,
 * and the cost of a false block is one `--owns "package.json"` lane.
 */
function stagedPackageJsonTouchesDependencies() {
  const stagedBlob = tryGitRaw('show :package.json');
  const headBlob = tryGitRaw('show HEAD:package.json');
  if (!stagedBlob || !headBlob) return true;
  try {
    const a = JSON.parse(stagedBlob);
    const b = JSON.parse(headBlob);
    return DEPENDENCY_KEYS.some((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
  } catch { return true; }
}
// Lockfiles are gated unconditionally — every byte of one IS the resolved graph.
// package.json is gated only when a dependency-bearing key actually moved.
function isGatedDependencyPath(path) {
  if (path === 'package.json') return stagedPackageJsonTouchesDependencies();
  return isDependencyPath(path);
}
function dependencyLane(owns) { return expandOwns(owns).some(isDependencyPath); }
function section(body, heading) { return body.split(heading)[1]?.split('\n## ')[0] || ''; }
function contractIssues(body) {
  const missing = CONTRACT_HEADINGS.filter((heading) => !body.includes(heading));
  if (missing.length) return missing;
  const issues = [];
  if (/TODO:/i.test(body)) issues.push('placeholder content remains');
  if (/\bNot run\b/i.test(section(body, '## Verification'))) issues.push('verification is not recorded');
  if (!/- \[x\] Yes\b/i.test(section(body, '## Ready to ship'))) issues.push('ready-to-ship is not confirmed');
  return issues;
}
function contractState(lane) {
  const path = join(lane.worktree, laneHandoffPath(lane));
  if (!existsSync(path)) return 'MISSING';
  try { return contractIssues(readFileSync(path, 'utf8')).length ? 'DRAFT' : 'READY'; }
  catch { return 'UNREADABLE'; }
}
function contractTemplate({ name, owns }) {
  return `# Lane contract — ${name}\n\n## Objective\n- TODO: state the user-visible outcome and done condition.\n\n## Owned paths\n${owns.map((path) => `- \`${path}\``).join('\n')}\n\n## Touched interfaces\n- TODO: name API, schema, route, component, command, or \`None\`.\n\n## Dependencies & blockers\n- None.\n\n## Verification\n- Not run.\n\n## Ready to ship\n- [ ] No — complete verification and journaling first.\n\n## Known limitations\n- None known.\n\n## Documentation & journaling\n- CHANGELOG: deferred to this lane.\n- DECISIONS: not needed.\n- Audit / vault sync: not needed.\n`;
}
function broadOwnership(owns) {
  return owns.filter((glob) => BROAD_OWNERSHIP_GLOBS.has(glob));
}
// EVERY per-lane path start() injects, in one list. Adding a new one here is all it
// takes to give it the same protection — the guard below and the injection in start()
// both read from this, so the two can never drift apart.
//
// Each entry is a shared DIRECTORY carved into one file per lane. That is the pattern
// that has never collided in this repo: a handoff stopped colliding the moment it
// stopped being a shared file, and changelog.d/decisions.d exist to do the same for the
// two logs every lane wants to append to.
const LANE_OWNED_PATHS = [
  (name) => `docs/handoffs/lane-${name}.md`,
  (name) => `docs/changelog.d/${name}.md`,
  (name) => `docs/decisions.d/${name}.md`,
];
const laneOwnedPaths = (name) => LANE_OWNED_PATHS.map((f) => f(name));
// A sentinel that is NOT a real lane, used to probe whether a declared glob would reach
// some OTHER lane's injected files.
const LANE_PATH_PROBES = laneOwnedPaths('zzz-probe-not-a-real-lane');
// start() adds these to EVERY lane, precisely so a ship record or a journal entry can
// never be an unowned shared-doc edit. That makes their DIRECTORIES the paths a lane
// must never own: owning one collides with every future lane's injected file, and since
// main is inspect-only while any lane is live, BOTH commit routes shut. Lane
// lv1-delegation-class owned `docs/handoffs/` on 2026-08-16 and froze the repo until it
// was parked.
//
// PROBE, don't string-match. Testing each glob against a sentinel path is what makes
// `docs/handoffs/`, `docs/handoffs/**`, `docs/**`, `**` and `docs/handoffs/lane-*.md`
// all fail together. broadOwnership() catches none of them but the literal `docs/**`,
// because it is an exact Set lookup on the RAW glob while ownsFile() matches the
// EXPANDED form — expandOwnsPairs() rewrites a trailing `/` to `/**`. That raw-vs-
// expanded asymmetry is the same defect ownershipConflicts() was fixed for on
// 2026-08-06 (see lib/lanes.mjs); it was never carried across to the ownership guards.
function laneDirectoryGrabs(owns, name) {
  const mine = new Set(laneOwnedPaths(name));
  return owns.filter((glob) => !mine.has(glob) && LANE_PATH_PROBES.some((probe) => ownsFile([glob], probe)));
}
function handoffFailure(lane, here) {
  if (!lane.handoffRequired) return null; // Lanes begun before this rule remain shippable.
  const path = join(here, laneHandoffPath(lane));
  if (!existsSync(path)) {
    return {
      problem: `required lane handoff is missing (${laneHandoffPath(lane)}).`,
      fix: 'restore the generated lane contract, then complete Objective, interfaces, blockers, verification, readiness, limitations, and journaling before shipping.',
    };
  }
  const body = readFileSync(path, 'utf8');
  const issues = contractIssues(body);
  if (issues.length) {
    return {
      problem: `lane contract is incomplete (${issues.join(', ')}).`,
      fix: `complete ${laneHandoffPath(lane)} so the next agent can assess the outcome, owned paths, interfaces, blockers, checks, readiness, limitations, and journal status.`,
    };
  }
  return null;
}

// ── lane:start ───────────────────────────────────────────────────────────────
function start() {
  reapDeadLanes({ log: (m) => console.warn(m) });
  // Refuse to open a NEW lane while an old one has outlived its session. This is the
  // 2026-08-01 failure exactly: four lanes rotting and a fifth being opened on top.
  // Checked before anything is created, and before the name/--owns usage errors, so the
  // overdue lanes are the first thing you see rather than a lecture about globs.
  const overdue = overdueBlockText({ action: 'refusing to open another lane.' });
  if (overdue) { console.error(overdue); process.exit(1); }

  const name = (positionals[0] || '').trim();
  if (!name) die('usage: npm run lane:start <name> --owns "glob,glob"');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) die(`lane name "${name}" must be kebab-case ([a-z0-9-]).`);

  const ownsRaw = flagValue('--owns');
  if (!ownsRaw) die('--owns is required. Declare the globs this lane owns, e.g. --owns "src/components/map/**,src/lib/transit*". Scoping up front is the point.');
  // Split on whitespace AS WELL AS commas. The usage string shows commas, but
  // `--owns "a b c"` is the natural shell form and arrives as ONE argv token; splitting
  // on commas alone stored all three globs as a single space-joined entry that matched
  // nothing, so the lane owned NOTHING (see expandOwns in lib/lanes.mjs). A glob with a
  // literal space in it is not a case this repo has or wants.
  const owns = ownsRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (!owns.length) die('--owns was empty. List at least one glob.');
  // Checked BEFORE the per-lane paths are injected below, so the error is about what the
  // caller actually typed rather than about a path this script added to their list.
  const grabs = laneDirectoryGrabs(owns, name);
  if (grabs.length) {
    die(`a lane may own its own per-lane files, never the directories they live in — refusing ${grabs.join(', ')}.

  Every lane, including every future one, gets these added to its owned paths
  automatically:
${laneOwnedPaths(name).map((p) => `    ${p}`).join('\n')}

  A glob that reaches inside docs/handoffs/, docs/changelog.d/ or docs/decisions.d/
  therefore collides with every lane started after this one, and because the main
  worktree is inspect-only while any lane is live, that shuts BOTH commit routes until
  the lane ships. Lane lv1-delegation-class did exactly this on 2026-08-16.

  You do not need to declare any of them — they are added for you. Own the paths your
  work actually changes instead. To journal, write your fragment to the changelog.d /
  decisions.d file above; it is folded into the real log by node scripts/docs-assemble.mjs.`);
  }
  // Each lane owns its own handoff and its own journal fragments, so a ship record or a
  // CHANGELOG entry is never an unowned shared-doc edit and cannot collide with another
  // lane's. See docs/changelog.d/README.md for why the logs moved to fragments.
  const handoffPath = laneHandoffPath({ name });
  for (const path of laneOwnedPaths(name)) if (!owns.includes(path)) owns.push(path);
  // Dependency manifests and lockfiles are a single atomic coordination surface.
  // A lane that touches one owns all of them, preventing a second agent from
  // silently changing the resolved dependency graph in parallel.
  if (dependencyLane(owns)) {
    for (const path of DEPENDENCY_FILES) if (!owns.includes(path)) owns.push(path);
  }
  const broad = broadOwnership(owns);
  const broadReason = flagValue('--allow-broad')?.trim();
  if (broad.length && !broadReason) {
    die(`broad ownership (${broad.join(', ')}) blocks parallel work. Split it into feature paths, or explicitly justify the exception: --allow-broad "<reason>".`);
  }
  if (broad.length) say(`  note: broad ownership allowed for: ${broad.join(', ')} — ${broadReason}`);
  const writerWarning = writerAdvisory();
  if (writerWarning) say(`  ${writerWarning}`);

  const root = mainRoot();
  // Refuse OVERLAPPING dirt, but never force a new agent to reconcile the shared main
  // checkout before it can become isolated. Dirt elsewhere (e.g. iOS cap-sync churn under
  // ios/** for a lane that owns src/**) isn't a real conflict — report it as an FYI and
  // let the lane start. Reuses the same ownsFile matcher the pre-commit ownership guard
  // and lane:ship preflight already use, so "overlap" means the same thing everywhere.
  git('fetch origin --quiet');
  const dirtyFiles = porcelainPaths(root);
  const overlapping = dirtyFiles.filter((f) => ownsFile(owns, f));
  if (overlapping.length) {
    die(`main worktree (${root}) has ${overlapping.length} dirty file(s) overlapping this lane's globs (${overlapping.slice(0, 4).join(', ')}${overlapping.length > 4 ? '…' : ''}). Commit or discard those before starting a lane that owns these paths.`);
  }
  if (dirtyFiles.length) say(`  note: ${dirtyFiles.length} unrelated dirty file(s) in main worktree, not blocking (outside this lane's globs).`);
  const dev = tryGit('rev-parse dev', { cwd: root });
  const odev = tryGit('rev-parse origin/dev', { cwd: root });
  if (!dev) die('no local dev branch.');
  if (!odev) die('no origin/dev ref after fetch.');

  // Pick a safe immutable base without mutating main:
  //   equal / local-ahead  -> local dev (preserves already-landed local context)
  //   local-behind        -> origin/dev (starts current)
  //   diverged            -> origin/dev (never smuggles an unreconciled main history
  //                          into a new lane; lane:ship already rebases on origin/dev)
  // This is the concurrency boundary: the old code refused here and told the new agent
  // to pull/rebase/push in the shared checkout, keeping every other session blocked while
  // it did coordination work. A lane must be the escape FROM main, not a reward granted
  // only after main is cleanly synchronized.
  const localContainsOrigin = dev === odev || gitSucceeds('merge-base --is-ancestor origin/dev dev', { cwd: root });
  const originContainsLocal = dev !== odev && gitSucceeds('merge-base --is-ancestor dev origin/dev', { cwd: root });
  const baseRef = localContainsOrigin ? 'dev' : 'origin/dev';
  const baseSha = baseRef === 'dev' ? dev : odev;
  if (dev !== odev) {
    const relation = localContainsOrigin ? 'ahead of' : originContainsLocal ? 'behind' : 'diverged from';
    say(`  note: local dev is ${relation} origin/dev; starting from ${baseRef} (${baseSha.slice(0, 8)}) without modifying main.`);
    if (!localContainsOrigin) say('  note: local-only dev commits are not in this lane; lane:ship will reconcile against origin/dev.');
  }

  const lanes = readLanes();
  if (lanes.find((l) => l.name === name)) die(`a lane named "${name}" already exists (npm run lane:status).`);
  const branch = `lane/${name}`;
  if (tryGit(`rev-parse -q --verify refs/heads/${branch}`)) die(`branch ${branch} already exists. Pick another name or clean it up.`);

  // Addition B: refuse OVERLAPPING ownership at start — cheapest place to catch it.
  const conflicts = ownershipConflicts(owns, lanes);
  if (conflicts.length) {
    console.error('✗ ownership conflict — another live lane already owns overlapping paths:');
    for (const c of conflicts) console.error(`    "${c.requested}"  overlaps  lane "${c.lane}" (owns "${c.owned}")`);
    console.error('  Re-scope so the two lanes own disjoint paths, or coordinate with that lane first.');
    process.exit(1);
  }

  const worktree = join(dirname(root), 'dc-lanes', name); // ../dc-lanes/<name> — OUTSIDE the repo, never nested
  say(`→ creating branch ${branch} off ${baseRef} and worktree at ${worktree}…`);
  git(`branch ${branch} ${baseRef}`, { cwd: root });
  sh(`git worktree add "${worktree}" ${branch}`, { cwd: root });

  // A fresh worktree has no node_modules or .env* (both gitignored). Link them from the
  // main worktree so the in-lane gates (typecheck/test/build) actually run.
  //
  // This used to be best-effort-and-silent, which on Windows meant silently BROKEN:
  // creating a symlink there needs Developer Mode or elevation, so the calls threw, the
  // empty catch swallowed it, and the lane came up with no node_modules at all. The
  // first thing to touch it was the lane's own pre-commit hook, which died on
  // `Cannot find package 'minimatch'` — a failure with nothing in it pointing back here.
  //
  // A directory JUNCTION is the fix: it needs no elevation, and node resolves modules
  // through it exactly like a symlink. Copy is the last resort for the tiny .env files.
  const linkFailures = [];
  if (!existsSync(join(worktree, 'node_modules'))) {
    if (!linkDir(join(root, 'node_modules'), join(worktree, 'node_modules'))) {
      linkFailures.push('node_modules');
    }
  }
  for (const f of ['.env', '.env.local', '.env.e2e']) {
    const src = join(root, f);
    if (!existsSync(src) || existsSync(join(worktree, f))) continue;
    try { symlinkSync(src, join(worktree, f), 'file'); }
    catch { try { copyFileSync(src, join(worktree, f)); } catch { linkFailures.push(f); } }
  }
  // Never silent: a lane missing these looks fine until a gate fails for an unrelated-
  // sounding reason.
  if (linkFailures.length) {
    console.warn(`⚠️  could not link into the lane worktree: ${linkFailures.join(', ')}`);
    console.warn(`   The in-lane gates and hooks will fail until you provide them at ${worktree}.`);
    if (linkFailures.includes('node_modules')) console.warn('   Fix: run `npm install` in the lane worktree.');
  }

  const now = new Date().toISOString();
  lanes.push({
    name, branch, worktree, owns, baseRef, baseSha, localDevAtStart: dev, originDevAtStart: odev,
    ...(() => { const a = sessionAnchor(); return { pid: a.pid, anchorResolved: a.resolved }; })(),
    agentSession: process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_AGENT_SESSION || null,
    handoffRequired: true,
    ...(broad.length ? { broadOwnership: { globs: broad, reason: broadReason } } : {}),
    startedAt: now, lastActive: now, status: 'live',
  });
  writeLanes(lanes);
  // The contract exists from the instant a lane exists. Agents fill it in as
  // they learn, rather than remembering an undocumented file at ship time.
  writeFileSync(join(worktree, handoffPath), contractTemplate({ name, owns }));

  say('');
  say(`✓ lane "${name}" started.`);
  say(`  cd ${worktree}`);
  say('');
  say('  Lane rules:');
  say(`    · You own: ${owns.join(', ')}`);
  if (dependencyLane(owns)) say('    · Dependency lane: package manifests and lockfiles are exclusively reserved for this lane.');
  say('    · Edit only inside this worktree. Commit with `git add -A` freely — you\'re isolated.');
  say('    · Staging a file another live lane owns is BLOCKED at commit time.');
  say('    · Ship the SAME session: npm run lane:ship  (merges to dev, runs gates in-lane).');
  say(`    · Before shipping, complete ${laneHandoffPath({ name })} (outcome, interfaces, blockers, checks, readiness, limitations, journal status).`);
  say('    · Bail without merging: npm run lane:abandon (salvages your work to a pushed tag).');
  say(`    · Never stash. Never leave the lane open overnight: >8h flags STALE, >${human(OVERDUE_LANE_MS)} is OVERDUE and REFUSES lane:start + session:begin`);
  say('      until you ship, abandon, or `npm run lane:defer <name> --reason "…"` (bounded, recorded).');
}

// ── lane:status ──────────────────────────────────────────────────────────────
function status() {
  reapDeadLanes({ log: (m) => console.warn(m) });
  // Fetch before the empty-registry return. Previously a no-lane session never
  // refreshed origin/dev, which made the reassuring status output stale.
  try { sh('node scripts/remote-awareness.mjs check --quiet'); }
  catch { console.warn('⚠️  remote check failed; lane status below may use stale remote refs.'); }
  const lanes = readLanes();
  if (!lanes.length) { say('· no live lanes. Start one:  npm run lane:start <name> --owns "glob,…"'); return; }
  const live = lanes.filter((l) => laneIsLive(l));
  const parked = lanes.filter((l) => !laneIsLive(l));
  say(`LANES (${live.length} live, ${parked.length} parked)`);
  for (const l of lanes) {
    const age = ageMs(l.startedAt);
    const parkedNow = l.status === 'parked';
    const inactive = !parkedNow && laneInactive(l);   // live status but agent looks gone
    const stale = age > STALE_LANE_MS;
    const overdue = laneOverdue(l);
    const deferred = deferralActive(l);
    const ahead = tryGit(`rev-list --count origin/dev..${l.branch}`) || '?';
    const wtOk = existsSync(l.worktree);
    const dirty = wtOk ? (tryGit('status --porcelain', { cwd: l.worktree }) ? 'dirty' : 'clean') : 'NO WORKTREE';
    const glyph = parkedNow ? '⏸' : inactive ? '☾' : '●';
    const tags = [];
    if (parkedNow) tags.push(l.parkedReason === 'inactive' ? '⏸ PARKED (auto, inactive — ownership released)' : '⏸ PARKED (ownership released)');
    else if (inactive) tags.push(`☾ INACTIVE (pid gone or idle >${human(LANE_INACTIVE_MS)} — ownership NOT enforced; run any lane cmd to re-claim)`);
    else if (stale) tags.push('⏰ STALE >8h');
    // OVERDUE is independent of the park/inactive chain above on purpose — a rotting lane
    // is almost always already parked, and that is exactly when it must stay visible.
    if (overdue) tags.push(deferred ? `⏳ OVERDUE (deferred)` : `⏳ OVERDUE >${human(OVERDUE_LANE_MS)} — blocks lane:start + session:begin`);
    say('');
    say(`  ${glyph} ${l.name}${tags.length ? '   ' + tags.join('  ') : ''}`);
    say(`      branch ${l.branch}  ·  ${human(age)} old  ·  active ${human(inactiveMs(l))} ago  ·  pid ${l.pid}${pidAlive(l.pid) ? '' : ' (gone)'}  ·  ${dirty}  ·  ${ahead} commit(s) ahead of dev${dependencyLane(l.owns || []) ? '  ·  DEPENDENCIES EXCLUSIVE' : ''}  ·  CONTRACT ${contractState(l)}`);
    say(`      owns: ${(l.owns || []).join(', ')}${laneIsLive(l) ? '' : '  (not enforced)'}`);
    say(`      at ${l.worktree}`);
    if (l.deferral) {
      const d = l.deferral;
      say(`      deferrals: ${d.count}×  ·  ${deferred ? `active, expires in ${human(new Date(d.until).getTime() - Date.now())}` : `EXPIRED ${human(ageMs(d.until))} ago`}  ·  "${d.reason}"`);
    }
  }
  say('');
  const overdueNow = overdueBlockText({ lanes, action: 'lane:start and session:begin are refusing until each is shipped, abandoned, or deferred.' });
  if (overdueNow) { say(overdueNow); say(''); }
  if (parked.length) say('  resume a parked lane:  npm run lane:resume <name>   ·   park a live one:  npm run lane:park <name>');
  say('  ship a lane:  cd <path> && npm run lane:ship   ·   see a diff:  npm run lane:diff <name>');
}

// ── CI gate for ship (warn on unknown, refuse only on definitively red) ───────
// Returns null when green/unknown (OK to proceed), or a failure string when
// definitively red. Never throws — the caller aggregates it with other preconditions.
// Reads the trunk gate workflow only: the newest run on dev from ANY workflow can be
// a stale manual dispatch (e.g. an audit) that says nothing about trunk health.
function ciRedReason() {
  let out = '';
  try { out = execSync('gh run list --workflow ci-dev-push.yml --branch dev --limit 1 --json status,conclusion', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { say('⚠️  could not query CI (gh unavailable) — proceeding on the local gates.'); return null; }
  let arr = []; try { arr = JSON.parse(out); } catch { /* ignore */ }
  if (!arr.length) { say('⚠️  no CI run found for dev — proceeding on local gates.'); return null; }
  const { status: st, conclusion } = arr[0];
  if (st !== 'completed') { say(`⚠️  latest dev CI is "${st}" (not finished) — proceeding on local gates.`); return null; }
  if (conclusion === 'success') return null;
  return `origin/dev CI is "${conclusion}" — refusing to pile onto a red trunk.`;
}

// True if a rebase or merge is mid-flight in the worktree rooted at `cwd`.
function opInProgress(cwd) {
  for (const p of ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD']) {
    const path = tryGit(`rev-parse --git-path ${p}`, { cwd });
    if (path && existsSync(resolve(cwd, path))) return p;
  }
  return null;
}
// A stale index.lock in the worktree rooted at `cwd` (a crashed git leaves it behind
// and every subsequent git write fails cryptically).
function staleIndexLock(cwd) {
  const path = tryGit('rev-parse --git-path index.lock', { cwd });
  return path && existsSync(resolve(cwd, path)) ? resolve(cwd, path) : null;
}
// The dev live-reload server.url leaked into the iOS capacitor config (must never ship).
function iosLiveReloadUrl(worktreeRoot) {
  const f = join(worktreeRoot, 'ios/App/App/capacitor.config.json');
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8'))?.server?.url || null; } catch { return null; }
}

// Check EVERY external precondition up front and report ALL failures at once, each with
// the exact fix — BEFORE paying ~40s of typecheck+test+build to discover a one-file
// `git add`. Returns an array of { problem, fix } (empty ⇒ clear to run gates).
function shipPreflight(lane, here, root) {
  const fails = [];
  tryGit('fetch origin --quiet', { cwd: here });   // best-effort; the merge step fetches again

  const handoff = handoffFailure(lane, here);
  if (handoff) fails.push(handoff);

  // 1. Lane worktree must be committed (the salvage/merge assume a clean tree).
  const laneDirty = porcelainPaths(here);
  if (laneDirty.length) {
    fails.push({
      problem: `lane worktree is dirty (${laneDirty.length} file(s): ${laneDirty.slice(0, 4).join(', ')}${laneDirty.length > 4 ? '…' : ''}).`,
      fix: `commit them in the lane (never stash):  git -C "${here}" add -A && git -C "${here}" commit -m "…"`,
    });
  }

  // 2. Main worktree must be a clean dev preview to receive the merge.
  const mHead = tryGit('symbolic-ref --short HEAD', { cwd: root });
  if (mHead !== 'dev') {
    fails.push({ problem: `main worktree (${root}) is on "${mHead}", not dev.`, fix: `git -C "${root}" checkout dev` });
  }
  const mainDirty = porcelainPaths(root);
  if (mainDirty.length) {
    const files = mainDirty;
    // DEADLOCK EXCEPTION: if the main worktree is dirty ONLY with files THIS lane owns,
    // that's not a real conflict — it's the 2026-07-22 deadlock (the lane owns docs/**,
    // main has an uncommitted docs/ file, ship refuses on "main dirty", the guard refuses
    // the commit on "owned by this lane"). Name it as such and give the escape, rather
    // than the old misleading "commit or discard".
    const allOwnedBySelf = files.length > 0 && files.every((f) => ownsFile(lane.owns, f));
    if (allOwnedBySelf) {
      fails.push({
        problem: `main worktree is dirty, but ONLY with files lane "${lane.name}" owns (${files.slice(0, 4).join(', ')}${files.length > 4 ? '…' : ''}) — this is the ownership deadlock, not a conflict.`,
        fix: `park this lane so the guard lets you commit those in main, then re-ship:  npm run lane:park ${lane.name} && git -C "${root}" add ${files.map((f) => `"${f}"`).join(' ')} && git -C "${root}" commit -m "…" && npm run lane:resume ${lane.name}`,
      });
    } else {
      const writerNote = writerAdvisory('Also:');
      fails.push({
        problem: `main worktree (${root}) is dirty (${files.slice(0, 4).join(', ')}${files.length > 4 ? '…' : ''}) — this lane cannot safely merge over another writer's work.${writerNote ? ` ${writerNote}` : ''}`,
        fix: 'do not repeatedly commit a live writer. Let that session finish or close it, preserve its final WIP with one explicit commit, wait for dev CI if needed, then re-ship.',
      });
    }
  }

  // 3. No rebase/merge mid-flight in either worktree.
  for (const [where, cwd] of [['lane', here], ['main', root]]) {
    const op = opInProgress(cwd);
    if (op) fails.push({ problem: `a git operation (${op}) is in progress in the ${where} worktree.`, fix: `finish or abort it:  git -C "${cwd}" ${op.startsWith('rebase') ? 'rebase --abort' : 'merge --abort'}` });
    const lock = staleIndexLock(cwd);
    if (lock) fails.push({ problem: `a stale index.lock is present in the ${where} worktree.`, fix: `remove it (ensure no git is running):  rm -f "${lock}"` });
  }

  // 4. No dev live-reload URL leaked into the iOS capacitor config.
  const url = iosLiveReloadUrl(here);
  if (url) fails.push({ problem: `iOS dev live-reload URL is present in capacitor.config.json (server.url = "${url}").`, fix: `strip it:  npm run ios:reset` });

  // 5. origin/dev CI must not be definitively red.
  //    RED-TRUNK EXEMPTION (2026-10-29): a newly published advisory turns the npm-audit
  //    ratchet red with no commit at fault, and the fix (a lockfile) may only be staged
  //    from a dependency lane, so without this the fix for a red trunk could never ship.
  //    Narrow on purpose: only a dependency lane, and only when its OWN tree passes the
  //    ratchet. Any other red still refuses, and the full gate set still runs.
  const ci = ciRedReason();
  if (ci && dependencyLane(lane.owns || [])) {
    const audit = spawnSync('npm', ['run', '-s', 'audit:deps'], { cwd: here, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (audit.status === 0) say(`⚠️  origin/dev CI is red. Proceeding: this dependency lane passes audit:deps in its own tree, so it is the fix for an advisory-red trunk.`);
    else fails.push({ problem: `${ci} This dependency lane does not pass audit:deps either, so it is not the fix.`, fix: `npm run audit:deps in the lane until it passes, then re-ship.` });
  } else if (ci) fails.push({ problem: ci, fix: `fix dev's CI first (the red trunk is the bug), then re-ship. If the red is a new npm advisory, ship the lockfile fix from a dependency lane.` });

  return fails;
}

function closeLaneHandoff(lane, here) {
  if (!lane.handoffRequired) return;
  const path = laneHandoffPath(lane);
  sh(`git rm -- "${path}"`, { cwd: here });
  sh(`git commit -m "docs(handoff): close lane ${lane.name}"`, { cwd: here });
  say(`→ closed ${path} in the lane; its final state remains in the lane history.`);
}

// ── lane:ship ────────────────────────────────────────────────────────────────
function ship() {
  // Heartbeat BEFORE the sweep — same ordering trap as checkStaged(). `touchLane` used
  // to run four lines below `reapDeadLanes`, so a lane idle >90m was parked on the way
  // in and then died on the "lane is parked" check immediately after: shipping a lane
  // was impossible precisely when the session had been long enough to produce one.
  const here = tryGit('rev-parse --show-toplevel');
  touchLaneForWorktree(here);
  reapDeadLanes({ log: (m) => console.warn(m) });
  const lanes = readLanes();
  const lane = laneForPath(here, lanes);
  if (!lane) die('lane:ship must run from INSIDE a lane worktree. cd into ../dc-lanes/<name> first.');
  touchLane(lane.name);
  if (lane.status === 'parked') die(`lane "${lane.name}" is parked (ownership released). Resume it before shipping: npm run lane:resume ${lane.name}`);

  const root = mainRoot();
  // Preflight: check ALL external preconditions BEFORE spending ~40s of gates, and
  // report every failure at once with its exact fix.
  say('→ preflight (external preconditions)…');
  const fails = shipPreflight(lane, here, root);
  if (fails.length) {
    console.error('');
    console.error(`✗ lane:ship blocked — ${fails.length} precondition(s) not met (nothing ran, nothing merged):`);
    fails.forEach((f, i) => { console.error(`\n  ${i + 1}. ${f.problem}`); console.error(`     fix: ${f.fix}`); });
    console.error('\n  Resolve all of the above, then re-ship. (Gates were NOT run — this is the cheap check.)');
    process.exit(1);
  }
  say('  preflight ✓ — all external preconditions met.');

  const lock = acquireShipLock(lane.name);
  if (!lock.ok) {
    const h = lock.holder;
    die(`lane "${h?.lane}" is shipping right now (pid ${h?.pid}, ${human(ageMs(h?.iso))} ago). Retry in a moment — the ship step is serialized so two merges can't race the same index.`);
  }
  if (lock.stole) console.warn(`⚠️  stole a stale ship lock from "${lock.stole.lane}" (pid ${lock.stole.pid}, ${human(ageMs(lock.stole.iso))} old).`);

  try {
    // NOTE: the handoff is NOT closed here. It used to be, and that made every gate
    // failure unrecoverable-looking: the close commit deleted docs/handoffs/lane-<name>.md
    // before the gates ran, so a failing gate left the contract deleted and the NEXT ship
    // attempt was refused by its own preflight ("required lane handoff is missing") — a
    // ship that fails once cannot simply be retried. Closing is now the last step before
    // the merge, after every gate has passed. See closeLaneHandoff's call site below.

    say('→ fetching origin…');
    git('fetch origin --quiet');

    // In-lane green is NOT evidence of dev green: a lane's gates run against its
    // MERGE BASE, and dev moves underneath it. Twice on 2026-07-31 a lane passed
    // every gate in-lane and turned dev red on merge (lint:primitives against a
    // merge base predating 341ab000; docs:check in release-defect-cleanup, fixed
    // after the fact in d27bfed2) — both caught by a person, not a gate. So: rebase
    // onto origin/dev's TIP first, say so out loud, and only then run the gates, so
    // what they measure is the post-merge tree rather than a stale ancestor.
    const odev = tryGit('rev-parse origin/dev', { cwd: here });
    const mergeBase = tryGit(`merge-base ${lane.branch} origin/dev`, { cwd: here });
    const rebased = mergeBase !== odev;
    if (rebased) {
      const behind = tryGit(`rev-list --count ${mergeBase}..${odev}`, { cwd: here }) || '?';
      say('');
      say(`→ REBASE REQUIRED: this lane's merge base is ${behind} commit(s) behind origin/dev.`);
      say(`    merge base   ${mergeBase.slice(0, 8)}`);
      say(`    origin/dev   ${odev.slice(0, 8)}`);
      say(`  Rebasing ${lane.branch} onto origin/dev so the gates below measure the MERGED tree,`);
      say('  not a stale ancestor. In-lane green against an old base is not evidence of dev green.');
      say('');
    } else {
      say(`→ lane is already based on origin/dev's tip (${odev.slice(0, 8)}) — no rebase needed.`);
    }
    try { sh('git rebase origin/dev', { cwd: here }); }
    catch {
      tryGit('rebase --abort', { cwd: here });
      throw new Error(
        `rebase onto origin/dev hit conflicts — the rebase was ABORTED and lane "${lane.name}" is exactly as it was (nothing merged, nothing lost).\n`
        + '  This is resolved by hand, never automatically. Either resolve the conflicts in the lane and re-ship,\n'
        + `  or step out of the way while you sort it out:  npm run lane:park ${lane.name}  (resume with lane:resume ${lane.name}).`,
      );
    }

    const base = tryGit('rev-parse origin/dev', { cwd: here });
    const laneTip = tryGit(`rev-parse ${lane.branch}`, { cwd: here });
    const shipped = gLines(`log --oneline ${base}..${laneTip}`, { cwd: here });
    if (!shipped.length) throw new Error(`lane "${lane.name}" has no commits beyond origin/dev — nothing to ship.`);

    // The blocking gate set from .github/workflows/ci-dev-push.yml, minus a named
    // exemption list. Do NOT trust this sentence: `check:gate-parity` (the FIRST gate
    // below) verifies it mechanically on every ship and every push, because the last
    // version of this comment asserted parity and was false when written — which is how
    // TS2578 reached dev on 2026-08-02 via lane/migration-divergence.
    //
    // Adding a gate here means adding it to BOTH:
    //   · the CI workflow (or check:gate-parity fails: a lane gate the trunk doesn't need)
    //   · GATE_SCRIPTS in src/test/laneShipRebase.test.ts (or its stub repo lacks the
    //     script and every ship test fails for an unrelated reason)
    // The one deliberate exemption is `audit:deps` — it hits the npm registry, and
    // lane:ship stays hermetic. Reason lives in EXEMPT in scripts/check-gate-parity.mjs.
    //
    // Deliberately NOT raw `tsc -b`: that carries a ~112-error baseline on dev and is
    // non-blocking in CI, so gating on it would refuse every ship.
    // Ordered cheap→expensive so a failure short-circuits before the slow build.
    const GATES = [
      ['check:gate-parity', 'npm run check:gate-parity'],
      ['check:package-overrides', 'npm run check:package-overrides'],
      // Added 2026-08-16. Lived only in migration-guard.yml, which runs AFTER the
      // merge — so a lane could ship an RLS migration with no probe and red the
      // trunk, which is exactly what 20260925000000 did. Invoked as a bare `node`
      // rather than an npm script on purpose: check-gate-parity.mjs now compares
      // gate COMMANDS, not npm script names, so a CI gate that is not an npm script
      // is no longer invisible to it.
      ['check:rls-coverage', 'node scripts/check-rls-test-coverage.mjs'],
      // Added 2026-08-17. Static half of the test:migration-replay invariant: the
      // replay-safe chk_content_type list in 20260731040000 must equal the authorized
      // set in supabase/tests/content_type_check_drift.test.sql. The live harness
      // needs Docker and a Supabase stack and runs in no workflow, which is how that
      // list stayed rotted for three weeks — this is the part a lane can actually
      // fail. See scripts/check-content-type-replay-set.mjs.
      ['check:content-type-replay-set', 'node scripts/check-content-type-replay-set.mjs'],
      ['i18n:verify', 'npm run i18n:verify'],
      ['lint:colors', 'npm run lint:colors'],
      ['lint:glyphs', 'npm run lint:glyphs'],
      ['lint:primitives', 'npm run lint:primitives'],
      ['lint:widths', 'npm run lint:widths'],
      ['docs:check', 'npm run docs:check'],
      ['typecheck:crash', 'npm run typecheck:crash'],
      // Added 2026-08-02. lane/migration-divergence passed all eight gates above,
      // merged, and turned dev red on TS2578 (an unused @ts-expect-error) — caught
      // only by CI's "Type check ratchet (blocking)" step, which this list did not
      // run.
      ['typecheck:ratchet', 'npm run typecheck:ratchet'],
      ['lint:a11y', 'npm run lint:a11y'],
      ['lint', 'npm run lint'],
      ['test', 'npm run test'],
      ['build', 'npm run build'],
      // guard:csp scans dist/, so it must run AFTER build — the one gate whose position
      // is a correctness constraint, not a cost ordering.
      ['guard:csp', 'npm run guard:csp'],
      // Also scans dist/, so it also has to sit after build. Proves the dev-only
      // /__variants + TweaksPanel graph did not ship (scripts/check-dev-only-excluded.mjs).
      ['guard:dev-only', 'npm run guard:dev-only'],
    ];
    for (const [label, c] of GATES) {
      say(`→ ${label} (in lane, rebased onto origin/dev)…`);
      try { sh(c, { cwd: here }); }
      catch {
        throw new Error(
          `${label} FAILED in lane "${lane.name}" AFTER rebasing onto origin/dev. Nothing merged.\n`
          + (rebased
            ? `  This ran against origin/dev's tip (${odev.slice(0, 8)}), NOT this lane's original merge base (${mergeBase.slice(0, 8)}).\n`
              + '  If this gate passed before the rebase, the conflict is with work that landed on dev while this lane\n'
              + '  was open — a MERGE-BASE issue, not a regression in your own commits. Fix it here; that is the point\n'
              + '  of this check. Merging anyway would turn dev red.'
            : '  The lane was already on origin/dev\'s tip, so this is a genuine failure in the lane\'s own changes.'),
        );
      }
    }

    // Gates can take long enough for another machine to advance dev underneath
    // this lane. Refuse that stale-green result and let the next ship invocation
    // rebase and rerun against the new tip. The handoff is deliberately still open.
    say('→ re-checking origin/dev after gates…');
    git('fetch origin --quiet', { cwd: here });
    const postGateDev = tryGit('rev-parse origin/dev', { cwd: here });
    if (postGateDev !== base) {
      const movedBy = tryGit(`rev-list --count ${base}..${postGateDev}`, { cwd: here }) || '?';
      throw new Error(
        `origin/dev advanced ${movedBy} commit(s) while this lane's gates were running `
        + `(${base.slice(0, 8)} -> ${postGateDev.slice(0, 8)}). Nothing merged. `
        + 'Run npm run lane:ship again to rebase and verify the current trunk.',
      );
    }

    // Every gate has passed. Only now is the handoff closed, so that a gate failure
    // above leaves the lane exactly as it was and the ship can simply be re-run.
    // Deleting a handoff cannot break a gate: no gate reads docs/handoffs/**.
    closeLaneHandoff(lane, here);
    // …which adds a commit, so the tip used for the merge and the archive tag must be
    // re-read. Using the pre-close value would merge a tree that still contains the
    // handoff and tag a commit that is no longer the branch tip.
    const shipTip = tryGit(`rev-parse ${lane.branch}`, { cwd: here });
    const shippedFinal = gLines(`log --oneline ${base}..${shipTip}`, { cwd: here });

    // Merge in the MAIN worktree — re-verify it's still a clean dev preview (the
    // preflight ran ~40s ago, before the gates; guard against drift since then).
    const mHead = tryGit('symbolic-ref --short HEAD', { cwd: root });
    if (mHead !== 'dev') throw new Error(`main worktree (${root}) is on "${mHead}", not dev — it must be a clean dev preview to receive the merge.`);
    if (tryGit('status --porcelain', { cwd: root })) throw new Error(`main worktree (${root}) went dirty since preflight — commit or set aside there, then re-ship.`);
    git('fetch origin --quiet', { cwd: root });
    if (tryGit('rev-parse dev', { cwd: root }) !== tryGit('rev-parse origin/dev', { cwd: root })) {
      say('→ fast-forwarding main worktree dev → origin/dev…');
      try { sh('git merge --ff-only origin/dev', { cwd: root }); }
      catch { throw new Error('main worktree dev is not fast-forwardable to origin/dev. Reconcile by hand.'); }
    }

    say(`→ merging ${lane.branch} → dev (no-ff) in ${root}…`);
    sh(`git merge --no-ff ${lane.branch} -m "Merge ${lane.branch} into dev"`, { cwd: root });
    sh('git push origin dev', { cwd: root });

    // Archive tag BEFORE deleting the branch — recoverable forever.
    const tag = `archive/lane-${lane.name}`;
    if (!tryGit(`rev-parse -q --verify refs/tags/${tag}`)) {
      git(`tag ${tag} ${shipTip}`, { cwd: root });
      try { sh(`git push origin ${tag}`, { cwd: root }); }
      catch { tryGit(`tag -d ${tag}`, { cwd: root }); throw new Error(`could not push ${tag} — refusing to delete an un-backed-up lane.`); }
    }

    // Remove the worktree (we're standing in it → chdir to root first) + branch + deregister.
    process.chdir(root);
    tryGit(`worktree remove --force "${here}"`, { cwd: root });
    tryGit(`branch -D ${lane.branch}`, { cwd: root });
    if (tryGit(`ls-remote --heads origin ${lane.branch}`, { cwd: root })) tryGit(`push origin --delete ${lane.branch}`, { cwd: root });
    writeLanes(readLanes().filter((l) => l.name !== lane.name));

    say('');
    say(`✓ shipped lane "${lane.name}" → dev (${shippedFinal.length} commit(s)).`);
    for (const c of shippedFinal) say(`    ${c}`);
    say(`  archive tag: ${tag} (pushed). Recover any time: git checkout ${tag}`);
    say(`  worktree removed, branch ${lane.branch} deleted (local${tryGit(`ls-remote --heads origin ${lane.branch}`, { cwd: root }) ? '' : ' + remote'}).`);
  } finally {
    releaseShipLock();
  }
}

// ── lane:abandon ─────────────────────────────────────────────────────────────
function abandon() {
  reapDeadLanes({ log: (m) => console.warn(m) });
  const lanes = readLanes();
  const here = tryGit('rev-parse --show-toplevel');
  const lane = laneForPath(here, lanes);
  if (!lane) die('lane:abandon must run from INSIDE a lane worktree.');

  // Commit any dirt so the salvage tag captures EVERYTHING (never lose work).
  if (tryGit('status --porcelain', { cwd: here })) {
    tryGit('add -A', { cwd: here });
    tryGit(`commit --no-verify -m "wip: abandon lane ${lane.name}"`, { cwd: here });
    say('· committed your dirty tree so nothing is lost.');
  }
  const laneTip = tryGit(`rev-parse ${lane.branch}`, { cwd: here });
  const root = mainRoot();
  const tag = `salvage/lane-${lane.name}`;
  if (!tryGit(`rev-parse -q --verify refs/tags/${tag}`)) {
    git(`tag ${tag} ${laneTip}`, { cwd: root });
    try { sh(`git push origin ${tag}`, { cwd: root }); }
    catch { tryGit(`tag -d ${tag}`, { cwd: root }); die(`could not push ${tag} — refusing to delete un-backed-up work.`); }
  }
  process.chdir(root);
  tryGit(`worktree remove --force "${here}"`, { cwd: root });
  tryGit(`branch -D ${lane.branch}`, { cwd: root });
  if (tryGit(`ls-remote --heads origin ${lane.branch}`, { cwd: root })) tryGit(`push origin --delete ${lane.branch}`, { cwd: root });
  writeLanes(readLanes().filter((l) => l.name !== lane.name));

  say('');
  say(`✓ abandoned lane "${lane.name}" — NOT merged.`);
  say(`  work salvaged to ${tag} (pushed). Recover: git checkout ${tag}`);
}

// Resolve a lane by explicit name arg, else by the worktree we're standing in.
function resolveLane(lanes, verb) {
  const name = positionals[0];
  const lane = name
    ? lanes.find((l) => l.name === name)
    : laneForPath(tryGit('rev-parse --show-toplevel'), lanes);
  if (!lane) {
    die(name
      ? `no lane named "${name}" (npm run lane:status).`
      : `run ${verb} from inside a lane worktree, or name one: npm run lane:${verb} <name>`);
  }
  return lane;
}

// ── lane:defer ───────────────────────────────────────────────────────────────
// The only non-terminal way past OVERDUE. It changes NOTHING about the lane's work,
// ownership, branch, or commits — it records a reasoned, expiring acknowledgement that
// this lane is knowingly staying open, and clears the lane:start / session:begin block
// for that window only. The reason is mandatory and lands in the lane contract, so the
// justification survives the session that made it (agents share no memory but the repo).
function defer() {
  const lanes = readLanes();
  const lane = resolveLane(lanes, 'defer');
  const reason = (flagValue('--reason') || '').trim();
  if (reason.length < 10) {
    die('--reason is required and must be a real sentence: npm run lane:defer <name> --reason "blocked on the vendor SDK review; resuming Monday". A deferral with no reason is a snooze button.');
  }
  const maxHours = LANE_DEFER_MAX_MS / 3600000;
  const askedHours = Number(flagValue('--hours') || maxHours);
  if (!Number.isFinite(askedHours) || askedHours <= 0) die(`--hours must be a positive number (max ${maxHours}).`);
  const hours = Math.min(askedHours, maxHours);
  if (hours < askedHours) say(`  note: clamped to the ${maxHours}h maximum deferral window.`);

  const now = new Date();
  const until = new Date(now.getTime() + hours * 3600000);
  const count = (lane.deferral?.count || 0) + 1;
  lane.deferral = { reason, at: now.toISOString(), until: until.toISOString(), count, hours };
  writeLanes(lanes);

  // Record it in the lane contract too. The registry lives in .git and is invisible to
  // review; the contract is the document a human or the next agent actually reads.
  const contract = join(lane.worktree, laneHandoffPath(lane));
  if (existsSync(contract)) {
    try {
      const body = readFileSync(contract, 'utf8').replace(/\n+$/, '');
      const entry = `- ${now.toISOString()} — deferral #${count}, ${hours}h (expires ${until.toISOString()}): ${reason}`;
      const next = body.includes('## Deferrals')
        ? body.replace(/## Deferrals\n/, `## Deferrals\n${entry}\n`)
        : `${body}\n\n## Deferrals\n${entry}\n`;
      writeFileSync(contract, next + '\n');
      say(`  recorded in ${laneHandoffPath(lane)} (commit it in the lane).`);
    } catch (e) { console.warn(`⚠️  could not write the deferral into the lane contract (${e.message}) — it is still recorded in the lane registry.`); }
  } else {
    console.warn(`⚠️  no lane contract at ${contract} — the deferral is recorded in the lane registry only.`);
  }

  say(`✓ lane "${lane.name}" deferred for ${hours}h (until ${until.toISOString()}), deferral #${count}.`);
  say(`  reason: ${reason}`);
  say('  Nothing was shipped, parked, or lost. When this expires, lane:start and session:begin block again.');
  if (count >= 3) say(`  ⚠  this lane has now been deferred ${count} times. That is a signal — ship it, or abandon it and re-open a fresh lane when the blocker clears.`);
}

// ── lane:park ────────────────────────────────────────────────────────────────
// Release a lane's --owns ownership WITHOUT shipping or abandoning. Preserves the
// branch, the worktree, and every commit — the only change is status → parked, which
// makes the lane stop being enforced (laneIsLive is false for a parked lane). This is
// the escape hatch the 2026-07-22 deadlock lacked: a lane blocked on external work can
// step out of the way of sibling commits and be resumed later with no work lost.
function park() {
  const lanes = readLanes();
  const lane = resolveLane(lanes, 'park');
  if (lane.status === 'parked') { say(`· lane "${lane.name}" is already parked (ownership released).`); return; }
  lane.status = 'parked';
  lane.parkedReason = 'manual';
  lane.lastActive = new Date().toISOString();
  writeLanes(lanes);
  say('');
  say(`✓ parked lane "${lane.name}" — ownership RELEASED, nothing shipped, nothing lost.`);
  say(`  branch ${lane.branch} + worktree kept at ${lane.worktree}.`);
  say(`  previously owned: ${(lane.owns || []).join(', ')}  (no longer enforced)`);
  say(`  Other sessions can now commit those paths. Resume any time: npm run lane:resume ${lane.name}`);
}

// ── lane:resume ──────────────────────────────────────────────────────────────
// Re-claim a parked lane's ownership. Refuses only if another LIVE lane started owning
// overlapping paths while this one was parked — in which case the two must be re-scoped,
// exactly as at lane:start. On success the same --owns set is restored verbatim.
function resume() {
  const lanes = readLanes();
  const lane = resolveLane(lanes, 'resume');
  if (lane.status !== 'parked') { say(`· lane "${lane.name}" is already live (ownership enforced). Nothing to resume.`); touchLane(lane.name); return; }
  const conflicts = ownershipConflicts(lane.owns || [], lanes, lane.name);
  if (conflicts.length) {
    console.error(`✗ cannot resume "${lane.name}" — another live lane now owns overlapping paths:`);
    for (const c of conflicts) console.error(`    "${c.requested}"  overlaps  lane "${c.lane}" (owns "${c.owned}")`);
    console.error('  Coordinate or re-scope, then resume. The lane stays parked (no work touched).');
    process.exit(1);
  }
  lane.status = 'live';
  delete lane.parkedReason;
  const anchor = sessionAnchor();  // re-anchor to THIS session — the one re-claiming it
  lane.pid = anchor.pid;
  lane.anchorResolved = anchor.resolved;
  lane.agentSession = process.env.CLAUDE_SESSION_ID || process.env.CLAUDE_AGENT_SESSION || lane.agentSession || null;
  lane.lastActive = new Date().toISOString();
  writeLanes(lanes);
  say('');
  say(`✓ resumed lane "${lane.name}" — ownership RESTORED.`);
  say(`  owns: ${(lane.owns || []).join(', ')}`);
  say(`  cd ${lane.worktree}  and carry on. Ship the same session: npm run lane:ship`);
}

// ── lane:diff ────────────────────────────────────────────────────────────────
function diff() {
  const lanes = readLanes();
  const name = positionals[0];
  const lane = name ? lanes.find((l) => l.name === name) : laneForPath(tryGit('rev-parse --show-toplevel'), lanes);
  if (!lane) die(name ? `no lane named "${name}" (npm run lane:status).` : 'run inside a lane, or pass a name: npm run lane:diff <name>');
  const range = `origin/dev...${lane.branch}`;
  say(`# lane "${lane.name}" vs dev  (${range})\n`);
  try { sh(`git diff ${hasFlag('--full') ? '' : '--stat'} ${range}`); }
  catch { die(`could not diff ${range} — is the lane branch present?`); }
}

// ── since <ref> ──────────────────────────────────────────────────────────────
function bucketOf(f) {
  if (f.startsWith('src/components/')) return `src/components/${f.split('/')[2] || ''}`;
  if (f.startsWith('src/pages/')) return 'src/pages';
  if (f.startsWith('src/')) return `src/${f.split('/')[1] || ''}`;
  if (f.startsWith('supabase/')) return 'supabase (backend)';
  if (f.startsWith('api/')) return 'api (vercel)';
  if (f.startsWith('docs/')) return 'docs';
  if (f.startsWith('scripts/') || f.startsWith('.githooks/') || f.startsWith('.github/')) return 'tooling / CI';
  if (f.startsWith('ios/') || f.startsWith('android/')) return 'native';
  return 'other';
}
function since() {
  const ref = positionals[0];
  if (!ref) die('usage: npm run since <tag-or-sha>');
  if (!tryGit(`rev-parse -q --verify ${ref}`)) die(`unknown ref: ${ref}`);
  const commits = gLines(`log --oneline ${ref}..HEAD`);
  const stat = gLines(`diff --name-status ${ref}..HEAD`);
  if (!commits.length && !stat.length) { say(`Nothing changed since ${ref} — HEAD is at or behind it.`); return; }
  const buckets = {};
  let add = 0, del = 0;
  for (const line of stat) {
    const parts = line.split('\t');
    const file = parts[parts.length - 1];
    const b = bucketOf(file);
    (buckets[b] ||= { files: 0 }).files++;
  }
  const shortstat = tryGit(`diff --shortstat ${ref}..HEAD`);
  say(`What changed since ${ref} (→ ${tryGit('rev-parse --short HEAD')}):\n`);
  say(`  ${commits.length} commit(s), ${stat.length} file(s) touched.  ${shortstat}`);
  say('');
  say('  By area:');
  for (const [b, v] of Object.entries(buckets).sort((a, b2) => b2[1].files - a[1].files))
    say(`    ${String(v.files).padStart(3)} file(s)  ${b}`);
  say('');
  say('  Commits:');
  for (const c of commits.slice(0, 20)) say(`    ${c}`);
  if (commits.length > 20) say(`    …and ${commits.length - 20} more.`);
}

// ── pre-commit ownership block (called by .githooks/pre-commit) ──────────────
// Fail-OPEN on any internal error (can't-run ≠ a violation) — but exit 1 on a real
// cross-lane ownership violation. Blocking is safe here: the fix is unstaging ONE
// file, not abandoning work.
function checkStaged() {
  try {
    // HEARTBEAT FIRST, BEFORE THE SWEEP. This commit IS activity on whatever lane owns
    // this worktree, and the sweep below parks on the way in — a heartbeat after it
    // would arrive too late to save the lane that is demonstrably being worked. Nothing
    // happens in the main worktree (no lane owns it), which is correct.
    touchLaneForWorktree(tryGit('rev-parse --show-toplevel'));
    // Demote any inactive lane to parked, so a dead-agent lane can't block this commit
    // (the 2026-07-22 deadlock: the guard enforced a lane whose agent had exited). After
    // the heartbeat above, "inactive" now means no lane command AND no commit for 90m.
    reapDeadLanes();
    // Enforce ONLY live lanes. A parked/inactive lane has released its claim.
    const lanes = readLanes().filter((l) => laneIsLive(l));
    const here = tryGit('rev-parse --show-toplevel');
    const staged = (tryGitRaw('diff --cached --name-only -z') || '').split('\0').filter(Boolean);
    const inMain = resolve(here) === resolve(mainRoot());

    // ── INHERITED INDEX (2026-08-16) ─────────────────────────────────────────
    // Refuse a commit whose index holds files THIS session did not stage. git offers no
    // hook on `git add`, so "did not stage" is derived from the snapshot session-begin
    // writes at session start: whatever was already in the index before this session
    // existed belongs to a previous one.
    //
    // The case that built this: a killed session left repo-state.mjs, MarketplaceTab.tsx
    // and marketplaceFeedQuery.test.ts staged in main — 138 lines. The next session's
    // `git add -A` would have swept all three into an unrelated commit, and the one after
    // that would have had no way to tell whose work it was. lane:ship already refuses to
    // merge over a dirty main for the same reason; this is that rule one layer down, at
    // the commit rather than the merge.
    //
    // FAILS OPEN, TWICE OVER: no snapshot (fresh clone, hook never ran, unreadable file)
    // means no opinion, because a guard that blocks every commit in a repo it cannot
    // reason about is worse than the sweep it prevents. And it is escapable by an
    // explicit, named env var — deliberately NOT --no-verify, which would silently drop
    // the secret scan and every other pre-commit gate with it. An inescapable version of
    // this check is how the repo froze on 2026-08-16 in the first place; a guard with no
    // exit is a deadlock waiting for its trigger.
    const inherited = (() => {
      try { return JSON.parse(readFileSync(stagedSnapshotPath(here), 'utf8')).inherited || []; }
      catch { return null; }
    })();
    const foreign = inherited === null ? [] : staged.filter((f) => inherited.includes(f));
    if (foreign.length && process.env.DC_ADOPT_STAGED !== '1') {
      console.error('');
      console.error('╔═ COMMIT BLOCKED — THE INDEX HOLDS ANOTHER SESSION\'S WORK ════════╗');
      console.error(`║  ${foreign.length} file(s) were already staged when this session started.`);
      console.error('╚══════════════════════════════════════════════════════════════════╝');
      for (const f of foreign) console.error(`     ${f}`);
      console.error('');
      console.error('  These are not yours. Committing now folds someone else\'s half-finished');
      console.error('  work into your message, under your commit, where nobody will find it.');
      console.error('');
      console.error('  INSPECT them first — that is the whole ask:');
      console.error(`    git diff --cached -- ${foreign.slice(0, 3).map((f) => JSON.stringify(f)).join(' ')}`);
      console.error('');
      console.error('  Then pick one, knowing what you are doing:');
      console.error('    · not yours to land   →  git restore --staged <file>   (keeps the edits)');
      console.error('    · finished work       →  commit it ALONE, describing what it is:');
      console.error('                             DC_ADOPT_STAGED=1 git commit -m "..." -- <files>');
      console.error('');
      console.error('  Do not reach for --no-verify: it drops the secret scan too.');
      process.exit(1);
    }
    const self = laneForPath(here, lanes);
    // A merge is INTEGRATION, not authoring. The dependency rule exists so lock
    // churn originates in one dedicated lane — and a `merge lane/<dep-lane>` is
    // precisely that lane's churn arriving on the trunk, already reviewed. In the
    // main worktree `self` is always undefined, so without this exemption the rule
    // made a dependency lane impossible to merge at all: it could only ever be
    // landed with --no-verify, which CLAUDE.md forbids. Detect the merge from
    // MERGE_HEAD rather than trusting the caller.
    //
    // HOISTED ABOVE THE MAIN-WORKTREE BLOCK, 2026-08-16 — it used to sit below and so
    // exempted only the dependency rule. `git merge` fires pre-merge-commit, but a
    // CONFLICTED merge is finished by hand with `git commit`, which fires pre-commit:
    // the clean path was exempt and the conflict path was not. Measured that night —
    // shipping lane lv1-delegation-class conflicted on docs/CHANGELOG.md and
    // docs/DECISIONS.md, and completing the merge in main was refused on account of
    // the very lane being shipped. The only ways through were LANE_MAIN_RECOVERY=1 (an
    // escape hatch, not a workflow) or parking the lane mid-merge. Finishing a merge
    // git itself started is not authoring, and no sweep can hide inside it: every
    // staged path is already committed on the branch being merged.
    const gitDir = tryGit('rev-parse --git-dir');
    const midMerge = gitDir ? existsSync(join(here, gitDir, 'MERGE_HEAD')) || existsSync(join(gitDir, 'MERGE_HEAD')) : false;

    // ── D3 — PATH-SCOPED, WITH A BROAD-OWNERSHIP FALLBACK ────────────────────
    // (ADR 0001, decided by Ethan 2026-08-16; supersedes the unconditional block.)
    //
    // LANE-LIVE ONLY (decided 2026-07-31) narrowed this rule once already, from "always"
    // to "while a lane is live". That was still far too coarse: ANY live lane blocked
    // EVERY commit in main, including for files that lane never claimed. Combined with a
    // lane owning docs/handoffs/ — which lane:start itself made collide — it shut both
    // commit routes at once on 2026-08-16 and froze the repo outright.
    //
    // So the block is now PRECISE by default: refuse only when a staged path is actually
    // owned by a live lane, and name that lane. It stays BLUNT exactly when a lane has
    // declared broad ownership, because such a lane has said it is touching everything
    // and path-scoping cannot tell what it will reach.
    //
    // THIS IS ONLY DEFENSIBLE BECAUSE OF A2. The residual hazard the global form covered
    // and this one does not is the UNOWNED sweep — a lane's `git add -A` picking up a
    // main-worktree file no lane declared. The inherited-index guard above now catches
    // that from the other side, at the sweeping session's own commit. Weaken A2 and this
    // narrowing stops being safe; the two ship together or not at all.
    //
    // Broad ownership is recomputed from `owns` rather than read from the stored
    // broadOwnership field, so a lane registered before that field existed still counts.
    const broadLanes = lanes.filter((l) => l.broadOwnership || broadOwnership(l.owns || []).length);
    const claimed = staged
      .map((file) => ({ file, lane: lanes.find((l) => ownsFile(l.owns || [], file)) }))
      .filter((x) => x.lane);
    const mainBlocked = inMain && !midMerge && staged.length
      && process.env.LANE_MAIN_RECOVERY !== '1'
      && (broadLanes.length ? lanes.length : claimed.length);
    if (mainBlocked) {
      console.error('');
      console.error('╔═ MAIN WORKTREE — COMMIT BLOCKED ═════════════════════════════════╗');
      if (broadLanes.length) {
        console.error(`║  ${broadLanes.length} live lane(s) declared BROAD ownership: ${broadLanes.map((l) => l.name).join(', ')}`);
        console.error('║  A lane that owns everything can sweep anything, so while one is live the');
        console.error('║  main worktree is inspect-only for ALL paths — not just the ones it named.');
        console.error('╚════════════════════════════════════════════════════════════════════╝');
      } else {
        console.error(`║  ${claimed.length} staged path(s) are owned by a live lane:`);
        console.error('╚════════════════════════════════════════════════════════════════════╝');
        for (const { file, lane } of claimed) console.error(`     ${file}   → lane "${lane.name}"`);
        console.error('');
        console.error('  Those paths belong to that lane until it ships; committing them here races it.');
        console.error('  Everything else in main is committable — this block is path-scoped now, so');
        console.error('  unstage just these and the rest of your commit goes through.');
      }
      console.error('  Start a lane before editing: npm run lane:start -- <name> --owns "<feature paths>"');
      console.error('  If this is already-created WIP that must be preserved, make one explicit recovery commit:');
      console.error('    LANE_MAIN_RECOVERY=1 git commit -m "wip: recover main-worktree changes"');
      console.error('  Then move the follow-up work into a lane. This exception is for recovery, not routine work.');
      process.exit(1);
    }
    // A GitHub Actions runner is not a place two agents can collide. The whole
    // point of the dependency rule is that lock churn originates in ONE place
    // while several sessions share a checkout; a runner is a throwaway,
    // single-purpose clone with no lanes, no other session, and its own
    // `concurrency:` group, so the hazard the rule guards cannot occur there.
    // Without this exemption `Dependabot Triage` could not do the one thing it
    // exists for: run `npm audit fix` and commit the result to dev. Run
    // #31397257497 (2026-08-10) died exactly here — "package-lock.json may only
    // be staged from a dedicated dependency lane" — and the only ways around it
    // were `--no-verify` (forbidden by CLAUDE.md) or `core.hooksPath=/dev/null`,
    // which would silently drop every OTHER pre-commit gate as well. Scoped to
    // the dependency rule alone: the main-worktree block above is untouched, and
    // so is the per-lane ownership check below.
    //
    // NARROWED 2026-08-16. The first form exempted a runner unconditionally, so
    // ANY workflow could stage a lockfile alongside anything else. It is now also
    // required that EVERY staged path is a dependency path — the commit must be a
    // pure dependency commit, which is what `npm audit fix` produces and what the
    // rule is willing to accept without a lane. That is the same kind of test as
    // `midMerge`: read off git state, not off a caller's claim about itself.
    //
    // Deliberately NOT keyed on GITHUB_WORKFLOW or the dependabot actor. A
    // name allowlist adds a silent failure mode — rename the workflow and the
    // automation goes red for a reason nobody connects to this line — while a
    // pure-dependency-commit test cannot drift out of date. It is also the
    // narrowing that actually matters: the residual risk here is an autonomous
    // agent in CI (claude.yml's advisor-autofix) sweeping a lockfile into an
    // unrelated commit, and the name check would have waved that through while
    // this one blocks it.
    //
    // WHAT IT STILL LETS THROUGH: any workflow may commit package.json or a
    // lockfile ON ITS OWN, not just Dependabot Triage. That stays deliberate —
    // the rule protects concurrent agents inside one shared checkout, and a
    // runner is a throwaway single-purpose clone with no second agent. Three
    // workflows commit today: dependabot-triage.yml stages exactly
    // `package.json package-lock.json`, claude.yml's advisor-autofix stages a
    // migration + CHANGELOG, and automation-status.yml stages one JSON snapshot.
    // Only the first touches this rule, and it still passes.
    const inCi = process.env.GITHUB_ACTIONS === 'true';
    const ciDependencyOnly = inCi && staged.every(isDependencyPath);
    const dependencyViolation = midMerge || ciDependencyOnly
      ? undefined
      : staged.find((f) => isGatedDependencyPath(f) && (!self || !dependencyLane(self.owns || [])));
    if (dependencyViolation) {
      console.error(`✗ ${dependencyViolation} may only be staged from a dedicated dependency lane. Start one with: npm run lane:start -- <name> --owns "package.json"`);
      if (dependencyViolation === 'package.json') {
        console.error(`  (gated because a dependency-bearing key changed: ${DEPENDENCY_KEYS.join(', ')}.`);
        console.error('   A scripts-only edit to package.json is NOT gated and needs no lane.)');
      }
      process.exit(1);
    }
    if (!lanes.length) process.exit(0);
    // The SAME mid-merge exemption the main-worktree block above needs, and for the same
    // reason — found by testing that fix rather than by reading (2026-08-16): merging a
    // lane necessarily stages the files that lane owns, starting with its own handoff.
    // With the lane still live and `self` undefined in main, this check called every one
    // of them a cross-lane violation and refused the merge. Tonight's lv1 ship only got
    // past it because the lane had been PARKED first, which is not a workflow — it is the
    // same "park your own lane to merge it" dance the other fix exists to delete.
    //
    // Scoped to genuine MERGE_HEAD state, so it cannot be reached by ordinary authoring.
    // Nothing can hide inside it: every staged path is already committed on the branch
    // being merged, and was subject to this rule when it was written there.
    const blocked = [], unowned = [];
    for (const f of staged) {
      const owner = midMerge ? null : lanes.find((l) => (!self || l.name !== self.name) && ownsFile(l.owns, f));
      if (owner) { blocked.push({ f, owner: owner.name }); continue; }
      if (!lanes.find((l) => ownsFile(l.owns, f))) unowned.push(f);
    }
    if (unowned.length) console.error(`⚠️  ${unowned.length} staged file(s) owned by no lane (fine, unowned): ${unowned.slice(0, 3).join(', ')}${unowned.length > 3 ? '…' : ''}`);
    if (blocked.length) {
      const owner = blocked[0].owner;
      console.error('');
      console.error('╔═ LANE OWNERSHIP — COMMIT BLOCKED ══════════════════════════════╗');
      for (const b of blocked) console.error(`║  ${b.f}\n║    → owned by live lane "${b.owner}"`);
      console.error('╚════════════════════════════════════════════════════════════════╝');
      // ONE coherent instruction (the old guard said "unstage" while lane:ship said
      // "commit or discard" — that contradiction forced the --no-verify bypass).
      console.error(`  These paths belong to live lane "${owner}". Choose ONE:`);
      console.error(`   · If that's someone else's active work — unstage: git restore --staged <file>`);
      console.error(`   · If "${owner}" is YOUR lane blocked on external work and you need to commit`);
      console.error(`     these here — release its ownership first, then re-commit:`);
      console.error(`         npm run lane:park ${owner}   &&   git commit …`);
      console.error(`     (park keeps the branch, worktree, and all commits — resume with lane:resume ${owner}.)`);
      console.error(`   See all lanes: npm run lane:status`);
      process.exit(1);
    }
    process.exit(0);
  } catch (e) {
    console.error(`⚠️  lane ownership check could not run (${e.message}) — not blocking.`);
    process.exit(0);
  }
}

// ── dispatch ─────────────────────────────────────────────────────────────────
try {
  switch (cmd) {
    case 'start': start(); break;
    case 'status': status(); break;
    case 'defer': defer(); break;
    case 'park': park(); break;
    case 'resume': resume(); break;
    case 'ship': ship(); break;
    case 'abandon': abandon(); break;
    case 'diff': diff(); break;
    case 'since': since(); break;
    case 'check-staged': checkStaged(); break;
    default:
      die(`unknown command "${cmd}". Use: start | status | defer | park | resume | ship | abandon | diff | since`);
  }
} catch (e) {
  // Clean, single-line failure (the gate/rebase/merge refusals throw) — no stack trace.
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
