#!/usr/bin/env node
/**
 * Gate-parity drift check.
 *
 * `lane:ship` runs gates in-lane and merges to dev if they pass; CI re-runs its own set
 * on the push. Any blocking CI step the lane set does not run is a gate a lane CANNOT
 * fail — so it fails after the merge, on dev. That happened on 2026-08-02
 * (`lane/migration-divergence` → TS2578 on the trunk).
 *
 * The first attempt at a fix was a COMMENT above GATES asserting the two sets matched.
 * It was wrong when written and stayed wrong. A snapshot doc has the same failure mode.
 * So this compares the two lists mechanically, every push and every ship:
 *
 *   set(blocking gate commands in .github/workflows/ci-dev-push.yml)
 *     ==  set(GATES in scripts/lane.mjs)  ∪  EXEMPT
 *
 * Both directions fail. A CI gate not in GATES is the original defect. A lane gate not
 * in CI is also a failure: it means a ship is being blocked by something the trunk does
 * not actually require, so the lists have drifted the other way.
 *
 * Adding a blocking step to CI now REQUIRES either adding it to GATES or naming it in
 * EXEMPT below with a reason. There is no way to leave it undecided.
 *
 * ── The docs-only scope guard (added 2026-08-16) ─────────────────────────────────
 * ci-dev-push.yml downgrades a docs-only push to two gates. It does that with a step
 * `if:` — the exact construct the "no `if:` on a gate" rule below exists to distrust.
 * So this script distrusts every `if:` EXCEPT one literal expression, SCOPE_GUARD,
 * and in exchange it asserts three things the old version could not:
 *
 *   1. the `id: scope` step that defines the guard still exists (without it every
 *      guarded step silently evaluates false and EVERY gate stops running, green);
 *   2. the gates left UNGUARDED are exactly DOCS_ONLY_GATES — so nobody can quietly
 *      guard `docs:check`, and nobody can add a third gate to the docs-only path
 *      without saying so here;
 *   3. every guarded gate is still parity-checked against lane:ship exactly as
 *      before — the guard changes WHEN a gate runs on the trunk, never whether a
 *      lane can fail it. lane:ship runs the whole set locally regardless.
 *
 * ── Gate identity is a COMMAND, not an npm script name (2026-08-16) ───────────────
 * Until now this compared npm SCRIPT NAMES, which meant a blocking CI step that was
 * not an npm script did not exist as far as this check was concerned. That blind spot
 * is part of how the RLS test-coverage gate stayed lane-invisible: it is invoked as
 * `node scripts/check-rls-test-coverage.mjs`, and adding it to package.json is not free
 * (a staged package.json needs its own lane). So a gate is now identified by the
 * command it runs, in one of two recognised forms:
 *
 *   npm run <script>
 *   node|bash scripts/<file>
 *
 * Anything else in GATES is reported as an unrecognised gate rather than silently
 * dropped — a dropped gate is a parity hole that reads as parity.
 *
 * Usage: node scripts/check-gate-parity.mjs [--self-test]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = ".github/workflows/ci-dev-push.yml";
const LANE = "scripts/lane.mjs";

/**
 * Blocking CI steps deliberately NOT run by lane:ship. Each needs a reason, and the
 * reason has to survive being read by the next person — "nobody got around to it" is
 * not one. Keep in sync with docs/lane-gate-parity.md.
 */
const EXEMPT = {
  "npm run audit:deps":
    "Queries the npm registry. lane:ship is otherwise fully hermetic and local; a "
    + "registry outage would freeze every lane on this machine. CI runs it on dev "
    + "minutes later, which is the right place for a network-dependent check. "
    + "Decision recorded in docs/DECISIONS.md 2026-08-02.",
};

/**
 * Steps whose `run:` body invokes npm scripts that are NOT themselves gates — e.g. a
 * reporting step that shells out. Matched by step name.
 */
const NON_GATE_STEPS = [];

/**
 * The ONE step condition that does not disqualify a gate. Defined by the
 * `id: scope` step in the workflow; see the header. Compared literally — a
 * reworded variant is treated as an ordinary (disqualifying) `if:`, which is the
 * point: the two files have to move together.
 */
const SCOPE_GUARD = "steps.scope.outputs.code == 'true'";

/** The step that must exist for SCOPE_GUARD to mean anything. */
const SCOPE_STEP_ID = "scope";

/**
 * Gates that must run on EVERY push to dev, docs-only included — i.e. the ones
 * deliberately NOT carrying SCOPE_GUARD. Both are cheap and both are about content
 * a docs-only push can actually break. Changing this set is a decision: record it in
 * docs/DECISIONS.md, do not just edit the array.
 */
const DOCS_ONLY_GATES = new Set(["npm run docs:check", "npm run i18n:verify"]);

/**
 * The command forms a gate may take. Ordered patterns, each yielding the canonical id
 * (which is just the normalised command). Extend deliberately: a form that is not here
 * is not a gate this check can see, and a gate it cannot see is the defect it exists
 * to prevent.
 */
const GATE_FORMS = [
  /\bnpm run ([a-zA-Z0-9:_-]+)/g,
  /\b(?:node|bash) scripts\/[A-Za-z0-9._-]+/g,
];

/** Every gate command appearing in a shell line, canonicalised. */
function gateCommandsIn(line) {
  const found = [];
  for (const re of GATE_FORMS) {
    for (const m of line.matchAll(re)) found.push(m[0].replace(/\s+/g, " "));
  }
  return found;
}

/** The id for a single command string (a GATES entry), or null if unrecognised. */
function gateId(command) {
  for (const re of GATE_FORMS) {
    const m = command.match(new RegExp(`^${re.source}$`));
    if (m) return m[0].replace(/\s+/g, " ");
  }
  return null;
}

/** Split a workflow's `steps:` block into individual step chunks. */
function parseSteps(yaml) {
  const lines = yaml.split("\n");
  const steps = [];
  let cur = null;
  for (const line of lines) {
    if (/^ {6}- /.test(line)) {
      if (cur) steps.push(cur);
      cur = [];
    }
    if (cur) cur.push(line);
  }
  if (cur) steps.push(cur);
  return steps.map((l) => l.join("\n"));
}

function stepName(step) {
  const m = step.match(/^ {6}- name:\s*(.+)$/m) ?? step.match(/^ {8}name:\s*(.+)$/m);
  return m ? m[1].trim() : "(unnamed step)";
}

/** Strip YAML comment lines so a commented-out command never counts as a gate. */
function uncommented(step) {
  return step
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/** The step's `if:` expression, or null when it has none. Comments are stripped first. */
function stepCondition(step) {
  const m = uncommented(step).match(/^ {8}if:\s*(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

/**
 * A step is blocking iff it always runs (on the pushes it applies to) and its failure
 * fails the job:
 *   - no `continue-on-error: true`
 *   - no `if:` condition, OR exactly SCOPE_GUARD (`always()`/`failure()`/`success()`
 *     steps are reporting steps, and any other conditional gate is not a gate you can
 *     rely on). SCOPE_GUARD narrows WHICH PUSHES a gate runs on; it never makes the
 *     gate skippable on a push that carries the code it checks.
 *   - the specific command is not suffixed with `|| true`
 */
function blockingGateCommands(step) {
  const body = uncommented(step);
  if (/^\s*continue-on-error:\s*true\s*$/m.test(body)) return [];
  const cond = stepCondition(step);
  if (cond !== null && cond !== SCOPE_GUARD) return [];
  const found = new Set();
  for (const line of body.split("\n")) {
    if (/\|\|\s*true/.test(line)) continue;
    for (const c of gateCommandsIn(line)) found.add(c);
  }
  return [...found];
}

/**
 * @returns {{ gates: Set<string>, unguarded: Set<string>, hasScopeStep: boolean }}
 *   `gates` is every blocking gate (guarded or not) — the set compared against
 *   lane:ship. `unguarded` is the subset that runs on a docs-only push too.
 */
function ciBlockingGates(yaml) {
  const gates = new Set();
  const unguarded = new Set();
  let hasScopeStep = false;
  for (const step of parseSteps(yaml)) {
    const body = uncommented(step);
    if (new RegExp(`^ {8}id:\\s*${SCOPE_STEP_ID}\\s*$`, "m").test(body)) hasScopeStep = true;
    if (NON_GATE_STEPS.includes(stepName(step))) continue;
    const guarded = stepCondition(step) === SCOPE_GUARD;
    for (const s of blockingGateCommands(step)) {
      gates.add(s);
      if (!guarded) unguarded.add(s);
    }
  }
  return { gates, unguarded, hasScopeStep };
}

/**
 * Invariants that only exist because of the docs-only scope guard. Returns a list of
 * human-readable problems; empty means clean.
 */
function scopeProblems({ gates, unguarded, hasScopeStep }) {
  const problems = [];
  const guardedCount = gates.size - unguarded.size;
  if (guardedCount > 0 && !hasScopeStep) {
    problems.push(
      `${guardedCount} gate(s) are guarded by \`${SCOPE_GUARD}\` but no step with `
      + `\`id: ${SCOPE_STEP_ID}\` defines it. Every guarded step would evaluate false and `
      + "SKIP — a fully green run that gates nothing. Restore the scope step.",
    );
  }
  const unexpected = [...unguarded].filter((g) => !DOCS_ONLY_GATES.has(g)).sort();
  const missing = [...DOCS_ONLY_GATES].filter((g) => !unguarded.has(g)).sort();
  if (unexpected.length) {
    problems.push(
      `Blocking on EVERY push (no scope guard) but not in DOCS_ONLY_GATES: ${unexpected.join(", ")}.\n`
      + `  Either add \`if: ${SCOPE_GUARD}\` to the step, or add the gate to DOCS_ONLY_GATES\n`
      + "  in this script and record why a docs-only push must pay for it.",
    );
  }
  if (missing.length) {
    problems.push(
      `In DOCS_ONLY_GATES but NOT blocking on a docs-only push: ${missing.join(", ")}.\n`
      + "  A docs-only push would land unchecked by it. Remove the scope guard from that\n"
      + "  step, or drop it from DOCS_ONLY_GATES deliberately.",
    );
  }
  return problems;
}

function laneGates(src) {
  const m = src.match(/const GATES = \[([\s\S]*?)\n {4}\];/);
  if (!m) {
    throw new Error(
      `could not find the GATES array literal in ${LANE}. If it was renamed or `
      + "reshaped, update this parser — do NOT delete the check.",
    );
  }
  const gates = new Set();
  const unrecognised = [];
  for (const line of m[1].split("\n")) {
    if (/^\s*\/\//.test(line)) continue;
    const g = line.match(/\[\s*'[^']+'\s*,\s*'([^']+)'\s*\]/);
    if (!g) continue;
    const id = gateId(g[1]);
    // Silently dropping an entry this parser does not understand would report parity
    // while the gate sits outside the comparison entirely — the failure mode of the
    // comment this script replaced. Surface it instead.
    if (id) gates.add(id);
    else unrecognised.push(g[1]);
  }
  if (!gates.size) throw new Error(`parsed zero gates out of ${LANE} — the parser is broken.`);
  return { gates, unrecognised };
}

function compare(ci, lane) {
  const missingFromLane = [...ci].filter((g) => !lane.has(g) && !(g in EXEMPT)).sort();
  const missingFromCi = [...lane].filter((g) => !ci.has(g)).sort();
  const staleExempt = Object.keys(EXEMPT).filter((g) => !ci.has(g) || lane.has(g)).sort();
  return { missingFromLane, missingFromCi, staleExempt };
}

function selfTest() {
  const yaml = readFileSync(resolve(ROOT, WORKFLOW), "utf8");
  const src = readFileSync(resolve(ROOT, LANE), "utf8");
  const parsed = ciBlockingGates(yaml);
  const ci = parsed.gates;
  const { gates: lane, unrecognised } = laneGates(src);
  const cases = [];

  // 1. A new blocking CI step with no lane gate must fail.
  const injected = new Set(ci);
  injected.add("npm run lint:brand-new-gate");
  cases.push([
    "new blocking CI step is caught",
    compare(injected, lane).missingFromLane.includes("npm run lint:brand-new-gate"),
  ]);

  // 2. A lane gate CI doesn't have must fail.
  const extraLane = new Set(lane);
  extraLane.add("npm run lint:lane-only");
  cases.push([
    "lane-only gate is caught",
    compare(ci, extraLane).missingFromCi.includes("npm run lint:lane-only"),
  ]);

  // 3. The real repo must currently be clean.
  const real = compare(ci, lane);
  cases.push([
    "repo is at parity right now",
    !real.missingFromLane.length && !real.missingFromCi.length && !real.staleExempt.length,
  ]);

  // 4. Reporting steps (`if: always()`, `|| true`) must not be read as gates.
  cases.push(["reporting steps excluded", !ci.has("npm run audit") && ci.size > 5]);

  // 5. The scope guard must not swallow gates: a guarded step is still a gate.
  cases.push([
    "scope-guarded steps still count as gates",
    ci.has("npm run test") && ci.has("npm run build") && ci.has("npm run typecheck:ratchet"),
  ]);

  // 6. A guard whose defining step vanished must fail — that is the state where every
  //    guarded gate silently skips and the run goes green having checked nothing.
  cases.push([
    "missing `id: scope` step is caught",
    scopeProblems({ ...parsed, hasScopeStep: false }).length > 0,
  ]);

  // 7. An unexpected gate on the docs-only path must fail (someone drops a guard).
  cases.push([
    "a gate added to the docs-only path is caught",
    scopeProblems({ ...parsed, unguarded: new Set([...parsed.unguarded, "build"]) }).length > 0,
  ]);

  // 8. And so must a docs gate that acquired a guard.
  cases.push([
    "a docs gate that acquired a scope guard is caught",
    scopeProblems({
      ...parsed,
      unguarded: new Set([...parsed.unguarded].filter((g) => g !== "npm run docs:check")),
    }).length > 0,
  ]);

  // 9. The real repo's scope invariants must hold right now.
  cases.push(["scope invariants hold right now", scopeProblems(parsed).length === 0]);

  // 10. A gate that is not an npm script is seen — the blind spot that let the RLS
  //     test-coverage gate stay lane-invisible until 2026-08-16.
  cases.push([
    "a `node scripts/…` CI step counts as a gate",
    ci.has("node scripts/check-rls-test-coverage.mjs")
      && lane.has("node scripts/check-rls-test-coverage.mjs"),
  ]);

  // 11. …and a GATES entry in a form this parser does not understand is reported,
  //     never dropped. Dropping it would report parity for a gate outside the
  //     comparison — the exact failure mode of the comment this script replaced.
  cases.push(["an unrecognised GATES entry is not silently dropped", gateId("npx foo") === null]);
  cases.push(["every GATES entry is recognised right now", unrecognised.length === 0]);

  let bad = 0;
  for (const [label, ok] of cases) {
    console.log(`${ok ? "  ok  " : " FAIL "} ${label}`);
    if (!ok) bad++;
  }
  console.log(`\nCI blocking gates (${ci.size}): ${[...ci].sort().join(", ")}`);
  console.log(
    `  of which run on a DOCS-ONLY push (${parsed.unguarded.size}): `
    + `${[...parsed.unguarded].sort().join(", ") || "none"}`,
  );
  console.log(`lane:ship GATES (${lane.size}): ${[...lane].sort().join(", ")}`);
  console.log(`exempt (${Object.keys(EXEMPT).length}): ${Object.keys(EXEMPT).join(", ") || "none"}`);
  for (const p of scopeProblems(parsed)) console.log(`\nscope problem: ${p}`);
  process.exit(bad ? 1 : 0);
}

if (process.argv.includes("--self-test")) selfTest();

const parsed = ciBlockingGates(readFileSync(resolve(ROOT, WORKFLOW), "utf8"));
const ci = parsed.gates;
const { gates: lane, unrecognised } = laneGates(readFileSync(resolve(ROOT, LANE), "utf8"));
const { missingFromLane, missingFromCi, staleExempt } = compare(ci, lane);
const scopeIssues = scopeProblems(parsed);

if (
  !missingFromLane.length && !missingFromCi.length && !staleExempt.length
  && !scopeIssues.length && !unrecognised.length
) {
  console.log(
    `Gate parity OK — ${ci.size} blocking CI step(s) (${parsed.unguarded.size} of them on a `
    + `docs-only push), ${lane.size} lane gate(s), ${Object.keys(EXEMPT).length} exempt.`,
  );
  process.exit(0);
}

if (scopeIssues.length) {
  console.error("Docs-only scope guard is not sound.\n");
  for (const p of scopeIssues) console.error(`  ${p}\n`);
}

if (unrecognised.length) {
  console.error(`Unrecognised GATES entr(ies) in ${LANE}:`);
  for (const g of unrecognised) console.error(`  ${g}`);
  console.error(
    "\n  This check identifies a gate by the command it runs, in one of two forms:\n"
    + "    npm run <script>\n"
    + "    node|bash scripts/<file>\n"
    + "  An entry in any other form sits OUTSIDE the comparison, so parity would be\n"
    + "  reported for a gate nobody is checking. Use a recognised form, or extend\n"
    + "  GATE_FORMS in this script deliberately.\n",
  );
}

if (!missingFromLane.length && !missingFromCi.length && !staleExempt.length) process.exit(1);

console.error("Gate-set drift between CI and lane:ship.\n");
if (missingFromLane.length) {
  console.error(`Blocking in ${WORKFLOW} but NOT run by lane:ship:`);
  for (const g of missingFromLane) console.error(`  ${g}`);
  console.error(
    "\n  A lane cannot fail these, so they fail on dev AFTER the merge. Add each to GATES\n"
    + `  in ${LANE} (and to GATE_SCRIPTS in src/test/laneShipRebase.test.ts), or add it to\n`
    + "  EXEMPT in this script with a reason and record the decision in docs/DECISIONS.md.\n",
  );
}
if (missingFromCi.length) {
  console.error(`Run by lane:ship but NOT blocking in ${WORKFLOW}:`);
  for (const g of missingFromCi) console.error(`  ${g}`);
  console.error(
    "\n  These block a ship without being required by the trunk. Either make the step\n"
    + "  blocking in CI or drop it from GATES.\n",
  );
}
if (staleExempt.length) {
  console.error("Stale EXEMPT entries (no longer a CI-only gate):");
  for (const g of staleExempt) console.error(`  ${g}`);
  console.error("\n  Remove the exemption from this script; the reason no longer applies.\n");
}
process.exit(1);
