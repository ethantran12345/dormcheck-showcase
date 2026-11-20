#!/usr/bin/env node
// automation-alerts.mjs — surface DormCheck's GitHub automation health as JSON so
// off-GitHub mirrors (Command Center, the morning brief) can read a red canary
// without opening GitHub. This is the READ side of the self-healing loop whose
// WRITE side is .github/workflows/automation-status.yml + render-automation-status.mjs.
//
// Two sources, deliberately:
//   1. `gh issue list` (LIVE) — the current open detector alerts, freshest signal.
//   2. docs/automation-status.json (committed on dev by automation-status.yml) — the
//      per-workflow ✅/❌/💤 snapshot, for red + stale workflows.
//
// The detector label set is NOT hardcoded here: it is parsed at runtime from
// render-automation-status.mjs's LABEL_TO_WORKFLOW map, the single canonical
// definition the status workflow itself uses. Guessing labels would drift.
//
// Contract: emits JSON to stdout and ALWAYS exits 0. A caller (brief, dashboard)
// must never break because this script hit a missing file, no `gh`, or no network.
// Zero open alerts is a valid, healthy result — not a failure.
//
// Usage: npm run automation:alerts   (see docs/CHANGELOG.md 2026-07-22)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const STALE_DAYS = 30; // a scheduled workflow silent this long is effectively stopped
const DAY_MS = 24 * 60 * 60 * 1000;

const now = Date.now();
const generatedAt = new Date(now).toISOString();
const ageDaysFrom = (iso) =>
  iso ? Math.floor((now - new Date(iso).getTime()) / DAY_MS) : null;

// --- 1. Canonical detector labels, parsed from the status renderer -------------
// We read the LABEL_TO_WORKFLOW object literal out of render-automation-status.mjs
// rather than importing it (that module runs side-effecting file reads on import).
function detectorLabels() {
  try {
    const src = readFileSync(
      join(REPO_ROOT, ".github", "scripts", "render-automation-status.mjs"),
      "utf8"
    );
    const block = src.match(/LABEL_TO_WORKFLOW\s*=\s*\{([\s\S]*?)\}/);
    if (!block) return new Set();
    // Grab each quoted key on the left of a colon.
    const labels = [...block[1].matchAll(/["']([^"']+)["']\s*:/g)].map((m) => m[1]);
    return new Set(labels);
  } catch {
    return new Set();
  }
}

// --- 2. Live open alerts via gh ------------------------------------------------
function openAlerts(labelSet) {
  if (labelSet.size === 0) return [];
  let raw;
  try {
    raw = execFileSync(
      "gh",
      [
        "issue",
        "list",
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,title,labels,url,updatedAt",
      ],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
  } catch {
    return []; // no gh / not authed / offline — degrade to empty, never throw
  }
  let issues;
  try {
    issues = JSON.parse(raw);
  } catch {
    return [];
  }
  return issues
    .filter((i) =>
      (i.labels || []).some((l) => labelSet.has(l.name))
    )
    .map((i) => ({
      number: i.number,
      title: i.title,
      url: i.url,
      updatedAt: i.updatedAt,
      ageDays: ageDaysFrom(i.updatedAt),
    }))
    .sort((a, b) => a.number - b.number);
}

// --- 3. Red + stale workflows from the committed snapshot ----------------------
function workflowState() {
  let snapshot;
  try {
    snapshot = JSON.parse(
      readFileSync(join(REPO_ROOT, "docs", "automation-status.json"), "utf8")
    );
  } catch {
    return { redWorkflows: [], staleWorkflows: [] };
  }
  const wfs = Array.isArray(snapshot.workflows) ? snapshot.workflows : [];

  const redWorkflows = wfs
    .filter((w) => w.status_icon === "❌")
    .map((w) => ({
      name: w.name,
      lastRun: w.last_run_at ?? null,
      url: w.last_run_url ?? null,
    }));

  // "stale" = a scheduled workflow with no run in STALE_DAYS+ days. The snapshot
  // carries only the latest run per workflow, so a silence this long means it has
  // had no successful (indeed no) run in that window.
  const staleWorkflows = wfs
    .filter((w) => w.last_event === "schedule")
    .map((w) => ({ w, daysSince: ageDaysFrom(w.last_run_at) }))
    .filter(({ daysSince }) => daysSince !== null && daysSince >= STALE_DAYS)
    .map(({ w, daysSince }) => ({
      name: w.name,
      lastRun: w.last_run_at ?? null,
      daysSince,
    }));

  return { redWorkflows, staleWorkflows };
}

function main() {
  const labelSet = detectorLabels();
  const { redWorkflows, staleWorkflows } = workflowState();
  const result = {
    generatedAt,
    redWorkflows,
    staleWorkflows,
    openAlerts: openAlerts(labelSet),
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

try {
  main();
} catch (err) {
  // Absolute last resort: still emit a valid, empty-shaped payload and exit 0.
  process.stdout.write(
    JSON.stringify(
      { generatedAt, redWorkflows: [], staleWorkflows: [], openAlerts: [], error: String(err && err.message || err) },
      null,
      2
    ) + "\n"
  );
}
process.exit(0);
