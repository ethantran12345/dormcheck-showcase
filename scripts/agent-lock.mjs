#!/usr/bin/env node
/**
 * agent-lock - a cooperative, WARN-ONLY lock so parallel agent sessions in the
 * same worktree don't clobber each other's staged files (the 07-20 failure: one
 * agent's blanket `git add` swept another's staged work).
 *
 * It NEVER blocks a commit. Blocking commits is how work ends up uncommitted,
 * which is the disease this whole system cures. The lock is advisory: it makes a
 * live sibling session VISIBLE (in `npm run state`, in the pre-commit warning),
 * so an agent knows to commit with explicit paths instead of `git add -A`.
 *
 *   node scripts/agent-lock.mjs claim <label>   (npm run agent:claim <label>)
 *   node scripts/agent-lock.mjs release          (npm run agent:release)
 *   node scripts/agent-lock.mjs status
 *
 * Lock file: .git/dc-agent-lock  (JSON: {label, pid, iso}). A lock older than
 * STALE_MS (2h) is stale and auto-clears with a printed warning.
 *
 * ── SESSION REGISTRY + RESOURCE CLAIMS (added 2026-08-06) ───────────────────
 * The lock above is a lock a HUMAN OR AGENT REMEMBERS TO TAKE, which is the same
 * reason the lane system did nothing on 2026-08-05: nothing made it happen. So
 * this script also fronts the AUTOMATIC registry in scripts/lib/agent-registry.mjs,
 * which each session writes itself from its own hooks. One command surface, one
 * mental model — deliberately NOT a second lock script.
 *
 *   node scripts/agent-lock.mjs register [--label X]   # SessionStart hook
 *   node scripts/agent-lock.mjs unregister             # SessionEnd hook
 *   node scripts/agent-lock.mjs sessions [--json]      # who is live, per worktree
 *   node scripts/agent-lock.mjs detections [--json|--raw] [-n N]   # (npm run agent:detections)
 *                                                      # the peer-detection forensic log:
 *                                                      # how often a peer was claimed, and
 *                                                      # whether `ps` corroborated it. This
 *                                                      # is the measurement both open gates
 *                                                      # (a commit-time block, and
 *                                                      # tool-agnostic identity) wait on.
 *   node scripts/agent-lock.mjs db-claim [label]       # claim the ONE local Supabase stack
 *   node scripts/agent-lock.mjs db-release             # release it   (npm run agent:db:release)
 *
 * `claim` and `release` also register/unregister, so a labelled session shows up in
 * both views. Registry commands NEVER exit non-zero except `db-claim`, which is a real
 * gate: two concurrent `lane:bootstrap` runs against one stack is destructive.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  registerSession, unregisterSession, liveSessions, otherLiveSessionsHere, describeSession,
  claimResource, releaseResource, resourceHolder, resourceRefusalText, sessionIdentity,
  worktreeRoot, samePath, human, ageMs, RESOURCE_LOCAL_DB,
} from './lib/agent-registry.mjs';
import { logDetection, readDetections, summarize, formatSummary } from './lib/agent-detection-log.mjs';

const STALE_MS = 2 * 60 * 60 * 1000; // 2h

function gitDir() {
  try {
    return execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
  } catch {
    console.error('✗ not inside a git repository.');
    process.exit(0); // never hard-fail
  }
}
const LOCK = resolve(gitDir(), 'dc-agent-lock');

function readLock() {
  if (!existsSync(LOCK)) return null;
  try {
    return JSON.parse(readFileSync(LOCK, 'utf8'));
  } catch {
    return null; // corrupt → treat as absent
  }
}
// `ageMs` and `human` come from ./lib/agent-registry.mjs (imported above). This
// file used to redeclare both, which is a hard SyntaxError under ESM — the whole
// script failed to parse, so `agent:claim`/`agent:release` were dead and the
// multi-session guard they back was silently unavailable. The local `ageMs` also
// took a lock OBJECT while the imported one takes an ISO STRING, so the two call
// styles below are deliberate: always pass `.iso`.
const isStale = (lock) => ageMs(lock.iso) > STALE_MS;

const [, , cmd, ...rest] = process.argv;
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };

// ── session registry ────────────────────────────────────────────────────────
// Every one of these fails OPEN: an advisory view that throws would be worse than an
// advisory view that is silent, and `register` runs inside SessionStart.
if (cmd === 'register' || cmd === 'unregister' || cmd === 'sessions' || cmd === 'detections') {
  try {
    if (cmd === 'detections') {
      // The read side of the forensic log. `npm run agent:detections`.
      const nIdx = rest.findIndex((a) => a === '-n' || a === '--limit');
      const limit = nIdx >= 0 ? Number(rest[nIdx + 1]) || 0 : 0;
      const records = readDetections({ limit });
      if (rest.includes('--json')) { console.log(JSON.stringify(records, null, 2)); process.exit(0); }
      if (rest.includes('--raw')) { for (const r of records) console.log(JSON.stringify(r)); process.exit(0); }
      console.log(formatSummary(summarize(records)));
      process.exit(0);
    }
    if (cmd === 'register') {
      const entry = registerSession({ label: flag('--label') });
      if (!entry) {
        console.log('· session registry: could not identify this Claude session (no `claude` ancestor) — nothing recorded.');
      } else {
        const peers = otherLiveSessionsHere();
        console.log(`· registered session ${entry.id} in ${entry.worktree}${peers.length ? ` — ${peers.length} other live session(s) HERE` : ''}.`);
      }
    } else if (cmd === 'unregister') {
      // Log BEFORE the row goes away, and only when there was a row to remove: this record
      // is what makes an UNCLEAN death visible. A session that logged activity and never
      // logged an end, whose pid is now gone, died without deregistering — the case that
      // strands a stale row, and the only one worth proving. Absence is the signal, so the
      // record must be written on the clean path only.
      const before = liveSessions().find((s) => s.id === sessionIdentity().id) || null;
      if (before) logDetection({ event: 'session-end', peers: [], worktree: before.worktree, note: 'clean deregistration' });
      const { removed, released } = unregisterSession();
      console.log(removed ? `· unregistered session ${removed.id}.` : '· no registered session to remove.');
      if (released.length) console.log(`· released resource claim(s): ${released.join(', ')}.`);
    } else {
      const sessions = liveSessions();
      if (rest.includes('--json')) { console.log(JSON.stringify(sessions, null, 2)); process.exit(0); }
      const me = sessionIdentity();
      if (!sessions.length) console.log('· no registered live sessions.');
      for (const s of sessions) {
        const here = samePath(s.worktree, worktreeRoot()) ? ' [this worktree]' : '';
        console.log(`· ${describeSession(s)} in ${s.worktree}${s.id === me.id ? ' [me]' : ''}${here}`);
      }
      const db = resourceHolder(RESOURCE_LOCAL_DB);
      console.log(db
        ? `· ${RESOURCE_LOCAL_DB}: held by ${db.label} (pid ${db.pid}, ${human(ageMs(db.iso))} ago) at ${db.worktree}`
        : `· ${RESOURCE_LOCAL_DB}: free.`);
    }
  } catch (e) {
    console.log(`· session registry unavailable (${e.message}) — not blocking.`);
  }
  process.exit(0);
}

// ── the one HARD gate in this file: the single local Supabase stack ─────────
if (cmd === 'db-claim') {
  const label = rest.filter((a) => !a.startsWith('--')).join(' ').trim() || null;
  const res = claimResource(RESOURCE_LOCAL_DB, { label });
  if (!res.ok) {
    console.error('');
    console.error(resourceRefusalText(RESOURCE_LOCAL_DB, res.holder, { action: 'refusing to touch it.' }));
    process.exit(1);
  }
  if (res.stolen) console.warn(`⚠️  cleared a STALE ${RESOURCE_LOCAL_DB} claim from "${res.stolen.label}" (pid ${res.stolen.pid} is gone).`);
  console.log(`🔒 claimed ${RESOURCE_LOCAL_DB} as "${res.holder.label}". Release with: npm run agent:db:release`);
  process.exit(0);
}

if (cmd === 'db-release') {
  const res = releaseResource(RESOURCE_LOCAL_DB);
  console.log(res.released
    ? `🔓 released ${RESOURCE_LOCAL_DB} (was held by "${res.holder.label}"${res.mine ? '' : ' — NOT this session'}).`
    : `· ${RESOURCE_LOCAL_DB}: nothing to release.`);
  process.exit(0);
}

if (cmd === 'claim') {
  const label = rest.join(' ').trim() || `session-${process.pid}`;
  const existing = readLock();
  if (existing && existing.pid !== process.pid) {
    if (isStale(existing)) {
      console.warn(`⚠️  clearing STALE lock held by "${existing.label}" (pid ${existing.pid}, ${human(ageMs(existing.iso))} old).`);
    } else {
      // WARN-ONLY: a live sibling session holds the lock. Claim anyway (last wins),
      // but make the collision loud so the agent uses explicit `git add <path>`.
      console.warn('╔══════════════════════════════════════════════════════════════╗');
      console.warn(`║ ⚠️  ANOTHER SESSION HOLDS THE LOCK: "${existing.label}"`);
      console.warn(`║     pid ${existing.pid}, claimed ${human(ageMs(existing.iso))} ago.`);
      console.warn('║     Commit with EXPLICIT paths (git add <path> ...), never git add -A.');
      console.warn('╚══════════════════════════════════════════════════════════════╝');
    }
  }
  writeFileSync(LOCK, JSON.stringify({ label, pid: process.pid, iso: new Date().toISOString() }, null, 2) + '\n');
  // A label is the one thing the automatic registry cannot infer, so carry it across.
  try { registerSession({ label }); } catch { /* advisory — never fail a claim on it */ }
  console.log(`🔒 claimed repo lock as "${label}" (pid ${process.pid}). Release with: npm run agent:release`);
  process.exit(0);
}

if (cmd === 'release') {
  const existing = readLock();
  try {
    const { released } = unregisterSession();
    if (released.length) console.log(`· released resource claim(s): ${released.join(', ')}.`);
  } catch { /* advisory */ }
  if (!existing) {
    console.log('· no lock to release.');
    process.exit(0);
  }
  rmSync(LOCK, { force: true });
  console.log(`🔓 released lock "${existing.label}" (pid ${existing.pid}).`);
  process.exit(0);
}

// status (also used by the reporter + pre-commit hook)
const lock = readLock();
if (!lock) {
  console.log('· repo lock: free.');
} else if (isStale(lock)) {
  console.log(`· repo lock: STALE "${lock.label}" (pid ${lock.pid}, ${human(ageMs(lock.iso))} old) — will auto-clear on next claim.`);
} else {
  console.log(`· repo lock: held by "${lock.label}" (pid ${lock.pid}, ${human(ageMs(lock.iso))} ago).`);
}
process.exit(0);
