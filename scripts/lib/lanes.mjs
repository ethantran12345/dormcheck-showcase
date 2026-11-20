/**
 * lanes - shared library for the lane system (scripts/lane.mjs, repo-state.mjs,
 * the pre-commit ownership block). One worktree per parallel agent, with ENFORCED
 * path ownership, so concurrent sessions physically can't collide.
 *
 * Why this file exists: the warn-only agent-lock (scripts/agent-lock.mjs) made a
 * sibling session VISIBLE but never stopped a collision. Lanes stop it structurally:
 * each agent edits in its own git worktree (../dc-lanes/<name>), declares the globs
 * it owns, and the pre-commit hook BLOCKS staging a file another live lane owns.
 *
 * CRITICAL: the registry lives in the shared git common-dir, NOT the per-worktree
 * git-dir. Worktrees each have their own --git-dir but ONE --git-common-dir; keying
 * off the common-dir is the whole reason every lane sees the same registry.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync, linkSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { minimatch } from 'minimatch';

// ── git helpers ──────────────────────────────────────────────────────────────
// TWO helpers, and the split is load-bearing rather than stylistic:
//   git()    — SCALAR output (rev-parse, symbolic-ref, a truthy "is it dirty?"
//              check). Trimming is what the caller wants.
//   gitRaw() — output whose BYTES are significant. Never trimmed.
//
// Why the distinction has to exist: `git status --porcelain` emits a fixed
// three-column prefix `XY<space>path`, and for an UNSTAGED file X is a literal
// SPACE (" M path"). A leading .trim() eats that space off the FIRST line only,
// so the `.slice(3)` every porcelain consumer does then removes one character
// too many — "docs/…" comes back as "ocs/…". In a four-file dirty list exactly
// one path is mangled and three are intact, which reads as a display glitch. It
// is not one: that same string is fed to the glob matcher deciding whether a new
// lane may start over conflicting dirt, and a mangled path matches no glob, so
// the guard reports "no overlap" and opens a lane on top of a genuinely
// conflicting uncommitted file — silently, with no error, the loss surfacing
// later as a merge conflict blamed on something else.
//
// This is the third instance of the one bug (the wip hook silently dropped the
// first file of every scoped auto-save for five days — fixed 39131edd). Hence
// the standing rule: line-oriented output never routes through a scalar trim.
// Git plumbing variables that must NOT leak into a child git run in ANOTHER worktree.
// When a `git commit -- <paths>` (or --only) runs its hooks, git exports GIT_INDEX_FILE
// pointing at the TEMPORARY index for that partial commit (and, depending on how the
// hook was reached, GIT_DIR / GIT_WORK_TREE / GIT_PREFIX). The pre-commit hook runs
// `lane.mjs check-staged`, which reaps inactive lanes, and on 2026-09-06 the salvage
// `git add -A` + `git commit` it ran with `cwd` = the parked lane's worktree inherited
// that GIT_INDEX_FILE: it rewrote the PARENT commit's temp index with the lane's tree,
// the parent committed the lane's file under its own message (f5d09dab), and the lane's
// own index was left inconsistent. BA-31 in docs/audits/backend-audit-2026-09-06.md.
// Every git call that names a `cwd` therefore gets an env with these stripped.
const GIT_PLUMBING_ENV = /^GIT_(INDEX_FILE|DIR|WORK_TREE|PREFIX|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|QUARANTINE_PATH)$/;
export function gitEnvFor(opts = {}, base = process.env) {
  if (opts.env) return opts.env;
  if (!opts.cwd) return base;
  const env = { ...base };
  for (const k of Object.keys(env)) if (GIT_PLUMBING_ENV.test(k)) delete env[k];
  return env;
}
export function gitRaw(cmd, opts = {}) {
  return execSync(`git ${cmd}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
    env: gitEnvFor(opts),
  });
}
export const git = (cmd, opts = {}) => gitRaw(cmd, opts).trim();
export const tryGit = (cmd, opts = {}) => { try { return git(cmd, opts); } catch { return ''; } };
// Like tryGit but reports SUCCESS, not output. Needed where an empty stdout is a valid
// result and only the exit status distinguishes "worked" from "refused" — e.g. a commit
// whose hooks rejected it.
export const gitOk = (cmd, opts = {}) => { try { git(cmd, opts); return true; } catch { return false; } };
export const tryGitRaw = (cmd, opts = {}) => { try { return gitRaw(cmd, opts); } catch { return ''; } };
// Line-oriented git output. Strips ONLY the trailing newline(s) git appends —
// never leading whitespace, which is DATA in porcelain's status columns.
export const gLines = (cmd, opts = {}) =>
  tryGitRaw(cmd, opts).replace(/\n+$/, '').split('\n').filter(Boolean);

// Repo-relative paths from `git status --porcelain`, parsed rather than sliced.
//
// Use this instead of hand-slicing three characters off a status line. Two
// distinct bugs it closes:
//   1. the trim/slice offset bug documented above (an explicit /^(..) (.*)$/
//      asserts the prefix shape instead of assuming a byte count), and
//   2. quoting — HUMAN porcelain C-quotes any path containing a space, a quote
//      or a non-ASCII byte (`"my file.ts"`, `"src/caf\303\251.ts"`), which every
//      hand-slicing call site mishandled. `-z` emits paths raw and NUL-delimited,
//      so a path may contain any byte including a newline without splitting an
//      entry.
// Rename/copy entries (R/C) carry the ORIGINAL path as a separate NUL-terminated
// field after the entry; we keep the destination and consume that origin field.
export function porcelainPaths(opts = {}) {
  const fields = tryGitRaw('status --porcelain=v1 -z', opts).split('\0').filter((s) => s !== '');
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    const m = /^(..) (.*)$/s.exec(fields[i]);
    if (!m) continue;                 // not a status entry — malformed, skip rather than guess
    paths.push(m[2]);
    if (/^[RC]/.test(m[1])) i += 1;   // skip the rename/copy ORIGIN field that follows
  }
  return paths;
}

// The shared git dir — identical across every worktree. resolve() against cwd
// turns the main worktree's relative ".git" into an absolute path, and leaves a
// linked worktree's already-absolute common-dir untouched.
export function commonDir() { return resolve(tryGit('rev-parse --git-common-dir') || '.git'); }
export const REGISTRY = () => join(commonDir(), 'dc-lanes.json');
export const SHIP_LOCK = () => join(commonDir(), 'dc-ship-lock');
// Where a worktree's session-start index snapshot lives. In the COMMON dir with the rest
// of the coordination state, but keyed PER WORKTREE — each worktree has its own index, so
// main's inherited-staged set says nothing about a lane's. Non-word characters collapse to
// `-` so the key is a filename; the full path is stored inside the file for disambiguation.
export function stagedSnapshotPath(worktree) {
  return join(commonDir(), `dc-staged-${resolve(worktree).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}.json`);
}

// The primary (non-linked) worktree — Ethan's :8080 preview surface, and where
// lane:ship performs the merge into dev. First line of `worktree list --porcelain`.
export function mainRoot() {
  const first = (tryGit('worktree list --porcelain').split('\n')[0] || '');
  return first.startsWith('worktree ') ? first.slice(9).trim() : tryGit('rev-parse --show-toplevel');
}

// ── registry ─────────────────────────────────────────────────────────────────
// Shape: { lanes: [{ name, branch, worktree, owns:[globs], pid, startedAt, status }] }
export function readLanes() {
  const f = REGISTRY();
  if (!existsSync(f)) return [];
  try { const j = JSON.parse(readFileSync(f, 'utf8')); return Array.isArray(j.lanes) ? j.lanes : []; }
  catch { return []; }
}
export function writeLanes(lanes) { writeFileSync(REGISTRY(), JSON.stringify({ lanes }, null, 2) + '\n'); }

// ── time + liveness ──────────────────────────────────────────────────────────
export const STALE_LANE_MS = 8 * 60 * 60 * 1000;    // a lane older than 8h is STALE (display flag)
// The next tier up. STALE is advisory by design and always was; the failure it could not
// prevent (2026-08-01) is a lane that gets flagged and then ignored indefinitely — four
// lanes sat past their session holding 6 commits, one of them a security fix, and only a
// manual consolidation recovered them. A declared threshold with no consequence is a
// statistic, so OVERDUE carries one: it refuses `lane:start` (you cannot open a fifth lane
// while four rot) and refuses a manual `session:begin`. It deliberately does NOT touch
// ordinary commits on dev — a guard you must routinely bypass trains you to bypass guards.
export const OVERDUE_LANE_MS = 24 * 60 * 60 * 1000;
// The only way past OVERDUE that is not ship/abandon: an explicit, reasoned, EXPIRING
// deferral (npm run lane:defer). Bounded so it is a decision that must be re-made, not a
// snooze button — an unbounded bypass env var is exactly what this tier exists to avoid.
export const LANE_DEFER_MAX_MS = 48 * 60 * 60 * 1000;
// A lane with no registry ACTIVITY (no lane command from its worktree) for this long
// is treated as inactive — its ownership stops being enforced and reaping degrades it
// to `parked`. 90m is deliberately shorter than the 8h display-stale flag: the pid
// anchors to the terminal SHELL (see sessionAnchorPid), which outlives the agent, so
// pid-liveness alone can't tell a working lane from an exited one. Inactivity can, and
// a self-releasing lock that's occasionally too eager (re-claimed on the next command)
// beats a stale lock that deadlocks every sibling commit — the failure the 2026-07-22
// deadlock proved. Overridable via DC_LANE_INACTIVE_MIN for tests.
export const LANE_INACTIVE_MS = (Number(process.env.DC_LANE_INACTIVE_MIN) || 90) * 60 * 1000;
export const SHIP_LOCK_STALE_MS = 15 * 60 * 1000;   // a ship lock older than 15m is stale
export const ageMs = (iso) => Date.now() - new Date(iso).getTime();
export function human(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}
export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; } // EPERM: process exists, just not ours to signal
}

// Tri-state liveness. A lane whose anchor we cannot evaluate is UNKNOWN, never "dead":
// conflating the two is what made every Windows lane look dead one command after start
// (the anchor walk failed, an ephemeral pid got recorded, and the demoter fired on it).
export const LIVENESS = { LIVE: 'live', INACTIVE: 'inactive', UNKNOWN: 'unknown' };

// Milliseconds since this lane last ran a lane command (fell back to startedAt for
// lanes registered before lastActive existed).
export const inactiveMs = (lane) => ageMs(lane.lastActive || lane.startedAt);

// A lane is INACTIVE if its agent session looks gone. We anchor to the agent session
// when it identified itself (agentSession, recorded at start), otherwise to activity
// recency + pid. The registered pid is the terminal shell, which lives past the agent —
// so pid-death is sufficient-but-not-necessary evidence of death; inactivity is the
// necessary signal. Either one flips a lane inactive.
export function laneLiveness(lane) {
  if (lane.status === 'parked') return LIVENESS.INACTIVE;  // parked is a deliberate release, not death
  // No usable anchor: either this platform could not resolve one at registration time
  // (anchorResolved === false) or the lane predates the field. We cannot ask "is the
  // session gone?", so we do NOT guess — the inactivity clock is the only honest signal,
  // and anything short of it is UNKNOWN rather than dead.
  if (!lane.pid || lane.anchorResolved === false) {
    return inactiveMs(lane) > LANE_INACTIVE_MS ? LIVENESS.INACTIVE : LIVENESS.UNKNOWN;
  }
  if (!pidAlive(lane.pid)) return LIVENESS.INACTIVE;       // shell/session gone → certainly inactive
  return inactiveMs(lane) > LANE_INACTIVE_MS               // shell alive but no activity → agent likely exited
    ? LIVENESS.INACTIVE
    : LIVENESS.LIVE;
}

// Back-compat boolean. UNKNOWN is deliberately NOT inactive: callers that only want
// "should ownership still be enforced?" must not release a lock on a guess.
export function laneInactive(lane) {
  return laneLiveness(lane) === LIVENESS.INACTIVE;
}

// A lane is LIVE — i.e. its --owns ownership is ENFORCED against other sessions —
// only when it is explicitly live AND not inactive. Everything downstream (the
// pre-commit guard, start/resume overlap checks) consults THIS, never a raw pid or
// status field, so a stale or parked lane never enforces a lock nobody's behind.
export const laneIsLive = (lane) => lane.status === 'live' && !laneInactive(lane);

// Stamp a lane's lastActive to now and persist. Called at the top of every lane
// command that runs from (or names) a lane, so an actively-worked lane keeps proving
// itself alive and never trips the inactivity heuristic.
export function touchLane(name) {
  const lanes = readLanes();
  const l = lanes.find((x) => x.name === name);
  if (!l) return;
  l.lastActive = new Date().toISOString();
  writeLanes(lanes);
}

// GIT ACTIVITY IS A HEARTBEAT (2026-08-03). Until now only an explicit `lane:*` command
// stamped lastActive, so a lane that was being worked HARD — commit after commit, no
// reason to run a lane command — read INACTIVE after 90 minutes and stopped recognizing
// itself: `laneIsLive` went false, the pre-commit guard found no `self`, and the lane
// began enforcing its own rules against its owner (it refused its owner's package.json
// on 2026-08-02, and being inactive+dirty is also what let the reapDeadLanes recursion
// fire). The timeout is NOT the problem and is not being raised — releasing a dead
// agent's lock is exactly what it is for. The problem was the heartbeat: an agent that
// is committing is the strongest possible evidence of an agent that is not dead, and it
// counted for nothing.
//
// The signal is the WORKTREE, not the pid. sessionAnchor() exists and would identify the
// committing session, but it reports resolved:false whenever the process walk dead-ends —
// which its own comments note happens routinely in an agent harness that spawns a
// short-lived shell per command, i.e. precisely here. A commit landing inside a lane's
// worktree is lane activity by definition (one worktree per lane is the model's core
// invariant), it needs no process walk, and it cannot be wrong about attribution.
//
// Returns the lane name it stamped, or null. Callers must invoke this BEFORE
// reapDeadLanes() — the sweep parks on the way in, so a heartbeat after it is too late.
export function touchLaneForWorktree(worktreePath) {
  if (!worktreePath) return null;
  const lanes = readLanes();
  const l = lanes.find((x) => samePath(x.worktree, worktreePath));
  // A PARKED lane is deliberately not revived: parking is an explicit release of
  // ownership (lane:park, or an auto-park a human has since seen), and a stray commit in
  // its worktree must not silently re-take the lock. lane:resume is that door.
  if (!l || l.status === 'parked') return null;
  l.lastActive = new Date().toISOString();
  writeLanes(lanes);
  return l.name;
}

// ── OVERDUE tier (age, not liveness) ─────────────────────────────────────────
// Note what this deliberately does NOT consult: laneIsLive. Auto-park fires at 90m of
// inactivity, so by the time a lane has outlived its session it is usually PARKED — the
// exact state the 2026-08-01 lanes were in. Keying the escalation on liveness would
// therefore exempt precisely the lanes that rot. Age since startedAt is the signal.
export const laneAgeMs = (lane) => ageMs(lane.startedAt);
export const laneOverdue = (lane) => laneAgeMs(lane) > OVERDUE_LANE_MS;

// A deferral suppresses the block only while it is unexpired. An expired one is left in
// the registry on purpose: the count and the last reason are evidence, and a lane
// deferred three times is telling you something.
export function deferralActive(lane) {
  const d = lane?.deferral;
  return !!(d?.until && new Date(d.until).getTime() > Date.now());
}

export function overdueLanes(lanes = readLanes()) {
  return lanes.filter((l) => laneOverdue(l) && !deferralActive(l));
}

// The one refusal message, shared by lane:start and session:begin so both name the same
// lane, age, commit count and the same three exits. Returns null when nothing is overdue.
export function overdueBlockText({ lanes = readLanes(), action = 'blocked.' } = {}) {
  const blocking = overdueLanes(lanes);
  if (!blocking.length) return null;
  const out = [];
  out.push(`✗ ${blocking.length} lane(s) have outlived their session (older than ${human(OVERDUE_LANE_MS)}) — ${action}`);
  out.push('');
  for (const l of blocking) {
    const ahead = tryGit(`rev-list --count origin/dev..${l.branch}`) || '?';
    const d = l.deferral;
    const bits = [`${human(laneAgeMs(l))} old`, `${ahead} commit(s) ahead of dev`, l.status];
    if (d?.count) bits.push(`deferred ${d.count}×`);
    if (d?.until && !deferralActive(l)) bits.push(`deferral EXPIRED ${human(ageMs(d.until))} ago`);
    out.push(`    ⏳ ${l.name}  ·  ${bits.join('  ·  ')}`);
    if (d?.reason) out.push(`         last reason: ${d.reason}`);
    out.push(`         at ${l.worktree}`);
  }
  out.push('');
  out.push('  Three ways out — none of them deletes a branch, a worktree, or a commit:');
  out.push('    ship     ·  cd <lane worktree> && npm run lane:ship');
  out.push('    abandon  ·  cd <lane worktree> && npm run lane:abandon      (salvages to a pushed tag)');
  out.push(`    defer    ·  npm run lane:defer <name> --reason "why it must stay open" [--hours N]`);
  out.push(`               (max ${human(LANE_DEFER_MAX_MS)}, recorded in the lane contract, counted in lane:status)`);
  out.push('');
  out.push('  Ordinary work on dev is NOT blocked by this — only opening another lane.');
  return out.join('\n');
}

// The PID we record for a lane must track the LONG-LIVED terminal session, not the
// ephemeral `npm run lane:start` node process (which exits the instant start
// finishes — recording it would make every lane look dead one command later). We
// walk up the process tree to the topmost ancestor below init (pid 1): the login /
// terminal-session shell, which lives for the whole session. Caveat: if a terminal
// app is the top ancestor, all its tabs share one anchor, so PID-death detects
// terminal/session EXIT; the 8h STALE flag is the backstop for a tab left open.
// Returns a Map(pid → ppid) on Windows, or null elsewhere. One CIM query beats N shell
// spawns up the chain (~140ms once vs ~24 process launches). `wmic` is deliberately not
// used: it is deprecated and absent from current Windows 11 images.
let win32MapCache;   // per-process memo: the walk is called once, but tests call it often
function win32ParentMap() {
  if (win32MapCache !== undefined) return win32MapCache;
  try {
    // One query for the whole table, built into a pid→{ppid,name} map. Enumerating is
    // ~140ms; the dominant cost is PowerShell startup, so this must stay a SINGLE spawn —
    // a per-ancestor query would pay that startup once per level of the chain.
    const out = execSync(
      'powershell -NoLogo -NoProfile -NonInteractive -Command '
      + '"Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name | '
      + 'ForEach-Object { \\"$($_.ProcessId) $($_.ParentProcessId) $($_.Name)\\" }"',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    const map = new Map();
    for (const line of out.split(/\r?\n/)) {
      const [pid, ppid, name] = line.trim().split(/\s+/);
      if (Number(pid)) map.set(Number(pid), { ppid: Number(ppid) || 0, name: (name || '').toLowerCase() });
    }
    win32MapCache = map.size ? map : null;
  } catch { win32MapCache = null; }
  return win32MapCache;
}

// Windows processes that root a login session rather than participate in it. Climbing
// past these would anchor every lane to the desktop, which outlives any agent or
// terminal and would make pid-liveness meaningless. POSIX gets the same boundary free
// from `ppid <= 1`.
const WIN32_SESSION_ROOTS = new Set(['explorer.exe', 'services.exe', 'wininit.exe', 'winlogon.exe', 'userinit.exe', 'svchost.exe']);

// POSIX single-parent lookup. Returns 0 when it cannot be determined, which the walk
// treats as "stop", never as "reached the top".
function posixParentPid(pid) {
  try { return Number(execSync(`ps -o ppid= -p ${pid}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) || 0; }
  catch { return 0; }
}

// The PID we record for a lane must track the LONG-LIVED terminal session, not the
// ephemeral `npm run lane:start` node process (which exits the instant start finishes —
// recording it makes every lane look dead one command later; that is exactly what the
// old `ps -o` walk did on Windows, where Git Bash's ps has no -o flag, so the walk broke
// on iteration 1 and silently returned the ephemeral pid).
//
// Returns { pid, resolved }. `resolved: false` means we could not walk the tree at all;
// the caller records that so liveness falls back to the inactivity clock instead of
// reading an ephemeral pid's death as a dead session.
export function sessionAnchor() {
  const winMap = process.platform === 'win32' ? win32ParentMap() : null;
  if (process.platform === 'win32' && !winMap) return { pid: process.pid, resolved: false };

  // Anchor to the OUTERMOST STILL-LIVING ancestor BELOW the session root.
  //
  // Two Windows-specific traps this avoids:
  //  · ParentProcessId is not cleared when a parent exits, so the chain routinely passes
  //    through dead pids. We must NOT stop at the first dead ancestor — an agent harness
  //    spawns a short-lived shell per command, and those die while the app above them
  //    lives. We climb the whole chain and remember the outermost one still alive.
  //  · Climbing all the way up lands on explorer.exe, which lives until logout and would
  //    make every lane look permanently alive. WIN32_SESSION_ROOTS stops the walk there,
  //    matching the POSIX intent of anchoring to the terminal/app session.
  let pid = process.pid, top = process.pid, atBoundary = false;
  for (let i = 0; i < 24; i++) {
    const entry = winMap ? winMap.get(pid) : { ppid: posixParentPid(pid), name: '' };
    const ppid = entry?.ppid ?? 0;
    // A dead ancestor is not in the process table at all, so its own parent link is gone
    // and the chain simply ends. That is a dead END, not a session boundary — see below.
    if (!ppid) break;
    // pid 0/1/4 (init, Windows Idle/System) and the Windows desktop-shell processes are
    // session ROOTS: reaching one means we walked the whole session and the ancestor
    // just below it is the real anchor.
    if (ppid <= 1 || ppid === 4) { atBoundary = true; break; }
    if (winMap && WIN32_SESSION_ROOTS.has(winMap.get(ppid)?.name || '')) { atBoundary = true; break; }
    top = ppid; pid = ppid;
  }
  // `resolved` is a claim that `pid` really is the session anchor, and it is only honest
  // when the walk terminated at a session boundary. In an agent harness that spawns a
  // short-lived shell per command, an intermediate shell often exits mid-walk; the chain
  // then dead-ends on a dangling pid and any "anchor" we picked is arbitrary. Saying
  // resolved:false there makes liveness fall back to the inactivity clock — which is
  // accurate — instead of reading a doomed pid's death as a dead agent session.
  return { pid: top, resolved: atBoundary };
}

// Back-compat: callers that only want the number. Prefer sessionAnchor().
export function sessionAnchorPid() { return sessionAnchor().pid; }

// ── glob ownership ───────────────────────────────────────────────────────────
// A lane's `owns` is a LIST of globs, but `lane:start --owns "a b c"` used to store all
// three as ONE space-joined string (it split on commas only, and the documented usage
// example is comma-separated). minimatch then matched none of them, so a lane owned
// nothing: its own commits reported "owned by no lane", and — because the pre-commit
// dependency rule asks whether SELF owns package.json — it refused its own package.json.
// lane:start now splits on whitespace too, but registries written before that fix are
// still on disk, so every ownership read normalizes here. Accepting both shapes is the
// point: a lane that already exists must not silently own nothing.
// A TRAILING SLASH means "this directory", which is how `--owns "scripts/ src/test/"`
// reads to anyone typing it — but minimatch treats `scripts/` as a literal path that
// matches no file, so such a lane also owned nothing. Normalize it to `scripts/**`.
// Found 2026-08-03 while testing the space-joined fix: BOTH shapes were being written by
// real lane:start invocations, and both failed silently in the same direction (owning
// less than declared), which is the direction that produces "owned by no lane" warnings
// and lets two lanes edit the same tree. A bare `src/test` without the slash is left
// alone — it is indistinguishable from an extensionless file path.
// Both forms of the same normalization. The PAIR form keeps the token the human actually
// typed beside the glob we match with, so a refusal can name `src/test/` — what is written
// in the lane contract — rather than the `src/test/**` we derived from it.
export function expandOwnsPairs(globs) {
  return (globs || [])
    .flatMap((g) => String(g).trim().split(/[\s,]+/))
    .filter(Boolean)
    .map((raw) => ({ raw, glob: raw.endsWith('/') ? `${raw}**` : raw }));
}
export function expandOwns(globs) {
  return expandOwnsPairs(globs).map((p) => p.glob);
}
export function ownsFile(globs, file) {
  return expandOwns(globs).some((g) => minimatch(file, g, { dot: true }));
}
// A concrete stand-in path for a glob, used for overlap detection: turn wildcards
// into literal segments so two globs can be tested against each other.
function concreteRep(glob) {
  return glob.replace(/\*\*/g, 'x/x').replace(/\{[^}]*\}/g, 'x').replace(/\*/g, 'x').replace(/\?/g, 'x');
}
// Heuristic: two globs conflict if either's concrete representative matches the
// other (or they're identical). Errs toward flagging — the safe direction, since a
// false conflict just forces an explicit re-scope conversation at lane:start.
export function globsConflict(a, b) {
  if (a === b) return true;
  return minimatch(concreteRep(a), b, { dot: true }) || minimatch(concreteRep(b), a, { dot: true });
}
// COMPARE THE EXPANDED FORMS — this is the same normalization `ownsFile()` already
// applies, and the two disagreeing is a defect, not a nuance. Before 2026-08-06 this
// compared the RAW globs, so a lane could be granted `src/test/foo.test.ts` while a live
// lane owned `src/test/`: `concreteRep('src/test/')` is still `src/test/`, which minimatch
// matches against no file path in either direction, so lane:start saw no conflict — and
// then pre-commit, which DOES expand, blocked the file after all the work was done (hit
// live by lane detection-log against lane admin-tests). Exactly defect (a)'s shape one
// level up: the normalization was added to the read path and never to the overlap check.
export function ownershipConflicts(newGlobs, lanes, selfName = null) {
  const out = [];
  const mine = expandOwnsPairs(newGlobs);
  for (const lane of lanes) {
    // Only a LIVE lane's ownership can conflict — a parked/inactive lane has
    // released its claim (that release is the whole point of lane:park).
    if (lane.name === selfName || !laneIsLive(lane)) continue;
    const theirs = expandOwnsPairs(lane.owns || []);
    for (const ng of mine) for (const eg of theirs) {
      // Report the DECLARED tokens: the refusal has to name what is in the contract.
      if (globsConflict(ng.glob, eg.glob)) out.push({ lane: lane.name, requested: ng.raw, owned: eg.raw });
    }
  }
  return out;
}
// Compare two filesystem paths by IDENTITY, not by string. `resolve()` alone is not
// enough: on macOS the registry can hold /var/folders/… while `git rev-parse
// --show-toplevel` reports /private/var/folders/… for the same directory, and the two
// never compare equal — a lane whose worktree sits under any symlinked prefix is then
// invisible to every path lookup (found 2026-08-03 by the heartbeat test). realpath
// falls back to resolve for a path that does not exist yet, which is the pre-creation
// case in lane:start.
function realOrResolved(p) {
  try { return realpathSync(resolve(p)); } catch { return resolve(p); }
}
export function samePath(a, b) {
  if (!a || !b) return false;
  return realOrResolved(a) === realOrResolved(b);
}
export function laneForPath(path, lanes) {
  return lanes.find((l) => samePath(l.worktree, path)) || null;
}

// ── ship lock (Addition A) ───────────────────────────────────────────────────
// Serializes the rebase→gates→merge→push sequence so two simultaneous ships can't
// race on the one main-worktree index. Atomic create (flag 'wx') → exactly one wins.
export function acquireShipLock(laneName) {
  const f = SHIP_LOCK();
  const tmp = `${f}.${process.pid}.tmp`;
  const payload = JSON.stringify({ lane: laneName, pid: process.pid, iso: new Date().toISOString() }) + '\n';
  // Write the payload to a temp file first, then atomically hard-link it into place.
  // linkSync is atomic-exclusive (fails EEXIST if the lock exists) AND the lock file
  // only ever appears fully-written — closing the empty-file window that `wx`-create
  // left open, where a peer could read '' mid-write and wrongly deem the lock stale.
  const tryLink = () => {
    writeFileSync(tmp, payload);
    try { linkSync(tmp, f); return true; }
    catch (e) { if (e.code !== 'EEXIST') throw e; return false; }
    finally { rmSync(tmp, { force: true }); }
  };
  if (tryLink()) return { ok: true };
  // Lock exists. An UNREADABLE lock is treated as HELD (a peer mid-write), never
  // stolen — only a lock we can read AND that is genuinely old/dead is stealable.
  let cur = null; try { cur = JSON.parse(readFileSync(f, 'utf8')); } catch { /* mid-write or corrupt */ }
  const stale = cur && (ageMs(cur.iso) >= SHIP_LOCK_STALE_MS || !pidAlive(cur.pid));
  if (!stale) return { ok: false, holder: cur };
  rmSync(f, { force: true });
  return tryLink() ? { ok: true, stole: cur } : { ok: false, holder: cur };
}
export function releaseShipLock() { try { rmSync(SHIP_LOCK(), { force: true }); } catch { /* already gone */ } }

// ── inactive-lane DEMOTION (never a reaper — a demoter) ────────────────────────
// A liveness heuristic must NEVER destroy work: no branch delete, no worktree remove,
// no discarded untracked files (the 2026-07-22 near-miss). So an inactive lane (agent
// gone / no activity for LANE_INACTIVE_MS) is DEGRADED to `parked`, never abandoned:
//   · its --owns ownership stops being enforced (parked isn't live), unblocking siblings
//   · any uncommitted work is committed + tagged salvage/lane-<name> (pushed) so it's
//     recoverable by name, exactly as before
//   · the branch and worktree are PRESERVED untouched — re-claimable via lane:resume
// The name reapDeadLanes is kept for its many callers; it no longer reaps anything.
// `lanes` may be injected to exercise the decision logic against synthetic registries;
// an injected sweep never persists, so a test can't rewrite the real lane registry.
export function reapDeadLanes({ log = () => {}, lanes: injected = null } = {}) {
  // ── RE-ENTRANCY GUARD (2026-08-03) ──────────────────────────────────────────
  // The salvage commit below runs the hooks, and .githooks/pre-commit runs
  // `lane.mjs check-staged`, whose FIRST act is to call this function. With an
  // inactive, dirty lane on the registry that is an unbounded recursion:
  //
  //   reap → git commit (salvage) → pre-commit → check-staged → reap → git commit → …
  //
  // The lane is only marked parked at the END of this loop body, so every nested
  // level still sees status 'live' + dirty and salvages again. Observed 2026-08-02:
  // one `npm run lane:status` produced 10+ concurrent `lane.mjs check-staged`
  // processes and hung an unrelated `git commit` for two minutes; it unwinds only
  // when a commit finally fails. The env var (not a module-level boolean) is what
  // makes this work — the recursion crosses PROCESS boundaries via the hook, so an
  // in-process flag would not be visible to the child at all.
  if (process.env.DC_LANE_REAPING === '1') return { parked: [], parkedWithWork: [], pruned: [] };
  const prevReaping = process.env.DC_LANE_REAPING;
  process.env.DC_LANE_REAPING = '1';
  try {
    return reapDeadLanesInner({ log, injected });
  } finally {
    if (prevReaping === undefined) delete process.env.DC_LANE_REAPING;
    else process.env.DC_LANE_REAPING = prevReaping;
  }
}

function reapDeadLanesInner({ log, injected }) {
  const lanes = injected || readLanes();
  const persist = !injected;
  if (!lanes.length) return { parked: [], parkedWithWork: [], pruned: [] };
  const root = mainRoot();
  const parked = [], parkedWithWork = [], pruned = [];
  let changed = false;
  // Registry-only residue is safe to prune when BOTH recovery objects are already
  // absent. This removes records left after a successful ship whose final metadata
  // write was interrupted; it never deletes a branch, worktree, tag, or file.
  for (let i = lanes.length - 1; i >= 0; i--) {
    const lane = lanes[i];
    const hasWorktree = !!lane.worktree && existsSync(lane.worktree);
    const hasBranch = !!lane.branch && !!tryGit(`rev-parse -q --verify refs/heads/${lane.branch}`, { cwd: root });
    // PARKED is always recoverable, including when its worktree or local branch must be
    // reconstructed by lane:resume. Only terminal records may be forgotten here.
    if (['shipped', 'abandoned'].includes(lane.status) && !hasWorktree && !hasBranch) {
      pruned.push(lane.name);
      lanes.splice(i, 1);
      changed = true;
      log(`· pruned closed lane record "${lane.name}" (branch and worktree already absent; no work deleted).`);
    }
  }
  for (const lane of lanes) {
    if (lane.status === 'parked') continue;   // already released
    const liveness = laneLiveness(lane);
    // FAIL CLOSED. If we cannot tell whether the session is alive we must not act on a
    // guess: parking releases another agent's lock and salvaging rewrites their branch.
    // Abort loudly and let a human decide, rather than demote on incomplete evidence.
    if (liveness === LIVENESS.UNKNOWN) {
      log(`⚠️  lane "${lane.name}": liveness UNKNOWN (session anchor unresolvable on this platform, and it is still inside the ${human(LANE_INACTIVE_MS)} inactivity window).`);
      log(`   NOT parked, work untouched, ownership still held — demoting on a guess would release another agent's lock.`);
      log(`   Demote it deliberately with:  npm run lane:park ${lane.name}`);
      continue;
    }
    if (liveness === LIVENESS.LIVE) continue;  // still live — leave it alone
    const wt = lane.worktree;
    const exists = existsSync(wt);
    const dirty = exists ? tryGit('status --porcelain', { cwd: wt }) : '';
    const unmerged = tryGit(`rev-list --count origin/dev..${lane.branch}`) || tryGit(`rev-list --count dev..${lane.branch}`) || '0';
    const hasWork = exists && (dirty || unmerged !== '0');
    if (hasWork) {
      if (dirty) {
        // The salvage commit runs the hooks like any other commit. It used to pass
        // --no-verify, which let an automated path write a commit no gate had seen —
        // including live-reload URLs and cross-lane staging the hooks exist to catch.
        // If the hooks refuse, that is a real finding: leave the work exactly where it
        // is, keep ownership held, and say so. Never release a lock on unsalvaged work.
        tryGit('add -A', { cwd: wt });
        const committed = gitOk(`commit -m "wip: parked inactive lane ${lane.name} (auto-salvage)"`, { cwd: wt });
        if (!committed) {
          log(`✗ lane "${lane.name}" looks INACTIVE and has uncommitted work, but the salvage commit FAILED its hooks.`);
          log(`  NOT parked and ownership NOT released — the work is untouched at ${wt}.`);
          log(`  Fix the hook failure there, then: cd ${wt} && git add -A && git commit  (or npm run lane:abandon).`);
          continue;   // leave status 'live'
        }
      }
      const tag = `salvage/lane-${lane.name}`;
      if (!tryGit(`rev-parse -q --verify refs/tags/${tag}`)) {
        const tip = tryGit(`rev-parse ${lane.branch}`);
        if (tip) { tryGit(`tag ${tag} ${tip}`); tryGit(`push origin ${tag}`, { cwd: root }); }
      }
      parkedWithWork.push({ ...lane, tag });
      log(`⚠️  lane "${lane.name}" looks INACTIVE (pid ${lane.pid} gone or idle >${human(LANE_INACTIVE_MS)}) — auto-PARKED, ownership released. Work salvaged to ${tag} (pushed); branch + worktree kept at ${wt}. Resume: npm run lane:resume ${lane.name}`);
    } else {
      log(`· lane "${lane.name}" looks INACTIVE — auto-PARKED, ownership released (nothing uncommitted). Branch + worktree kept. Resume: npm run lane:resume ${lane.name}`);
      parked.push(lane);
    }
    lane.status = 'parked';
    lane.parkedReason = 'inactive';
    changed = true;
  }
  if (changed && persist) writeLanes(lanes);
  return { parked, parkedWithWork, pruned };
}
