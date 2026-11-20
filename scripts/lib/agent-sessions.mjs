/**
 * Read-only visibility into active Claude Code CLI sessions.
 *
 * Do NOT use `ps | grep claude`: that also counts Claude.app's renderer and helper
 * processes. Exact `claude` executables correspond to interactive CLI/app sessions
 * that can invoke a writer. This is advisory only; we cannot infer a process's
 * worktree safely, and must never terminate a user's session automatically.
 */
import { execFileSync } from 'node:child_process';

/**
 * MEASURED BLIND, 2026-08-16 — this used `pgrep -x claude` and returned NOTHING while a
 * `claude` CLI was demonstrably running (pid 18785, `ps -o comm=` → `claude`). Every
 * caller therefore saw zero sessions: the "MULTIPLE CLAUDE CLI SESSIONS ARE ACTIVE"
 * banner in session-begin could not fire, and did not fire, through four consecutive
 * runs corrupted by exactly that condition. A guard nobody could observe failing is
 * indistinguishable from no guard, which is why the census now prints unconditionally.
 *
 * `ps` + an exact basename match on comm is what actually works here, and it keeps the
 * original intent the pgrep version was reaching for: `Claude Helper (Renderer)` and the
 * other Claude.app processes have a different comm and are excluded, where a naive
 * `ps | grep claude` would sweep them all in. Matching comm (not the full argv) also
 * means a path containing the word "claude" cannot inflate the count.
 */
export function activeClaudeCliSessions() {
  // Stage a multi-session census deterministically without spawning a second CLI — the
  // same escape DC_AGENT_SESSION_ID provides in agent-registry.mjs, and for the same
  // reason: the firing case of a concurrency guard must be provable by RUNNING it, and
  // a guard whose alarm path has never executed is a guard nobody has tested.
  if (process.env.DC_FAKE_CLI_PIDS) {
    const pids = process.env.DC_FAKE_CLI_PIDS.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
    return { available: true, pids };
  }
  try {
    const out = execFileSync('ps', ['-axo', 'pid=,comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const pids = out.split('\n').map((line) => {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!m) return null;
      const comm = m[2].trim();
      return comm.slice(comm.lastIndexOf('/') + 1) === 'claude' ? Number(m[1]) : null;
    }).filter((pid) => pid !== null);
    return { available: true, pids };
  } catch {
    // ps missing or unreadable (a minimal container, a locked-down shell). Non-fatal:
    // the lane workflow must stay usable, and the census says "unknown" rather than "0".
    return { available: false, pids: [] };
  }
}

// A session older than this with no registry heartbeat behind it is called out as a
// PROBABLE zombie. Two real offenders on 2026-08-16 were 4h52m and 6h03m old, holding
// a stale index and (in one case) 138 lines of staged work that blocked every ship.
export const ZOMBIE_AGE_MS = (Number(process.env.DC_ZOMBIE_HOURS) || 2) * 60 * 60 * 1000;

/**
 * Enrich the pid list with tty and elapsed time, in ONE `ps` call.
 *
 * ELAPSED IS NOT IDLE, and the distinction is load-bearing: a 6-hour session being
 * actively typed into looks identical here to one abandoned at minute two. Elapsed is
 * a FLOOR on age and nothing more. The caller pairs it with the session registry's
 * `lastSeen` heartbeat, which is the only real idleness signal we have, and only calls
 * a session a probable zombie when it is old AND unregistered (or old AND last seen
 * long ago). Anything stronger would flag the user's own live session — the exact false
 * positive that made the earlier pgrep banner ignorable.
 */
export function describeCliSessions(pids) {
  if (!pids.length) return [];
  try {
    const out = execFileSync(
      'ps',
      ['-o', 'pid=,tty=,etime=,stat=', '-p', pids.join(',')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [pid, tty, etime, stat] = line.split(/\s+/);
      return { pid: Number(pid), tty: tty || '?', etime: etime || '?', stat: stat || '?', elapsedMs: parseEtime(etime) };
    });
  } catch {
    return pids.map((pid) => ({ pid, tty: '?', etime: '?', stat: '?', elapsedMs: 0 }));
  }
}

// ps etime is [[dd-]hh:]mm:ss. Returns 0 on anything unparseable, so a formatting
// surprise degrades to "not old enough to flag" rather than a false zombie call.
export function parseEtime(etime) {
  if (!etime) return 0;
  const [dayPart, clockPart] = etime.includes('-') ? etime.split('-') : [null, etime];
  const parts = clockPart.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  const [h, m, s] = parts.length === 3 ? parts : [0, parts[0] || 0, parts[1] || 0];
  return ((Number(dayPart) || 0) * 86400 + h * 3600 + m * 60 + s) * 1000;
}
