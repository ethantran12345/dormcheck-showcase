/**
 * lane:ship merge-base regression suite.
 *
 * The defect (twice on 2026-07-31): a lane's gates run against its MERGE BASE, so
 * "green in-lane" is not evidence of "green on dev". dev moves while a lane is open,
 * and the lane never sees it.
 *   (a) untangling pass, step 2 — lint:primitives passed in-lane only because the
 *       merge base predated 341ab000; the violation was real and appeared the moment
 *       formCraft.test.tsx was actually present.
 *   (b) release-defect-cleanup — passed four ratchets, typecheck:crash, 690 tests and
 *       build in-lane, then turned dev RED on merge via docs:check (fixed after the
 *       fact in d27bfed2).
 * Both were caught by a person noticing, not by a gate.
 *
 * The fix: lane:ship rebases onto origin/dev's TIP, says so explicitly, then runs its
 * gate set against the rebased result — and names a post-rebase failure as a merge-base
 * issue. That set used to be a SUBSET of CI's blocking steps: a third instance of this
 * failure mode (c) happened 2026-08-02, when migration-divergence passed every lane gate
 * and turned dev red on TS2578, caught only by CI's type-check ratchet. The lane set now
 * matches CI's blocking steps except for one exempted, network-dependent gate, and
 * `npm run check:gate-parity` fails if they ever drift apart again — in CI and as the
 * first lane gate. See docs/lane-gate-parity.md.
 *
 * These drive the real scripts/lane.mjs against a throwaway repo whose package.json
 * scripts stand in for the gates, so the orchestration under test is the shipped code
 * path (fetch → rebase → gates → merge), not a re-implementation.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";

const LANE = resolve("scripts/lane.mjs");
// Each case drives a real lane:ship end-to-end — a dozen git invocations plus eight
// `npm run` gate subprocesses. That is ~2s alone but comfortably past vitest's 5s
// default when the rest of the suite is running in parallel on the same box.
const SHIP_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 30_000;

function sh(cmd: string, cwd: string) {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cmd failed (${cmd}): ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function ship(cwd: string) {
  // PATH is inherited so the real `npm` runs the stand-in gate scripts below.
  const r = spawnSync("node", [LANE, "ship"], { cwd, encoding: "utf8", env: process.env });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

/**
 * A gate that mimics the real merge-base defect: it only fails when BOTH the lane's
 * own file and a file that landed on dev AFTER the lane branched are present. Against
 * the lane's stale merge base it passes; against origin/dev's tip it fails. That
 * conjunction is the point — a gate that failed on dev alone would prove nothing.
 */
const CONJUNCTION_GATE = `
const { existsSync } = require("node:fs");
const both = existsSync("lane-file.md") && existsSync("dev-file.md");
if (both) { console.error("docs drift: lane-file.md conflicts with dev-file.md"); process.exit(1); }
process.exit(0);
`;

/**
 * Must mirror GATES in scripts/lane.mjs. A gate missing here is stubbed as absent, and
 * `npm run <missing>` exits non-zero, so the ship fails for a reason that has nothing to
 * do with what the test is asserting. `typecheck:ratchet` was added 2026-08-02; the CI
 * parity set (check:gate-parity, check:package-overrides, i18n:verify, lint:a11y, lint,
 * guard:csp) the same day. Nothing keeps this list honest automatically — a divergence
 * shows up as an unrelated-looking ship failure here, not as a parity error, because
 * check:gate-parity reads the real repo, and inside these throwaway repos it is a stub.
 */
const GATE_SCRIPTS = [
  "check:gate-parity", "check:package-overrides", "i18n:verify",
  "lint:colors", "lint:glyphs", "lint:primitives", "lint:widths",
  "typecheck:crash", "typecheck:ratchet", "lint:a11y", "lint",
  "test", "build", "guard:csp", "guard:dev-only",
];

/**
 * The same list for gates GATES invokes directly rather than through package.json
 * (added 2026-08-16 with `node scripts/check-rls-test-coverage.mjs`). A package.json
 * stub cannot cover these: the command names a real file, so the throwaway repo needs
 * that file to exist or the ship fails on a missing module.
 */
const GATE_FILES = [
  "scripts/check-rls-test-coverage.mjs",
  // Added 2026-08-17 with the chk_content_type replay-set gate. Without a stub the real
  // script runs inside the throwaway repo, finds no supabase/ tree and exits 1 — which
  // surfaces as an unrelated-looking ship failure, exactly as the note above warns.
  "scripts/check-content-type-replay-set.mjs",
];

function pkgJson() {
  const scripts: Record<string, string> = { "docs:check": "node gate.cjs" };
  for (const g of GATE_SCRIPTS) scripts[g] = "node -e \"process.exit(0)\"";
  return JSON.stringify({ name: "throwaway", private: true, scripts }, null, 2);
}

/** Drop a pass-through stub for every directly-invoked gate into a throwaway repo. */
function writeGateFiles(dir: string) {
  for (const rel of GATE_FILES) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "process.exit(0);\n");
  }
}

const CONTRACT = [
  "# Lane contract — ship-gate",
  "\n## Objective\n- Prove lane:ship re-gates against current origin/dev.",
  "\n## Owned paths\n- `lane-file.md`",
  "\n## Touched interfaces\n- None.",
  "\n## Dependencies & blockers\n- None.",
  "\n## Verification\n- Gates exercised by this suite.",
  "\n## Ready to ship\n- [x] Yes",
  "\n## Known limitations\n- None known.",
  "\n## Documentation & journaling\n- CHANGELOG: not needed.\n",
].join("\n");

let root: string;
let repo: string;
let laneWt: string;

/**
 * Builds: a bare origin, a main worktree on dev, and a lane branched from an OLD dev
 * tip — after which dev advances by one commit that the lane has never seen.
 */
function scaffold({ conflicting }: { conflicting: boolean }) {
  const origin = join(root, "origin.git");
  sh(`git init -q --bare -b dev "${origin}"`, root);
  sh(`git clone -q "${origin}" repo`, root);
  sh("git config user.email t@t.com && git config user.name t && git config commit.gpgsign false", repo);
  writeFileSync(join(repo, "package.json"), pkgJson());
  writeFileSync(join(repo, "gate.cjs"), CONJUNCTION_GATE);
  writeGateFiles(repo);
  mkdirSync(join(repo, "docs", "handoffs"), { recursive: true });
  sh("git add -A && git commit -qm init && git push -q origin dev", repo);

  // The lane branches HERE — this commit is its merge base.
  sh("git branch lane/ship-gate", repo);
  laneWt = join(root, "ship-gate");
  sh(`git worktree add -q "${laneWt}" lane/ship-gate`, repo);

  // dev advances underneath the lane. The lane will never see this until it rebases.
  writeFileSync(join(repo, "dev-file.md"), "landed on dev after the lane branched\n");
  sh("git add -A && git commit -qm 'dev moves on' && git push -q origin dev", repo);

  // The lane's own work. Alone it is clean; combined with dev-file.md it is not.
  if (conflicting) writeFileSync(join(laneWt, "lane-file.md"), "lane work\n");
  else writeFileSync(join(laneWt, "harmless.md"), "lane work\n");
  // git carries no empty directories, so the worktree checkout has no docs/handoffs.
  mkdirSync(join(laneWt, "docs", "handoffs"), { recursive: true });
  writeFileSync(join(laneWt, "docs/handoffs/lane-ship-gate.md"), CONTRACT);
  sh("git add -A && git commit -qm 'lane work' --no-verify", laneWt);

  writeFileSync(join(repo, ".git", "dc-lanes.json"), JSON.stringify({
    lanes: [{
      name: "ship-gate", branch: "lane/ship-gate", worktree: laneWt,
      owns: ["lane-file.md", "harmless.md", "docs/handoffs/lane-ship-gate.md"],
      pid: process.pid, handoffRequired: true,
      startedAt: new Date().toISOString(), lastActive: new Date().toISOString(), status: "live",
    }],
  }, null, 2));
}

beforeEach(() => {
  // realpath so stored worktree paths match `git rev-parse --show-toplevel`
  // (macOS tmpdir is /var → /private/var symlinked).
  root = realpathSync(mkdtempSync(join(tmpdir(), "lane-ship-rebase-")));
  repo = join(root, "repo");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("lane:ship re-gates against current origin/dev", () => {
  it("REFUSES a lane whose gates pass on its stale merge base but fail on origin/dev's tip", () => {
    scaffold({ conflicting: true });

    // Sanity: the gate genuinely passes in the lane as it stands, pre-rebase. Without
    // this, a refusal below would not prove the merge base was the cause.
    const preRebase = spawnSync("node", ["gate.cjs"], { cwd: laneWt, encoding: "utf8" });
    expect(preRebase.status).toBe(0);

    const r = ship(laneWt);
    expect(r.status).toBe(1);
    // The rebase is announced, not silent.
    expect(r.out).toContain("REBASE REQUIRED");
    // The refusal names the gate AND identifies it as post-rebase / merge-base.
    expect(r.out).toContain("docs:check FAILED");
    expect(r.out).toContain("AFTER rebasing onto origin/dev");
    expect(r.out).toContain("MERGE-BASE issue");
    // Nothing merged: dev on the remote is untouched by the lane.
    expect(existsSync(join(repo, "lane-file.md"))).toBe(false);
    expect(sh("git log --oneline origin/dev", repo)).not.toContain("lane work");
  }, SHIP_TIMEOUT_MS);

  it("still ships a lane that is clean against origin/dev's tip", () => {
    scaffold({ conflicting: false });

    const r = ship(laneWt);
    expect(r.status).toBe(0);
    expect(r.out).toContain("REBASE REQUIRED");   // it was stale, and said so
    expect(r.out).toContain('✓ shipped lane "ship-gate"');
    // The merge really landed, on top of the dev commit the lane had never seen.
    const log = sh("git log --oneline dev", repo);
    expect(log).toContain("lane work");
    expect(log).toContain("dev moves on");
  }, SHIP_TIMEOUT_MS);
});
