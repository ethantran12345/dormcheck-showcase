#!/usr/bin/env node
/**
 * Accessibility + unused-code gate — the SINGLE implementation.
 *
 * Fails on eslint ERRORS from `jsx-a11y/*` and `unused-imports/*` only. Full `npm run
 * lint` is a separate gate; this one exists because a11y and unused-code findings must
 * block even while the wider lint surface is being remediated incrementally.
 *
 * This lived inline in .github/workflows/ci-dev-push.yml as an `npx eslint --format json`
 * run piped through a node -e filter, which meant `lane:ship` could not run it without
 * duplicating the rule list. Extracted 2026-08-02 so CI and lane:ship call one thing.
 * Do NOT re-inline it into either caller.
 *
 * unused-imports/* mirrors CodeQL's js/unused-local-variable on the GitHub "Security and
 * quality" board — gated here so new findings fail rather than accumulate.
 *
 * Exit 0 = clean, 1 = findings (or eslint itself could not run).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const GATED_PREFIXES = ["jsx-a11y/", "unused-imports/"];

// --format json goes to stdout; a non-zero exit just means "eslint found problems",
// which is expected — we do our own severity/rule filtering below. Only an unparseable
// stdout means eslint genuinely failed to run.
// Invoke the installed CLI through Node instead of spawning `npx`. Windows exposes
// npx as a .cmd shim, which spawnSync cannot execute without a shell; using the local
// JS entry point is deterministic and works identically on Windows, macOS, and Linux.
const eslintCli = join(process.cwd(), "node_modules", "eslint", "bin", "eslint.js");
const r = spawnSync(process.execPath, [eslintCli, ".", "--format", "json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

let report;
try {
  report = JSON.parse(r.stdout);
} catch {
  console.error("eslint did not produce parseable JSON — the lint run itself failed:");
  console.error((r.error?.message || r.stderr || r.stdout || "").slice(0, 4000));
  process.exit(1);
}

const hits = [];
for (const file of report) {
  for (const m of file.messages ?? []) {
    if (m.severity !== 2 || !m.ruleId) continue;
    if (!GATED_PREFIXES.some((p) => m.ruleId.startsWith(p))) continue;
    hits.push(`${file.filePath}:${m.line} ${m.ruleId} ${m.message}`);
  }
}

if (hits.length) {
  console.error(`${hits.length} jsx-a11y / unused-imports error(s):`);
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log("No jsx-a11y or unused-imports errors.");
