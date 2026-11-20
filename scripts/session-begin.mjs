#!/usr/bin/env node
/**
 * session-begin — the SessionStart orientation hook. Fires via .claude/settings.json
 * at the top of EVERY Claude Code session so no session starts blind, and so a session
 * editing the MAIN worktree while another lane is live gets a loud warning to start its
 * own lane. Built 2026-07-21, after a day where every session edited the main worktree
 * directly and got zero lane protection: the lane system only guards work if an agent
 * runs lane:start, and nothing made that happen. This closes that gap at session start.
 *
 *   npm run session:begin            (also the SessionStart hook command)
 *
 * Two jobs, in order:
 *   1. ORIENT — print `npm run state` (where work lives + recovery) and `npm run brief`
 *      (recent commits, lanes, decisions), so every session is caught up automatically.
 *   2. WARN — if a lane is live AND this is the main worktree, print a loud notice to
 *      start your own lane before editing.
 *
 * As the HOOK it never blocks (exit 0) and NEVER auto-creates a lane — Ethan may just be
 * looking around, and a hook that mutates git or fails session start would be its own
 * hazard. Run MANUALLY (`npm run session:begin`) it additionally REFUSES, exit 1, while a
 * lane is OVERDUE (>24h). The hook sets DC_SESSION_HOOK=1 to opt out of the refusal and
 * still prints the same banner, so the escalation is loud in both modes and fatal only
 * where a non-zero exit cannot break anything.
 */
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { readLanes, mainRoot, tryGit, human, ageMs, commonDir, laneIsLive, overdueBlockText, stagedSnapshotPath } from './lib/lanes.mjs';
import { activeClaudeCliSessions, describeCliSessions, ZOMBIE_AGE_MS } from './lib/agent-sessions.mjs';
import { registerSession, otherLiveSessionsHere, describeSession, liveSessions, claudeAncestorPid } from './lib/agent-registry.mjs';
import { logDetection } from './lib/agent-detection-log.mjs';

// Capture a child's output whether it exits 0 or non-zero (repo-state can exit 1 under
// STRICT; we don't set STRICT, but never let a child's exit code abort orientation).
const run = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return (e.stdout || '').toString(); }
};

// Anchor "the session's first commit" for `npm run wrap` (SessionEnd): record HEAD at
// session start in the git common-dir. wrap defaults its range to <this sha>..HEAD.
try { writeFileSync(join(commonDir(), 'dc-session-start'), (tryGit('rev-parse HEAD') || '') + '\n'); } catch { /* best-effort */ }

// ── INHERITED INDEX SNAPSHOT (the staged-index guard's evidence) ─────────────
// Anything already in the index at session start was staged by SOMEBODY ELSE — this
// session has not run yet. Recording it here is what lets pre-commit tell "my work"
// from "the previous session's work" without hooking `git add`, which git gives us no
// way to do. On 2026-08-16 a killed session left repo-state.mjs, MarketplaceTab.tsx and
// marketplaceFeedQuery.test.ts staged in main; a blanket `git add -A` by the next
// session would have swept 138 lines of someone else's work into an unrelated commit.
//
// Per WORKTREE, not per repo: each worktree has its own index, and a lane's inherited
// set has nothing to do with main's. Written even when empty — an absent file means
// "no session has started here", which pre-commit must not confuse with "clean".
try {
  const wt = tryGit('rev-parse --show-toplevel') || '.';
  const staged = (tryGit('diff --cached --name-only') || '').split('\n').map((s) => s.trim()).filter(Boolean);
  writeFileSync(stagedSnapshotPath(wt), JSON.stringify({
    worktree: resolve(wt), pid: process.pid, at: new Date().toISOString(), inherited: staged,
  }, null, 2) + '\n');
} catch { /* best-effort: the guard fails OPEN, never blocking a commit it cannot reason about */ }

const out = [];
const p = (s = '') => out.push(s);
const hookMode = process.env.DC_SESSION_HOOK === '1';

// ── 1. ORIENT — fetch first, then run the two catch-up commands ───────────
// Without this, state/brief can confidently report stale origin/dev references.
p(run('node scripts/remote-awareness.mjs check --quiet').replace(/\n+$/, ''));
if (hookMode) {
  const branch = tryGit('rev-parse --abbrev-ref HEAD') || '(detached)';
  const dirt = (tryGit('status --porcelain') || '').split('\n').filter(Boolean).length;
  const lanes = readLanes();
  p('AGENT WORKFLOW v2 — prompt → session → ownership → execute → validate → wrap');
  p(`  repo: ${branch}, ${dirt ? `${dirt} uncommitted change(s)` : 'clean'} · lanes: ${lanes.length} registered/${lanes.filter((l) => laneIsLive(l)).length} live`);
  p(`  latest: ${tryGit('log -1 --oneline') || 'unknown'}`);
  p('  start: state Task / Context / Reference; inspect ownership before editing.');
  p('  detail on demand: npm run state · npm run brief · npm run lane:status');
} else {
  p(run('node scripts/repo-state.mjs').replace(/\n+$/, ''));
  p('');
  p(run('node scripts/brief.mjs').replace(/\n+$/, ''));
}

// ── 2. WRITER CHECK + lane warning ───────────────────────────────────────────
const here = resolve(tryGit('rev-parse --show-toplevel') || '.');
const inMain = here === resolve(mainRoot());
const liveLanes = readLanes().filter((l) => laneIsLive(l));
const sessions = activeClaudeCliSessions();

// REGISTER THIS SESSION (2026-08-06). The pgrep count below has always been unusable as
// anything but a nudge — by its own admission it cannot tell which worktree a pid belongs
// to. Registering here makes the question answerable: every session records the worktree
// it is sitting in, so "another agent is editing the SAME tree" becomes a fact rather than
// an inference. Failing to register is never fatal — orientation must not depend on it.
let peersHere = [];
try {
  registerSession({ label: process.env.DC_AGENT_LABEL || null });
  peersHere = otherLiveSessionsHere(here);
} catch { /* advisory only */ }

// RECORD THE DECISION, whatever it was (2026-08-06). The banner below is advisory and the
// proposal that shipped it says a gate needs a KNOWN false-positive rate first — which
// nothing was measuring, because this banner printed to a terminal and then stopped
// existing. One line per evaluation, with the `ps` evidence behind each claimed peer, is
// what turns "I don't recall a bad one" into a number. Never blocks: logDetection swallows
// its own errors. See scripts/lib/agent-detection-log.mjs.
logDetection({ event: 'session-begin', peers: peersHere, worktree: here, inMain });

// ── 2.1 THE CENSUS — printed ALWAYS, in every worktree, every session ────────
// Moved here from the session prompts on 2026-08-16. Four runs in a row were corrupted
// by a concurrent session, each time with a handoff that TOLD the agent to check first;
// intent that has failed four times is not a mechanism. The census is unconditional so
// it cannot be omitted by a prompt that forgot to ask for it, and so "I was solo" is a
// measurement printed on screen rather than an assumption.
//
// Everything here is read-only and costs one pgrep + one ps + two small JSON reads.
{
  const rule = '━'.repeat(74);
  const registered = (() => { try { return liveSessions(); } catch { return []; } })();
  const procs = sessions.available ? describeCliSessions(sessions.pids) : [];
  // WHICH PID IS ME. process.pid is this node script, not the CLI that spawned it, so
  // self-identification walks up to the `claude` ancestor. 0 means "could not tell" —
  // in that case nothing is marked as self, and nothing is called a zombie either,
  // because the session most likely to be old is the one asking.
  const mePid = (() => { try { return claudeAncestorPid(); } catch { return 0; } })();
  const byPid = new Map(registered.map((s) => [s.pid, s]));
  const lanes = readLanes();
  const live = lanes.filter((l) => laneIsLive(l));
  const worktrees = (run('git worktree list') || '').split('\n').filter(Boolean);

  // A session is a PROBABLE zombie when it is old AND has no recent heartbeat. Both
  // halves are required: age alone would flag a long, actively-worked session (this one
  // is usually the oldest process on the list), and a missing heartbeat alone would flag
  // every session started before the registry existed.
  const zombies = [];
  p('');
  p(rule);
  p('👥  SESSION CENSUS');
  p(rule);
  if (!sessions.available) {
    p('   CLI sessions   unknown (pgrep unavailable — census degraded, not silent)');
  } else {
    p(`   CLI sessions   ${procs.length}`);
    for (const s of procs) {
      const reg = byPid.get(s.pid);
      const seen = reg ? `last seen ${human(ageMs(reg.lastSeen || reg.startedAt))} ago` : 'not registered';
      const isMe = s.pid === mePid;
      const old = s.elapsedMs >= ZOMBIE_AGE_MS;
      const quiet = !reg || ageMs(reg.lastSeen || reg.startedAt) >= ZOMBIE_AGE_MS;
      // mePid === 0 means self-identification failed; call nothing a zombie rather than
      // risk telling Ethan to kill the session he is typing into. The pid floor is a
      // belt-and-braces stop on ever printing `kill 1`: comm-matching should make a
      // system pid unreachable here, but "should" is not what this file is for.
      const zombie = old && quiet && !isMe && mePid !== 0 && s.pid > 100;
      if (zombie) zombies.push(s);
      p(`     · pid ${String(s.pid).padEnd(7)} ${String(s.tty).padEnd(9)} up ${String(s.etime).padEnd(11)} ${seen}${zombie ? '   ⚠ PROBABLE ZOMBIE' : ''}${isMe ? '   ← this session' : ''}`);
    }
  }
  p(`   Lanes          ${lanes.length} registered, ${live.length} live`);
  for (const l of lanes) p(`     · ${l.name.padEnd(28)} ${l.status}${l.status === 'live' ? `  owns: ${(l.owns || []).join(', ')}` : ''}`);
  p(`   Worktrees      ${worktrees.length}`);
  for (const w of worktrees) p(`     · ${w}`);
  p(rule);

  // MORE THAN ONE SESSION → loud, and it names them. Overridable for deliberate
  // multi-session work, but never silently: the override prints that it is in effect,
  // because an override you cannot see is indistinguishable from a guard that broke.
  const others = procs.filter((s) => s.pid !== mePid);
  if (sessions.available && others.length) {
    if (process.env.DC_MULTI_SESSION === '1') {
      p('');
      p(`   ⓘ  ${others.length} other CLI session(s) — allowed by DC_MULTI_SESSION=1 (deliberate multi-session work).`);
      p('      Each session should be in its OWN worktree. Shared main = shared index.');
    } else {
      p('');
      p(rule);
      p(`⛔  ${others.length + 1} CLAUDE CLI SESSIONS ARE LIVE — YOU ARE NOT ALONE`);
      p(rule);
      for (const s of others) {
        const reg = byPid.get(s.pid);
        p(`   · pid ${s.pid} on ${s.tty}, up ${s.etime}${reg ? ` (${reg.label || reg.id}, in ${reg.worktree})` : ' (unregistered — worktree unknown)'}`);
      }
      p('');
      if (zombies.length) {
        p(`   ${zombies.length} of these look like ZOMBIES (>${Math.round(ZOMBIE_AGE_MS / 3.6e6)}h old, no recent heartbeat):`);
        for (const z of zombies) p(`     kill ${z.pid}     # ${z.tty}, up ${z.etime}`);
        p('');
        p('   Confirm before killing: a Ctrl-Z\'d session shows STAT "T" and is ALIVE, not dead.');
        p('   Killing four of those on 2026-08-05 cost a day of work.');
        p('');
      }
      p('   Two sessions in one worktree share ONE index. A `git add -A` in either sweeps');
      p('   the other\'s staged work into an unrelated commit — that is d06ca641 and');
      p('   90d2a704 on 2026-08-05, and 138 lines left staged on 2026-08-16.');
      p('');
      p('   Take your own worktree before editing:');
      p('     npm run agent:new -- <name> --owns "<paths you will edit>"');
      p('');
      p('   Deliberately running several sessions? Say so, once, and this stays quiet:');
      p('     export DC_MULTI_SESSION=1');
      p(rule);
    }
  }
}

// ADVISORY, NOT A BLOCK — deliberately. A hard block on a false positive strands Ethan
// mid-task with no escape, and an agent that meets one reaches for LANE_MAIN_RECOVERY=1 or
// --no-verify, which is worse than the co-mingling it was trying to prevent. The registry
// earns a gate only after its false-positive rate is known.
if (inMain && peersHere.length) {
  const rule = '━'.repeat(74);
  p('');
  p(rule);
  p('⛔  ANOTHER AGENT IS ALREADY LIVE IN THIS WORKING TREE');
  p(rule);
  for (const s of peersHere) p(`   · ${describeSession(s)}`);
  p('');
  p('   You are both in the MAIN worktree. One shared index, one shared branch: the');
  p('   auto-save hook, `git add -A`, and any commit here can sweep up the other');
  p('   session\'s half-finished edits. That is exactly how d06ca641 and 90d2a704');
  p('   landed on dev on 2026-08-05 — two commits nobody authored, holding two');
  p('   sessions\' work each, and a day to unpick.');
  p('');
  p('   Before you EDIT anything, take your own worktree — one command:');
  p('');
  p('     npm run agent:new -- <name> --owns "<paths you will edit>"');
  p('');
  p('   …then `cd` into the path it prints, in THIS tab, before working.');
  p('   (Auto-save is already suspended here while two sessions share this tree.)');
  p('');
  p('   Just reading? Ignore this. Nothing is blocked and no lane is created for you.');
  p(rule);
} else if (inMain && sessions.available && sessions.pids.length > 1) {
  const rule = '━'.repeat(74);
  p('');
  p(rule);
  p('⚠  MULTIPLE CLAUDE CLI SESSIONS ARE ACTIVE');
  p(rule);
  p(`   ${sessions.pids.length} CLI sessions: ${sessions.pids.join(', ')}`);
  p('   Before editing, close inactive sessions or confirm every other writer is');
  p('   working in its own lane. This is advisory: it cannot identify a process\'s');
  p('   worktree and never closes a session automatically.');
  p('   (Counts CLI sessions only; Claude.app helper processes are excluded.)');
  p(rule);
}

if (inMain && liveLanes.length) {
  const rule = '━'.repeat(74);
  p('');
  p(rule);
  p('⚠  A LANE IS LIVE AND YOU ARE IN THE MAIN WORKTREE');
  p(rule);
  for (const l of liveLanes) {
    const owns = (l.owns || []).join(', ') || '(no owned globs declared)';
    p(`   · lane "${l.name}" (${human(ageMs(l.startedAt))} old) owns: ${owns}`);
  }
  p('');
  p('   The lane system only protects work when you run lane:start. If you will');
  p('   EDIT files, start your own lane first so you physically cannot collide');
  p('   with the live lane(s) above:');
  p('');
  p("     npm run lane:start <name> --owns '<glob>,<glob>'");
  p('');
  p('   Just looking, or working read-only? Ignore this — solo work commits');
  p('   straight to dev. This never blocks and never makes a lane for you.');
  p(rule);
}

// ── 2.5 OTHER AGENT SESSIONS, ANYWHERE ON THIS MAC (2026-08-06) ──────────────
// The lane and registry checks above only see THIS repo. They cannot see a session
// working in command-center or in the vault — and those collide too, the same afternoon,
// on the same facts, with nothing to reveal it until the next batch sync (Session Brief
// 1×/day, journal 11pm, git manual). Every session already heartbeats to Supabase
// `agent_activity`; this is the read side of a signal that was already being written.
//
// Advisory and silent by default: --quiet prints NOTHING unless a peer session moved in
// the last few minutes, so an offline start, a Supabase outage or a quiet afternoon all
// look identical (blank). The script never exits non-zero — see its header comment.
try {
  const roster = run(`node ${JSON.stringify(join(process.env.HOME || '', '.agent-tools/whos-working.mjs'))} --quiet --hours 6`).trim();
  if (roster) { p(''); p(roster); }
} catch { /* orientation must never depend on a cloud table being reachable */ }

// ── 3. BROWSER — ensure the Playwright-MCP CDP endpoint, never touching Chrome ─
// Last on purpose: this section is chatty-at-worst, and must never push the lane
// warning above off the top of the screen. Fully advisory — see scripts/chrome-cdp.mjs.
try {
  const cdp = run('node scripts/chrome-cdp.mjs').trim();
  if (cdp) { p(''); p(cdp); }
} catch { /* a browser helper must never affect session start */ }

// ── 4. OVERDUE LANES — the one escalation this script is allowed to fail on ───
// Printed last so it is the final thing on screen, and evaluated against ALL registered
// lanes (a rotting lane is normally parked, so `liveLanes` above would miss it).
const overdueText = overdueBlockText({
  action: 'a lane left open past its session is now blocking new lanes.',
});
if (overdueText) {
  const rule = '━'.repeat(74);
  p('');
  p(rule);
  p('⛔  OVERDUE LANE — ESCALATED');
  p(rule);
  p(overdueText);
  p(rule);
}

process.stdout.write(out.join('\n') + '\n');
// The SessionStart hook passes DC_SESSION_HOOK=1 and always exits 0: a hook that fails
// session start would be a worse hazard than the lane it is complaining about. Invoked by
// hand, the same condition is a refusal — that is the consequence the rule never had.
process.exit(overdueText && process.env.DC_SESSION_HOOK !== '1' ? 1 : 0);
