/**
 * agent-registry — "who else is live IN THIS WORKTREE?", answered mechanically.
 *
 * WHY THIS EXISTS (2026-08-06). Ethan starts extra agents by opening a new Herd tab and
 * running Claude in the repo root. Every tab therefore shares ONE working tree.
 * On 2026-08-05 four sessions did exactly that and the `[auto]` wip Stop hook swept work
 * BETWEEN them into d06ca641 and 90d2a704 — two commits nobody authored, each holding two
 * sessions' work. The lane system already prevents this and was simply never invoked.
 *
 * The pre-existing signal — `pgrep -x claude` in scripts/lib/agent-sessions.mjs — cannot
 * be used as a gate and says so itself: it counts sessions in OTHER repos, counts helper
 * processes, and above all cannot tell which WORKTREE a pid belongs to. This registry can,
 * because each session REGISTERS itself with the worktree it is sitting in.
 *
 * DESIGN RULES, each one load-bearing:
 *
 *  1. NO DEPENDENCIES. This module is imported by scripts/wip.mjs, which runs as the Stop
 *     hook on every turn. It must not be able to break the auto-save. Node builtins only —
 *     deliberately NOT scripts/lib/lanes.mjs, which pulls in `minimatch`.
 *
 *  2. IDENTITY IS THE CLAUDE CLI PROCESS. A session's hooks are separate short-lived
 *     processes, so the hook's own pid is useless as an identity. The nearest ANCESTOR
 *     whose process name is `claude` is the CLI session itself: stable across every hook
 *     firing within a session, distinct per Herd tab, and dead the instant the tab closes.
 *     (`sessionAnchor()` in lanes.mjs deliberately anchors HIGHER, to the terminal, where
 *     all tabs of one app share a pid — the wrong granularity for this question.)
 *
 *  3. UNRESOLVED IDENTITY REGISTERS NOTHING. If the ancestor walk cannot find a `claude`
 *     process (no `ps`, Windows, an exotic launcher), we do not invent an identity and we
 *     do not write an entry. A guessed identity is worse than no entry: it would not be
 *     stable across hook firings, so ONE session would register TWICE and read as
 *     concurrency, which is precisely the false positive that must never happen — see 4.
 *
 *  4. FAIL OPEN, ALWAYS. Every read is wrapped; a missing, corrupt or unwritable registry
 *     reports "no peers" rather than throwing. The costs are asymmetric: a missed warning
 *     is a return to today's behaviour, while a false peer would silently disable a solo
 *     session's auto-save — the one regression this whole pass is forbidden to cause.
 *
 * STORAGE: <git-common-dir>/dc-agent-sessions.json — the COMMON dir, so every lane
 * worktree and the main checkout read one registry (the same reason dc-lanes.json lives
 * there), and untracked by construction. Shape:
 *
 *   { sessions: [{ id, label, pid, worktree, source, startedAt, lastSeen }],
 *     resources: { "<name>": { holder, label, pid, worktree, iso } } }
 *
 * `resources` is the DATABASE claim: there is exactly ONE local Supabase stack, so two
 * concurrent `lane:bootstrap` runs collide (one session had its DB container stopped
 * mid-run on 2026-08-05). That one is a real gate, not a warning — see claimResource().
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, renameSync, rmSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';

// A session that has not heartbeat in this long is treated as gone. Matches the lane
// system's LANE_INACTIVE_MS on purpose: one repo, one idea of "still there".
export const SESSION_IDLE_MS = (Number(process.env.DC_SESSION_IDLE_MIN) || 90) * 60 * 1000;
// A resource claim outlives individual hook firings, so it gets a longer leash than a
// session heartbeat — but never an unbounded one. pid death clears it immediately.
export const RESOURCE_STALE_MS = 12 * 60 * 60 * 1000;
// The one local Supabase stack: `supabase start` / `db reset` / :54322 / the seeded users.
export const RESOURCE_LOCAL_DB = 'local-supabase';

// ── tiny git + path helpers (no imports beyond node builtins — see design rule 1) ──
function git(args, opts = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts }).trim();
  } catch { return ''; }
}
export function commonDir() { return resolve(git(['rev-parse', '--git-common-dir']) || '.git'); }
export function worktreeRoot(cwd = process.cwd()) { return git(['rev-parse', '--show-toplevel'], { cwd }); }
export function mainWorktree() {
  const first = git(['worktree', 'list', '--porcelain']).split('\n')[0] || '';
  return first.startsWith('worktree ') ? first.slice(9).trim() : worktreeRoot();
}
// Compare paths by IDENTITY, not string: on macOS the registry can hold /var/folders/…
// while git reports /private/var/folders/… for the same directory (the trap already
// documented in lib/lanes.mjs samePath).
const realOrResolved = (p) => { try { return realpathSync(resolve(p)); } catch { return resolve(p); } };
export function samePath(a, b) { return !!a && !!b && realOrResolved(a) === realOrResolved(b); }
export const ageMs = (iso) => Date.now() - new Date(iso || 0).getTime();
export function human(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}
export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }   // EPERM: alive, just not ours to signal
}

// ── identity ─────────────────────────────────────────────────────────────────────
// `ps -o ppid=,comm= -p <pid>` → the parent pid and process name OF <pid>.
function procInfo(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const m = /^(\d+)\s+(.*)$/.exec(out);
    return m ? { ppid: Number(m[1]) || 0, comm: m[2] } : null;
  } catch { return null; }
}
// The CLI's process name is a bare `claude`; installs launched from the app bundle show a
// path under …/claude-code/<version>/claude.app/. Both are the session process. Anything
// else (node, zsh, the terminal) is not.
function isClaudeProcess(comm = '') {
  const c = comm.trim();
  const base = c.split('/').filter(Boolean).pop() || '';
  return base === 'claude' || base === 'claude.exe' || c.includes('/claude-code/');
}
export function claudeAncestorPid() {
  let pid = process.pid;
  for (let i = 0; i < 24 && pid > 1; i++) {
    const info = procInfo(pid);
    if (!info) return 0;                       // walk dead-ended — no honest answer
    if (isClaudeProcess(info.comm)) return pid;
    pid = info.ppid;
  }
  return 0;
}

/**
 * Who am I? Returns { id, pid, source, resolved }.
 *
 * `resolved: false` means we could not identify the session. Callers must then behave as
 * if there were no registry at all (design rules 3 + 4) — never register, never skip.
 * DC_AGENT_SESSION_ID / DC_AGENT_SESSION_PID exist so tests can stage two sessions
 * deterministically without spawning two Claude CLIs.
 */
export function sessionIdentity() {
  const forced = process.env.DC_AGENT_SESSION_ID
    || process.env.CLAUDE_SESSION_ID
    || process.env.CLAUDE_AGENT_SESSION;
  if (forced) {
    const pid = Number(process.env.DC_AGENT_SESSION_PID) || claudeAncestorPid() || 0;
    return { id: `session:${forced}`, pid, source: 'env', resolved: true };
  }
  const pid = claudeAncestorPid();
  if (pid) return { id: `cli:${pid}`, pid, source: 'ancestor', resolved: true };
  return { id: null, pid: 0, source: 'unknown', resolved: false };
}

// ── registry I/O (fail-open on every path) ───────────────────────────────────────
export function registryPath() { return join(commonDir(), 'dc-agent-sessions.json'); }

const EMPTY = () => ({ sessions: [], resources: {} });

export function readRegistry() {
  try {
    const f = registryPath();
    if (!existsSync(f)) return EMPTY();
    const j = JSON.parse(readFileSync(f, 'utf8'));
    return {
      sessions: Array.isArray(j.sessions) ? j.sessions : [],
      resources: j.resources && typeof j.resources === 'object' ? j.resources : {},
    };
  } catch { return EMPTY(); }
}

// Write via a temp file + rename so a concurrent reader never sees a half-written file
// (the same reasoning as the ship lock's link-into-place in lib/lanes.mjs).
export function writeRegistry(reg) {
  try {
    const f = registryPath();
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ sessions: reg.sessions || [], resources: reg.resources || {} }, null, 2) + '\n');
    try { renameSync(tmp, f); } finally { rmSync(tmp, { force: true }); }
    return true;
  } catch { return false; }
}

export function sessionIsLive(s) {
  if (!s || !s.id) return false;
  if (s.pid && !pidAlive(s.pid)) return false;      // the tab is gone — certainly dead
  return ageMs(s.lastSeen || s.startedAt) <= SESSION_IDLE_MS;
}

// Drop dead sessions and resource claims whose holder died. Pure: returns a new registry
// plus what it removed, so callers decide whether to persist.
export function reapRegistry(reg = readRegistry()) {
  const removed = [];
  const sessions = (reg.sessions || []).filter((s) => {
    if (sessionIsLive(s)) return true;
    removed.push(s);
    return false;
  });
  const resources = {};
  const releasedResources = [];
  for (const [name, holder] of Object.entries(reg.resources || {})) {
    const stale = !holder || (holder.pid && !pidAlive(holder.pid)) || ageMs(holder.iso) > RESOURCE_STALE_MS;
    if (stale) { releasedResources.push({ name, holder }); continue; }
    resources[name] = holder;
  }
  return { reg: { sessions, resources }, removed, releasedResources };
}

/**
 * Record (or refresh) THIS session. Idempotent: the same session re-registering — a new
 * turn's Stop hook, or `/clear` re-firing SessionStart in the same tab — updates its own
 * row rather than adding a second one, because the id is the CLI pid.
 *
 * Returns the entry, or null when identity is unresolved (design rule 3).
 */
export function registerSession({ label = null, worktree = null } = {}) {
  const me = sessionIdentity();
  if (!me.resolved) return null;
  const wt = worktree || worktreeRoot();
  if (!wt) return null;
  const { reg } = reapRegistry();
  const now = new Date().toISOString();
  const existing = reg.sessions.find((s) => s.id === me.id);
  const entry = existing || { id: me.id, startedAt: now };
  entry.pid = me.pid;
  entry.source = me.source;
  entry.worktree = wt;
  entry.lastSeen = now;
  if (label) entry.label = label;
  if (!existing) reg.sessions.push(entry);
  writeRegistry(reg);
  return entry;
}

/** Refresh lastSeen only if already registered. Never creates a row. */
export function heartbeatSession() {
  const me = sessionIdentity();
  if (!me.resolved) return null;
  const { reg } = reapRegistry();
  const entry = reg.sessions.find((s) => s.id === me.id);
  if (!entry) return null;
  entry.lastSeen = new Date().toISOString();
  writeRegistry(reg);
  return entry;
}

/** Remove this session and release anything it holds. Safe to call when unregistered. */
export function unregisterSession() {
  const me = sessionIdentity();
  if (!me.resolved) return { removed: null, released: [] };
  const { reg } = reapRegistry();
  const idx = reg.sessions.findIndex((s) => s.id === me.id);
  const removed = idx >= 0 ? reg.sessions.splice(idx, 1)[0] : null;
  const released = [];
  for (const [name, holder] of Object.entries(reg.resources)) {
    if (holder?.holder === me.id) { delete reg.resources[name]; released.push(name); }
  }
  writeRegistry(reg);
  return { removed, released };
}

export function liveSessions() {
  const { reg, removed, releasedResources } = reapRegistry();
  // A read is also the cheapest reliable cleanup point. Previously callers filtered
  // dead rows in memory but left them on disk, so raw census/reporting paths kept
  // rediscovering sessions that every liveness-aware caller already considered gone.
  if (removed.length || releasedResources.length) writeRegistry(reg);
  return reg.sessions;
}

/**
 * The question every caller in this pass actually asks: is another agent live in the SAME
 * working tree as me? Two agents in two LANES is the correct configuration and must never
 * trip anything, so the worktree comparison is the whole point.
 *
 * Returns [] whenever our own identity is unresolved — with no stable id we cannot exclude
 * ourselves, and counting ourselves as a peer is the forbidden false positive.
 */
export function otherLiveSessionsHere(worktree = worktreeRoot()) {
  const me = sessionIdentity();
  if (!me.resolved || !worktree) return [];
  return liveSessions().filter((s) => s.id !== me.id && samePath(s.worktree, worktree));
}

export function describeSession(s) {
  const name = s.label ? `"${s.label}"` : s.id;
  return `${name} (pid ${s.pid || '?'}, last seen ${human(ageMs(s.lastSeen || s.startedAt))} ago)`;
}

// ── resource claims (the DATABASE gate) ──────────────────────────────────────────
export function resourceHolder(name) {
  const { reg, releasedResources } = reapRegistry();
  if (releasedResources.length) writeRegistry(reg);
  return reg.resources[name] || null;
}

/**
 * Claim an exclusive resource. Unlike the session registry this is a GATE: `{ ok: false }`
 * means the caller must refuse, because the failure it prevents is destructive (a second
 * `supabase db reset` wiping the stack a live session is verifying against).
 *
 * Re-claiming a resource you already hold succeeds — `lane:bootstrap` then `lane:verify`
 * in one session is the normal flow. A claim whose holder pid is dead is stolen with a
 * note: a lock nobody is behind is a deadlock, and this repo has paid for one already.
 */
export function claimResource(name, { label = null } = {}) {
  const me = sessionIdentity();
  const wt = worktreeRoot();
  const { reg, releasedResources } = reapRegistry();
  const stolen = releasedResources.find((r) => r.name === name)?.holder || null;
  const holder = reg.resources[name];
  if (holder && (!me.resolved || holder.holder !== me.id)) {
    return { ok: false, holder, mine: false };
  }
  reg.resources[name] = {
    holder: me.resolved ? me.id : `unidentified:${process.pid}`,
    label: label || holder?.label || me.id || `pid ${process.pid}`,
    pid: me.pid || process.pid,
    worktree: wt,
    iso: new Date().toISOString(),
  };
  writeRegistry(reg);
  return { ok: true, holder: reg.resources[name], stolen, renewed: !!holder };
}

export function releaseResource(name) {
  const me = sessionIdentity();
  const { reg } = reapRegistry();
  const holder = reg.resources[name];
  if (!holder) { writeRegistry(reg); return { released: false, holder: null }; }
  const mine = me.resolved && holder.holder === me.id;
  delete reg.resources[name];
  writeRegistry(reg);
  return { released: true, holder, mine };
}

/** The shared refusal text, so bootstrap and verify name the same holder and the same exits. */
export function resourceRefusalText(name, holder, { action = 'refusing.' } = {}) {
  const out = [];
  out.push(`✗ the ${name} stack is claimed by another session — ${action}`);
  out.push('');
  out.push(`    holder   ${holder.label || holder.holder}`);
  out.push(`    pid      ${holder.pid}`);
  out.push(`    worktree ${holder.worktree}`);
  out.push(`    claimed  ${human(ageMs(holder.iso))} ago`);
  out.push('');
  out.push('  There is exactly ONE local Supabase stack. Running a second `db reset` against it');
  out.push('  wipes the data the holder is verifying against, and can stop its container mid-run.');
  out.push('');
  out.push('  Wait for that session, or — once you have confirmed it is finished — release it:');
  out.push(`    npm run agent:db:release`);
  return out.join('\n');
}
