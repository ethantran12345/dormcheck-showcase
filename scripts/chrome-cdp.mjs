#!/usr/bin/env node
/**
 * chrome-cdp — make the Chrome CDP endpoint (127.0.0.1:9222) present, idempotently,
 * WITHOUT ever quitting, restarting, or touching Ethan's real browser. Built 2026-07-27,
 * after the Playwright MCP moved to `--cdp-endpoint http://127.0.0.1:9222`
 * (b341edc3): it no longer launches a browser, so it fails at startup with a handshake
 * error whenever nothing is listening on 9222.
 *
 *   npm run chrome:cdp        (also step 3 of `npm run session:begin`; `ccd`/`cxd` in ~/.zshrc)
 *
 * THE CONSTRAINT THAT SHAPES THIS FILE: since Chrome 136, `--remote-debugging-port` is
 * SILENTLY IGNORED when Chrome runs on the DEFAULT user-data-dir — a security change, so
 * a drive-by page can't drive a logged-in profile over CDP. Verified on Chrome 150:
 * default profile + flag = nothing listening; a non-default --user-data-dir = port live
 * in ~2s. So the old `chromedbg` design (quit Chrome, relaunch the default profile with
 * the flag) CANNOT work on a current Chrome — the force-quit was cost with no benefit.
 *
 * Instead we run a DEDICATED, PERSISTENT agent profile at ~/.chrome-cdp, launched as a
 * separate instance with `open -na`. Ethan's Chrome is never quit or restarted; the two
 * instances coexist. The profile persists, so signing in / installing an extension there
 * is a one-time cost, not a per-session one.
 *
 * Three cases, and only ONE of them acts:
 *   a) the port answers                  → say nothing, exit 0.
 *   b) no agent-profile Chrome           → launch it detached, print one line.
 *   c) agent profile up but port dead    → WARN ONLY (rare: crashed/relaunched without
 *      the flag). Even then we don't kill it — closing that window is Ethan's call,
 *      though it holds no tabs of his.
 *
 * Same principle as session-begin's own header: a hook that mutates state you care about
 * on every session start would be its own hazard. NEVER blocks (always exit 0).
 */
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CDP = 'http://127.0.0.1:9222/json/version';
const PROFILE = join(homedir(), '.chrome-cdp');

/** Does something answer CDP? ~500ms budget — a session start must never hang on this. */
async function portLive(timeoutMs = 500) {
  try {
    return (await fetch(CDP, { signal: AbortSignal.timeout(timeoutMs) })).ok;
  } catch {
    return false;
  }
}

/** Is the AGENT-profile Chrome running? Keyed on the profile dir, so Ethan's own
 *  Chrome (default profile) never matches and is never a factor in any decision. */
function agentChromeRunning() {
  try {
    // No leading `--` in the pattern: pgrep would parse it as an option, not a pattern.
    execFileSync('pgrep', ['-f', `user-data-dir=${PROFILE}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false; // pgrep exits 1 with no match
  }
}

if (await portLive()) process.exit(0); // (a) nothing to do, stay silent

if (!agentChromeRunning()) {
  // (b) `open -na` = a NEW instance. Ethan's running Chrome is untouched.
  try {
    spawn(
      'open',
      ['-na', 'Google Chrome', '--args', '--remote-debugging-port=9222', `--user-data-dir=${PROFILE}`],
      { detached: true, stdio: 'ignore' }
    ).unref();
    console.log('→ launched the agent Chrome profile with CDP :9222 (your own Chrome untouched)');
  } catch {
    /* best-effort; never block a session start */
  }
  process.exit(0);
}

// (c) the agent profile is up but isn't listening. Don't kill it — just say so.
console.log(
  '⚠  The agent Chrome profile (~/.chrome-cdp) is running but nothing answers :9222 —\n' +
    '   the debug port can only be set at launch. Close THAT Chrome window (it holds no tabs\n' +
    '   of yours) and re-run `npm run chrome:cdp`; until then the playwright MCP will show a\n' +
    '   handshake failure.'
);
process.exit(0);
