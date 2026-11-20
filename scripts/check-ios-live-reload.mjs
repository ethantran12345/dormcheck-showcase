#!/usr/bin/env node
/**
 * Guard: fail if the tracked iOS Capacitor config carries a dev live-reload URL.
 *
 * `npm run ios:live` / `ios:live:local` inject a `server` block into
 * ios/App/App/capacitor.config.json so the simulator loads from the Vite dev
 * server. A production config has NO `server` block, so its presence == a leaked
 * dev URL that must never be committed/pushed (a release build would try to load
 * localhost). See docs/audits/capacitor-native.md.
 *
 * Modes (which version of the file to inspect):
 *   --staged   what's staged for commit   (git show :<path>) - used by pre-commit
 *   --head     the committed tip           (git show HEAD:<path>) - used by pre-push
 *   (default)  the working-tree file - for manual `npm run check:ios-live-reload`
 *
 * Exit 1 when a server URL is present, else 0. Bypass with SKIP_LIVE_RELOAD_CHECK=1.
 * Never blocks on unrelated breakage (missing/unparseable file -> warn, exit 0).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CONFIG_PATH = "ios/App/App/capacitor.config.json";

if (process.env.SKIP_LIVE_RELOAD_CHECK === "1") {
  console.log("ios live-reload check skipped (SKIP_LIVE_RELOAD_CHECK=1).");
  process.exit(0);
}

const mode = process.argv.includes("--staged")
  ? "staged"
  : process.argv.includes("--head")
    ? "head"
    : "worktree";

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Returns the file content for the requested mode, or null when there is nothing to check. */
function readConfig() {
  try {
    if (mode === "staged") {
      // Only inspect if the path is actually staged this commit; otherwise nothing to do.
      const staged = git(["diff", "--cached", "--name-only", "--", CONFIG_PATH]).trim();
      if (!staged) return null;
      return git(["show", `:${CONFIG_PATH}`]);
    }
    if (mode === "head") {
      return git(["show", `HEAD:${CONFIG_PATH}`]);
    }
    return readFileSync(join(REPO_ROOT, CONFIG_PATH), "utf8");
  } catch {
    // File absent at this ref / not tracked yet - nothing to guard.
    return null;
  }
}

const raw = readConfig();
if (raw == null) process.exit(0);

let config;
try {
  config = JSON.parse(raw);
} catch {
  console.warn(`[ios-live-reload] Could not parse ${CONFIG_PATH}; skipping check.`);
  process.exit(0);
}

const serverUrl = config?.server?.url;
if (serverUrl) {
  console.error(
    "\n✗ Dev live-reload URL present in " + CONFIG_PATH + ` (server.url = "${serverUrl}").` +
      `\n  This is a dev-only setting and must not be committed or pushed.` +
      `\n  Fix: run "npm run ios:reset" (or: git checkout ${CONFIG_PATH}) to strip it, then retry.` +
      `\n  Bypass once with: SKIP_LIVE_RELOAD_CHECK=1\n`,
  );
  process.exit(1);
}

process.exit(0);
