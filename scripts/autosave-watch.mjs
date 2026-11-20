#!/usr/bin/env node
/**
 * autosave:watch - a periodic safety net INDEPENDENT of Claude Code hooks.
 *
 *   npm run autosave:watch     # leave running in a spare terminal
 *
 * Every 15 minutes, IF the Vite dev server (:8080) is listening, it runs an auto-wip.
 * This covers the case the hooks can't: Ethan walks away mid-edit with no Stop/
 * SessionEnd event ever firing. It NEVER touches :8080 — it only checks the port is
 * in LISTEN state (read-only lsof), then shells out to `npm run wip`. The dev server
 * is Ethan-owned; this process observes it, it does not start, stop, or proxy it.
 *
 * Throttle is 14m (just under the 15m tick) so a hook-driven save that already
 * happened this window is not duplicated.
 */
import { execSync, spawnSync } from 'node:child_process';

const INTERVAL_MS = 15 * 60 * 1000;
const PORT = 8080;
const stamp = () => new Date().toISOString().slice(11, 19);

// Read-only liveness check — does NOT connect to or disturb the dev server.
function devServerUp() {
  try {
    const out = execSync(`lsof -nP -iTCP:${PORT} -sTCP:LISTEN`, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length > 0;
  } catch {
    return false; // lsof exits non-zero when nothing is listening
  }
}

function tick() {
  if (!devServerUp()) {
    console.log(`[${stamp()}] dev server (:${PORT}) not running — skip.`);
    return;
  }
  console.log(`[${stamp()}] dev server up — running auto-wip…`);
  spawnSync('npm', ['run', 'wip', '--', '--throttle=14'], { stdio: 'inherit' });
}

console.log(`autosave:watch — every ${INTERVAL_MS / 60000}m, auto-wip when :${PORT} is up. Ctrl-C to stop.`);
tick();
setInterval(tick, INTERVAL_MS);
