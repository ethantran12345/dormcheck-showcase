#!/usr/bin/env node
// Renders the Automation Status board (/tmp/as/body.md) + machine-readable snapshot
// (docs/automation-status.json) from the gh-gathered state files. Pure formatting:
// no network calls, so it stays deterministic and cheap. Driven by
// .github/workflows/automation-status.yml. See docs/CHANGELOG.md 2026-07-15.
import { readFileSync, writeFileSync } from "node:fs";

const REPO = process.env.REPO || "";
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

const workflows = read("/tmp/as/workflows.json");
const runs = read("/tmp/as/runs.json");
const issues = read("/tmp/as/issues.json");
const inventory = read(".github/automation-inventory.json");

const runById = new Map(runs.map((r) => [r.id, r.run]));

// Alert label -> the detector workflow that raises it. Drives "Needs attention".
// ONE ROW PER WORKFLOW FILE (decision 2026-10-29): the board discovers workflows via
// `gh workflow list`, so the consolidated "Prod Watch (daily)" and "Weekly Sweep" files
// each render one row, red when any of their checks/jobs is red. Which check failed is
// named by the open alert issue (labels below, UNCHANGED) or, when no issue is open, by
// the failed step ids in the linked run. Per-check rows would need a jobs/steps API call
// per workflow per refresh for no extra routing information.
// `audit-stale` is no longer raised (audit-freshness.yml was deleted 2026-10-29); an old
// open issue carrying it simply stops being listed here.
const PROD_WATCH = "Prod Watch (daily)";
const WEEKLY_SWEEP = "Weekly Sweep";
const LABEL_TO_WORKFLOW = {
  "prod-down": PROD_WATCH,
  "signup-canary": WEEKLY_SWEEP,
  "migration-safety": "Migration / RLS Safety Guard",
  "security-audit": WEEKLY_SWEEP,
  "build-break": WEEKLY_SWEEP,
  "security/secrets": "Secrets Scan",
  "advisor-autofix": PROD_WATCH,
  "advisor-review": PROD_WATCH,
  "autofix-failed": "Autonomous Auto-Fix (Tier A)",
  "autofix-exhausted": "Autonomous Auto-Fix (Tier A)",
  "auth-config-drift": PROD_WATCH,
};
const ALERT_LABELS = new Set(Object.keys(LABEL_TO_WORKFLOW));

const fmtWhen = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(
    d.getUTCHours()
  )}:${p(d.getUTCMinutes())} UTC`;
};

function iconFor(wf, run) {
  if (wf.state && wf.state !== "active") return "💤"; // disabled
  if (!run) return "💤"; // never run
  if (run.status && run.status !== "completed") return "🔄"; // in progress / queued
  switch (run.conclusion) {
    case "success":
      return "✅";
    case "failure":
    case "timed_out":
    case "startup_failure":
      return "❌";
    default:
      return "⚪"; // cancelled / skipped / neutral
  }
}

// --- assemble workflow rows ---
const wfRows = workflows
  .map((wf) => {
    const run = runById.get(wf.id) || null;
    const icon = iconFor(wf, run);
    return {
      name: wf.name,
      path: wf.path,
      state: wf.state,
      status_icon: icon,
      last_conclusion: run?.conclusion ?? null,
      last_status: run?.status ?? null,
      last_run_at: run?.createdAt ?? null,
      last_run_url: run?.url ?? null,
      last_event: run?.event ?? null,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const wfByName = new Map(wfRows.map((w) => [w.name, w]));

// --- open alerts (issues carrying a detector label; exclude the board itself) ---
const openAlerts = issues
  .map((i) => ({
    number: i.number,
    title: i.title,
    url: i.url,
    updated_at: i.updatedAt,
    labels: (i.labels || []).map((l) => l.name),
  }))
  .filter((i) => i.labels.some((l) => ALERT_LABELS.has(l)))
  .sort((a, b) => a.number - b.number);

// --- needs attention: open alert issues + any red workflow without an issue ---
const coveredWorkflows = new Set();
const needs = [];
for (const a of openAlerts) {
  const alertLabel = a.labels.find((l) => ALERT_LABELS.has(l));
  const wfName = LABEL_TO_WORKFLOW[alertLabel];
  if (wfName) coveredWorkflows.add(wfName);
  needs.push(
    `- ❌ **${wfName || alertLabel}** — [#${a.number} ${a.title}](${a.url}) · Approve the fix: comment \`@claude fix this\` on the linked issue.`
  );
}
for (const w of wfRows) {
  if (w.status_icon === "❌" && !coveredWorkflows.has(w.name)) {
    const link = w.last_run_url ? `[run](${w.last_run_url})` : "run";
    needs.push(
      `- ❌ **${w.name}** — latest ${link} failed, no alert issue open. Inspect the run; open an issue to approve a fix.`
    );
  }
}

// --- markdown body ---
const now = new Date().toISOString();
const lines = [];
lines.push(
  `_Auto-updated by \`.github/workflows/automation-status.yml\`. Last refresh: **${fmtWhen(
    now
  )}**._`
);
lines.push("");
lines.push("## Needs attention");
lines.push("");
if (needs.length === 0) {
  lines.push("✅ **All clear** — every automation is green and no alerts are open.");
} else {
  lines.push(...needs);
}
lines.push("");
lines.push("## GitHub Actions");
lines.push("");
lines.push("| Automation | Status | Last run | When |");
lines.push("|---|:--:|---|---|");
for (const w of wfRows) {
  const concl = w.last_conclusion || w.last_status || "never run";
  const cell = w.last_run_url ? `[${concl}](${w.last_run_url})` : concl;
  lines.push(`| ${w.name} | ${w.status_icon} | ${cell} | ${fmtWhen(w.last_run_at)} |`);
}
lines.push("");
lines.push("## Cowork routines & Mac tasks (not GitHub-visible)");
lines.push("");
const off = inventory.off_github || [];
if (off.length === 0) {
  lines.push("_None recorded. Source of truth: vault `Automations.md`._");
} else {
  lines.push("| Automation | Host | Schedule | Purpose |");
  lines.push("|---|---|---|---|");
  for (const o of off) {
    lines.push(`| ${o.name} | ${o.host} | ${o.schedule} | ${o.purpose} |`);
  }
  lines.push("");
  lines.push(
    "_These are read from `.github/automation-inventory.json` (GitHub can't introspect them); keep it in sync with the vault `Automations.md`._"
  );
}
lines.push("");
lines.push("---");
lines.push("");
lines.push(
  "**The self-healing loop:** a detector (canary/audit) opens an issue → this board surfaces it → you comment `@claude fix this` (your approval) → `claude.yml` commits the fix on `dev`, CI-gated → the next daily refresh clears it. Production still ships from `main` by hand."
);

writeFileSync("/tmp/as/body.md", lines.join("\n") + "\n");

// --- machine-readable snapshot ---
const snapshot = {
  generated_at: now,
  repo: REPO,
  summary: {
    workflows: wfRows.length,
    green: wfRows.filter((w) => w.status_icon === "✅").length,
    failing: wfRows.filter((w) => w.status_icon === "❌").length,
    dormant: wfRows.filter((w) => w.status_icon === "💤").length,
    open_alerts: openAlerts.length,
    needs_attention: needs.length,
  },
  workflows: wfRows,
  off_github: off,
  open_alerts: openAlerts,
};
writeFileSync("docs/automation-status.json", JSON.stringify(snapshot, null, 2) + "\n");
