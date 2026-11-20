#!/usr/bin/env node
/**
 * Compare each audit doc's last commit to commits touching its covered paths since then.
 * A STALE hit means covered code may have changed; re-read the audit, not a verdict.
 *
 * Requires audit files to be committed (uncommitted audits have no git baseline).
 * Does not push or modify the repo.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const MANIFEST_PATH = join(REPO_ROOT, "docs/audits/_manifest.json");
const AUDITS_DIR = "docs/audits";

function git(args, { trim = true } = {}) {
  const out = execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return trim ? out.trim() : out;
}

function lastAuditCommit(auditFile) {
  try {
    return git(["log", "-1", "--format=%H", "--", `${AUDITS_DIR}/${auditFile}`]);
  } catch {
    return "";
  }
}

function countCommitsSince(baseSha, paths) {
  if (!baseSha || paths.length === 0) return 0;
  const args = ["rev-list", "--count", `${baseSha}..HEAD`, "--", ...paths];
  try {
    return Number.parseInt(git(args), 10) || 0;
  } catch {
    return 0;
  }
}

function pad(str, width) {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const entries = Object.entries(manifest.audits).sort(([a], [b]) => a.localeCompare(b));

console.log(
  "Note: requires audit files to be committed. STALE = covered paths changed since the audit's last commit (may need re-audit).\n",
);

const colAudit = Math.max(12, ...entries.map(([name]) => name.length));
const colCount = 28;
const colStatus = 8;

console.log(
  `${pad("audit", colAudit)} | ${pad("covered-paths-changed-since", colCount)} | status`,
);
console.log(`${"-".repeat(colAudit)}-|-${"-".repeat(colCount)}-|-${"-".repeat(colStatus)}`);

let staleCount = 0;
let skippedCount = 0;

for (const [auditFile, meta] of entries) {
  const paths = meta.paths ?? [];
  const baseSha = lastAuditCommit(auditFile);

  let count;
  let status;

  if (!baseSha) {
    count = " - ";
    status = "SKIP";
    skippedCount += 1;
  } else {
    count = String(countCommitsSince(baseSha, paths));
    if (Number(count) > 0) {
      status = "STALE";
      staleCount += 1;
    } else {
      status = "ok";
    }
  }

  console.log(`${pad(auditFile, colAudit)} | ${pad(count, colCount)} | ${status}`);
}

console.log("");
if (skippedCount > 0) {
  console.log(`${skippedCount} audit(s) skipped (not committed or no git history).`);
}
if (staleCount > 0) {
  console.log(`${staleCount} audit(s) may be stale.`);
  process.exit(1);
}
console.log("All tracked audits are fresh relative to covered paths.");
