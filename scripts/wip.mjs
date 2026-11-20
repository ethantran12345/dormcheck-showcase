#!/usr/bin/env node
/**
 * wip - automatic WIP saver. The goal (plain English): Ethan writes a lot of prompts
 * in a session, then clears the chat. Any uncommitted edit at that moment is lost.
 * This makes saving automatic so clearing a chat can never cost him work.
 *
 *   node scripts/wip.mjs --hook --throttle=10   # Stop hook: scoped, throttled auto-save
 *   node scripts/wip.mjs --hook                 # SessionEnd hook: scoped auto-save
 *   npm run wip                                 # BY HAND: full-tree save (human anti-stash net)
 *   npm run wip -- --all                        # force a full-tree save in any context
 *
 * SCOPED vs FULL — this is the crux (rewritten 2026-07-22 after the blanket `git add -A`
 * swept OTHER sessions' files — ios/, DormSearch.tsx, primitive-baseline.json — into
 * `[auto]` commits across 5+ sessions, defeated agents' explicit-path staging, and made
 * two concurrent sessions look like they were fighting over the commit graph):
 *
 *   - HOOK context (`--hook`, or WIP_PATHS set): SCOPED. It commits ONLY the files THIS
 *     session actually modified — never `git add -A`. The touched set comes from
 *     WIP_PATHS (explicit, for tests/agents) or, failing that, from parsing the session
 *     TRANSCRIPT (stdin `transcript_path`) for this session's Write/Edit/MultiEdit/
 *     NotebookEdit tool calls. It then stages only touched ∩ dirty via an EXPLICIT
 *     pathspec (`git add -A -- <paths>` — `-A` scoped to those paths handles
 *     deletes/renames without being a blanket sweep) AND commits with that same explicit
 *     pathspec (`git commit -F <msg> -- <paths>`). If the touched set can't be
 *     determined (hook but no transcript and no WIP_PATHS), it SKIPS rather than guess —
 *     when ambiguous, never commit.
 *
 *     The 2026-07-22 rewrite scoped the STAGING and left the COMMIT bare, which is only
 *     half a fix: `git commit` with no pathspec commits the ENTIRE INDEX, so anything a
 *     CONCURRENT session had already staged still rode along. That is exactly how
 *     `326ab23c` ("fix(marketing): mobile rhythm pass") swallowed another session's staged
 *     Swift deletions (ios/App/App/SpeechDictationPlugin.swift, MainViewController.swift)
 *     plus its docs/CHANGELOG.md line, splitting one logical change across `326ab23c` and
 *     `f17ff6dd`. Fixed 2026-08-04 by passing the pathspec to `git commit` too: it commits
 *     the working-tree content of those paths (deletions included) and leaves every other
 *     staged entry in the index for its owner. The commit MESSAGE is likewise counted from
 *     `diff --cached -- <paths>`, never the whole index. No pathspec on either call is
 *     correct ONLY in the manual/--all path below.
 *
 *   - MANUAL context (bare `npm run wip`, no `--hook`): a human deliberately asking to
 *     save their whole tree — the documented anti-stash net — so it does a full
 *     `git add -A`. There's no concurrent-session confusion in a hand-run, and `--all`
 *     forces this mode anywhere.
 *
 * Per-session KILL SWITCH: set `DORMCHECK_WIP_DISABLE=1` (alias `WIP_DISABLE=1`) and wip
 * exits 0 immediately — an agent run that manages its own commits turns auto-wip off for
 * its session without touching the shared hook config.
 *
 * Other rules (unchanged — deliberately dumb, a safety net not a workflow):
 *   - clean tree / nothing this session touched -> exit 0, NO empty commit
 *   - inside a lane worktree -> HEAD is lane/<name>, so it commits there, not dev
 *   - never stash / rebase / merge — just save
 *   - respects the pre-commit hook (live-reload URL + lane-ownership blocks). If a block
 *     fires, the work stays STAGED and we report loudly — we NEVER --no-verify past a
 *     guard (the iOS dev-only live-reload URL block was CORRECT and must stay possible).
 *   - if another git process holds index.lock, wait-and-skip (never force-clear it).
 *   - HOOK runs NEVER push (added 2026-07-26 after the Stop hook published ab85628e to
 *     origin/dev). Only a hand-run `npm run wip` pushes. A local commit is a recoverable
 *     net; publishing to the trunk is a decision the hook does not get to make.
 *
 * The throttle stamp lives in the shared git COMMON-dir so rapid Stops from any
 * session/worktree throttle against one timestamp.
 */
import { execSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
// Node builtins only inside agent-registry (see its header) — a dependency failure here
// would take the auto-save down with it, and this hook is the safety net.
import { registerSession, otherLiveSessionsHere, describeSession, mainWorktree, samePath } from './lib/agent-registry.mjs';
// Same rule, same reason: builtins only, and every call swallows its own errors. The log
// records what the guard below decided; it can never change the decision.
import { logDetection } from './lib/agent-detection-log.mjs';

const g = (cmd, opts = {}) =>
  execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryG = (cmd, opts = {}) => { try { return g(cmd, opts); } catch { return ''; } };
// Porcelain must NOT be blanket-trimmed: a modified-but-unstaged line starts with a
// SPACE (" M path"), and `.trim()` eats it on the FIRST line only, so `slice(3)` then
// returns "th" instead of "path". That silently dropped the first dirty file from the
// scoped touched∩dirty intersection on every hook save. Trim the trailing newline only.
const tryGRaw = (cmd, opts = {}) => {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).replace(/\n+$/, '');
  } catch { return ''; }
};
const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
const sleepSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

// Claude Code parses a Stop hook's stdout as a response. Keep hook status out of
// that channel so a normal "nothing to save" message cannot become a malformed
// hook response. Manual `npm run wip` keeps its usual terminal feedback.
const args = process.argv.slice(2);
const hasFlag = (name) => args.some((a) => a === name);
const isHook = hasFlag('--hook');
const log = (...values) => (isHook ? console.error : console.log)(...values);

// ── per-session kill switch ─────────────────────────────────────────────────────
if (['1', 'true', 'yes'].includes(String(process.env.DORMCHECK_WIP_DISABLE || process.env.WIP_DISABLE || '').toLowerCase())) {
  log('wip: disabled for this session (DORMCHECK_WIP_DISABLE) — skipping.');
  process.exit(0);
}

// ── args ─────────────────────────────────────────────────────────────────────────
const forceAll = hasFlag('--all');
let throttleMin = 0;
const tIdx = args.findIndex((a) => a === '--throttle' || a.startsWith('--throttle='));
if (tIdx !== -1) {
  const inline = args[tIdx].includes('=') ? args[tIdx].split('=')[1] : args[tIdx + 1];
  throttleMin = Number(inline) || 10;
}

// ── shared paths (git common-dir = one location across every worktree) ────────────
const commonDir = resolve(tryG('rev-parse --git-common-dir') || '.git');
const STAMP = join(commonDir, 'dc-last-wip');
const MSGFILE = join(commonDir, 'dc-wip-msg');
const repoRoot = resolve(tryG('rev-parse --show-toplevel') || process.cwd());

// ── read the Stop/SessionEnd hook JSON from stdin (never block a TTY) ─────────────
async function readHookStdin() {
  if (process.stdin.isTTY) return null;      // a human at a terminal — don't read/hang
  return await new Promise((res) => {
    let buf = '';
    const done = () => res(buf);
    const timer = setTimeout(done, 500);     // hooks close stdin promptly; cap regardless
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (buf += d));
    process.stdin.on('end', () => { clearTimeout(timer); res(buf); });
    process.stdin.on('error', () => { clearTimeout(timer); res(buf); });
  });
}

// Extract the file paths THIS session modified from its transcript (JSONL): every
// Write/Edit/MultiEdit (file_path) + NotebookEdit (notebook_path) tool_use.
function touchedFromTranscript(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  const out = new Set();
  let text;
  try { text = readFileSync(transcriptPath, 'utf8'); } catch { return null; }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const content = j?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type !== 'tool_use') continue;
      if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(b.name)) continue;
      const p = b.input?.file_path || b.input?.notebook_path;
      if (p) out.add(p);
    }
  }
  return out;   // may be empty (session did edits via Bash only, or none)
}

// Normalize any absolute/relative path to a repo-relative POSIX path, or null if
// it falls outside the repo.
function toRepoRel(p) {
  const abs = isAbsolute(p) ? p : resolve(repoRoot, p);
  const rel = relative(repoRoot, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split('\\').join('/');
}

// Dirty paths from porcelain, as a repo-relative set (rename -> destination).
function dirtySet(porcelain) {
  const set = new Set();
  for (const line of porcelain.split('\n')) {
    if (!line.trim()) continue;
    let p = line.slice(3).trim();
    if (p.includes(' -> ')) p = p.split(' -> ').pop();
    p = p.replace(/^"|"$/g, '');
    set.add(p);
  }
  return set;
}

// ── main (async for the stdin read) ───────────────────────────────────────────────
main();
async function main() {
  // ── CONCURRENCY GUARD (2026-08-06) — the defect this hook actually had ─────────
  // The scoping below is correct PER SESSION and still wrong on a SHARED tree: it commits
  // the files THIS session touched, but when two sessions are editing one working tree
  // those sets overlap, and whichever hook fires first commits the other session's
  // half-finished edit inside a `[auto]` message naming work it never did. That is
  // d06ca641 and 90d2a704 on 2026-08-05 — two commits nobody authored, two features each.
  //
  // So when another agent is demonstrably live in THIS worktree, and this worktree is the
  // shared main checkout, the auto-save does not run at all. The trade is deliberate and
  // one-sided: a missed auto-save is recoverable (the edits are still sitting in the tree,
  // and `npm run wip` saves them the moment a human asks), while a co-mingled commit cost
  // a day to unpick. When ambiguous, never commit — the same rule the scoping already
  // follows for an unreadable transcript.
  //
  // Scoped to the MAIN worktree on purpose: two agents in two LANES is the CORRECT
  // configuration, each with its own tree, index and branch, and must keep auto-saving.
  // Everything here fails OPEN — an unidentifiable session, an unreadable registry, or any
  // throw leaves single-session behaviour exactly as it was.
  if (isHook && !forceAll) {
    try {
      registerSession();   // also the heartbeat: Stop fires every turn, so a long session stays live
      const here = resolve(tryG('rev-parse --show-toplevel') || repoRoot);
      const peers = otherLiveSessionsHere(here);
      const shared = peers.length && samePath(here, mainWorktree());
      // Both outcomes are recorded, because a rate needs a denominator: a skip is the
      // event under suspicion, and proceeding-anyway is the evidence the guard is not
      // firing constantly. Costs one `ps` per Stop hook and cannot throw.
      logDetection({
        event: shared ? 'wip-skip' : 'wip-alone',
        peers, worktree: here, inMain: samePath(here, mainWorktree()),
      });
      if (shared) {
        log('wip: SKIPPING the auto-save — another agent is live in this same worktree:');
        for (const s of peers) log(`       · ${describeSession(s)}`);
        log('       Two sessions, one index: an auto-save here can commit the other session\'s');
        log('       half-finished edits under an [auto] message (d06ca641 / 90d2a704, 2026-08-05).');
        log('       Nothing is lost — your edits are still in the tree. Take your own worktree:');
        log('         npm run agent:new -- <name> --owns "<paths you are editing>"');
        log('       …or save deliberately once you know what is yours: npm run wip');
        process.exit(0);
      }
    } catch { /* fail open — never let the guard cost an auto-save in a solo session */ }
  }

  // throttle gate first (before any work)
  if (throttleMin > 0 && existsSync(STAMP)) {
    const last = Number(readFileSync(STAMP, 'utf8').trim()) || 0;
    const ageMin = (Date.now() - last) / 60000;
    if (last && ageMin < throttleMin) {
      log(`wip: throttled — last auto-save ${ageMin.toFixed(1)}m ago (< ${throttleMin}m), skipping.`);
      process.exit(0);
    }
  }

  const porcelain = tryGRaw('status --porcelain');
  if (!porcelain) {
    log('wip: working tree clean — nothing to save.');
    process.exit(0);
  }

  const branch = tryG('rev-parse --abbrev-ref HEAD') || 'HEAD';
  const isLane = branch.startsWith('lane/');

  // ── decide mode + the exact pathspec to stage ──────────────────────────────────
  const scoped = !forceAll && (isHook || !!process.env.WIP_PATHS);
  let pathspec = null;   // null => full `git add -A`; array => explicit scoped paths

  if (scoped) {
    // 1) explicit touched set (tests / agents), else 2) the session transcript
    let touched = null;
    if (process.env.WIP_PATHS) {
      touched = new Set(process.env.WIP_PATHS.split(/[\n,]/).map((s) => s.trim()).filter(Boolean));
    } else {
      const stdin = await readHookStdin();
      let transcriptPath = null;
      try { transcriptPath = stdin ? JSON.parse(stdin)?.transcript_path : null; } catch { transcriptPath = null; }
      touched = touchedFromTranscript(transcriptPath);
    }

    if (touched === null) {
      // hook context but we could not determine what this session touched -> ambiguous
      log('wip: scoped save but no touched-file signal (no WIP_PATHS, no readable transcript) — skipping rather than guess.');
      process.exit(0);
    }

    const dirty = dirtySet(porcelain);
    const touchedRel = new Set();
    for (const p of touched) { const r = toRepoRel(p); if (r) touchedRel.add(r); }
    pathspec = [...dirty].filter((d) => touchedRel.has(d));

    if (pathspec.length === 0) {
      log(`wip: nothing THIS session touched is dirty (${dirty.size} dirty file(s) belong to other work) — skipping.`);
      process.exit(0);
    }
  }

  // ── lock guard: back off if another git process holds the (per-worktree) index lock ──
  const gitDir = resolve(tryG('rev-parse --git-dir') || '.git');
  const INDEX_LOCK = join(gitDir, 'index.lock');
  for (let tries = 0; existsSync(INDEX_LOCK) && tries < 3; tries++) sleepSync(500);
  if (existsSync(INDEX_LOCK)) {
    log('wip: index.lock held by another git process — skipping this save.');
    process.exit(0);
  }

  // ── stage: EXPLICIT pathspec when scoped, full -A only in a deliberate manual/--all run ──
  try {
    if (pathspec) {
      // `git add -A -- <paths>` is scoped to the pathspec (handles adds/mods/deletes) —
      // NOT a blanket sweep. Paths go via argv (execFileSync), so no shell quoting hazard.
      execFileSync('git', ['add', '-A', '--', ...pathspec], { stdio: ['ignore', 'pipe', 'pipe'] });
    } else {
      g('add -A');   // manual / --all: deliberate full-tree save
    }
  } catch (e) {
    console.error('wip: staging failed:\n' + firstLine(e.stderr || e.message));
    process.exit(1);
  }

  // ground-truth the committed set from the index. SCOPED runs must ask the index only
  // about THEIR pathspec — a bare `diff --cached` reports another session's staged files
  // too, which is how `326ab23c` got a message claiming files it had no business touching.
  const stagedList = (pathspec
    ? execFileSync('git', ['diff', '--cached', '--name-only', '--', ...pathspec], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    : tryG('diff --cached --name-only')
  ).split('\n').map((s) => s.trim()).filter(Boolean);
  if (stagedList.length === 0) {
    log('wip: nothing staged after scoping — skipping.');
    process.exit(0);
  }

  // ── build the message from the ACTUAL staged files ─────────────────────────────
  const counts = {};
  for (const f of stagedList) { const a = areaOf(f); counts[a] = (counts[a] || 0) + 1; }
  const areas = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([a]) => a);
  const label = areas.slice(0, 3).join(' + ') + (areas.length > 3 ? ' +more' : '');
  const n = stagedList.length;
  const msg = `wip: ${label} (${n} file${n > 1 ? 's' : ''})${isLane ? ` {${branch}}` : ''} [auto]`;

  writeFileSync(MSGFILE, msg + '\n');
  try {
    if (pathspec) {
      // SCOPED: commit with an EXPLICIT pathspec. A bare `git commit` commits the WHOLE
      // INDEX, so scoping the staging alone was never enough — see the header note on
      // 326ab23c. `git commit -- <paths>` commits the working-tree content of those paths
      // and leaves every other staged entry sitting in the index, untouched. Deletions are
      // included (the path is tracked in HEAD and gone from the tree). Paths go via argv.
      execFileSync('git', ['commit', '-F', MSGFILE, '--', ...pathspec], { stdio: ['ignore', 'pipe', 'pipe'] });
    } else {
      g(`commit -F ${JSON.stringify(MSGFILE)}`);   // manual / --all: the whole index, deliberately
    }
  } catch (e) {
    const err = (e.stderr || e.stdout || e.message || '').toString().trim();
    console.error('wip: commit BLOCKED by a pre-commit guard — your work is STAGED but NOT committed:');
    console.error(err);
    console.error('   Fix the block above, then run `npm run wip` again. Nothing is lost (git diff --cached).');
    process.exit(1);
  }

  const sha = tryG('rev-parse --short HEAD');

  // ── push: MANUAL runs only. A hook must NEVER publish. ──────────────────────────
  // Rationale (2026-07-26): the Stop hook pushed `ab85628e` ("wip: .github + docs +
  // scripts (7 files) [auto]") to origin/dev, which put three deliberate, unjournaled
  // decisions on the trunk under an [auto] message and made the history unrewritable.
  // A local auto-commit is a recoverable safety net; an auto-PUSH is a publish action,
  // and a hook that fires on every Stop must not take one on the user's behalf. The
  // human-run `npm run wip` still pushes — that IS a deliberate act.
  let pushNote;
  if (isHook) {
    pushNote = 'local only — hooks never push (run `npm run wip` by hand, or push yourself)';
  } else {
    try { g(`push origin ${branch}`); pushNote = 'pushed'; }
    catch (e) { pushNote = `saved locally, push FAILED (${firstLine(e.stderr || e.message)})`; }
  }

  writeFileSync(STAMP, String(Date.now()));
  log(`wip: saved "${msg}" -> ${sha} on ${branch} (${pushNote}).`);
}

function areaOf(pathRaw) {
  let p = pathRaw.trim();
  if (p.includes(' -> ')) p = p.split(' -> ').pop();
  p = p.replace(/^"|"$/g, '');
  const seg = p.split('/');
  if (seg[0] === 'src') {
    if (seg[1] === 'components' && seg[2]) return seg[2];
    if (seg[1]) return seg[1];
    return 'src';
  }
  return seg[0] || 'root';
}
