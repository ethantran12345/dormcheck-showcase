/**
 * Lane ownership-deadlock regression suite.
 *
 * Reproduces the 2026-07-22 hard deadlock and proves the fix resolves it WITHOUT a
 * `git commit --no-verify` bypass:
 *   - a live lane owns docs/**; a docs/ file staged in the main worktree is BLOCKED
 *     by the pre-commit ownership guard, while lane:ship refuses because the main
 *     worktree is dirty → circular.
 * The fix adds lane:park (release ownership, keep branch/worktree/commits), makes the
 * guard consult computed liveness (a parked/inactive lane stops being enforced), and
 * makes lane:ship preflight ALL external preconditions before running gates.
 *
 * These drive the real scripts/lane.mjs against throwaway git repos, so they exercise
 * the shipped code paths end-to-end (registry, guard, park/resume, preflight), not a
 * re-implementation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const LANE = resolve("scripts/lane.mjs");
const DEAD_PID = 2147483647; // no process this high exists → pidAlive() === false, clock-independent

// These integration cases launch several Git/Bash subprocesses each. Windows process
// startup is materially slower, especially while the full suite runs in parallel.
if (process.platform === "win32") vi.setConfig({ testTimeout: 20_000 });

function sh(cmd: string, cwd: string) {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cmd failed (${cmd}): ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function lane(cwd: string, ...args: string[]) {
  return spawnSync("node", [LANE, ...args], { cwd, encoding: "utf8", env: process.env });
}
function laneWithEnv(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) {
  return spawnSync("node", [LANE, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
}
/**
 * check-staged run from the main worktree with the main-worktree gate lifted, so
 * what the assertion measures is LANE OWNERSHIP and nothing else.
 *
 * The main-worktree gate is lane-live-only (narrowed 2026-07-31), and it sits AHEAD
 * of the ownership loop. So in any scenario that has a LIVE lane — which is exactly
 * the scenario an ownership assertion needs — a bare `check-staged` would exit 1
 * whether or not the ownership rule works at all, and the assertion would pass for
 * the wrong reason. LANE_MAIN_RECOVERY=1 lifts only that first gate; the dependency
 * check and the ownership loop below it still run.
 *
 * Where NO lane is live (parked, inactive, none), use bare `lane(cwd,
 * "check-staged")` instead: there the main-worktree gate is inert by design, and the
 * bare call proves both the narrowing and the ownership release at once.
 *
 * Assertions must always pin the SPECIFIC banner they mean — `LANE OWNERSHIP —
 * COMMIT BLOCKED` vs `MAIN WORKTREE — COMMIT BLOCKED`. An earlier version of this
 * suite asserted on a substring both banners satisfy, and would have stayed green
 * with the ownership rule deleted outright.
 */
function ownershipProbe(cwd: string) {
  return laneWithEnv(cwd, { LANE_MAIN_RECOVERY: "1" }, "check-staged");
}
function initRepo(dir: string) {
  sh("git init -q -b dev && git config user.email t@t.com && git config user.name t", dir);
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "existing.md"), "seed\n");
  sh("git add -A && git commit -qm init", dir);
}
function writeRegistry(repo: string, laneObj: Record<string, unknown>) {
  writeFileSync(join(repo, ".git", "dc-lanes.json"), JSON.stringify({ lanes: [laneObj] }, null, 2));
}
function readRegistry(repo: string) {
  return JSON.parse(readFileSync(join(repo, ".git", "dc-lanes.json"), "utf8")).lanes[0];
}
const nowIso = () => new Date().toISOString();

let root: string;
let repo: string;
beforeEach(() => {
  // realpath so stored worktree paths match `git rev-parse --show-toplevel`
  // (macOS tmpdir is /var → /private/var symlinked).
  root = realpathSync(mkdtempSync(join(tmpdir(), "lane-deadlock-")));
  repo = join(root, "repo");
  mkdirSync(repo);
  initRepo(repo);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("lane ownership deadlock", () => {
  it("OLD PATH: a live lane's ownership blocks an owned file staged in main (the deadlock's first jaw)", () => {
    writeRegistry(repo, {
      name: "docs-lane", branch: "lane/docs-lane", worktree: join(root, "docs-lane"),
      owns: ["docs/**"], pid: process.pid, startedAt: nowIso(), lastActive: nowIso(), status: "live",
    });
    sh("echo change > docs/note.md && git add docs/note.md", repo);
    // Probed with LANE_MAIN_RECOVERY so the OWNERSHIP jaw is what's measured. This
    // lane is live, so the main-worktree gate would refuse ahead of the ownership
    // loop and the assertion would pass for the wrong reason.
    const blocked = ownershipProbe(repo);
    expect(blocked.status).toBe(1); // guard refuses — with no way out, this forced --no-verify
    expect(blocked.stderr).toContain("LANE OWNERSHIP — COMMIT BLOCKED");
    expect(blocked.stderr).not.toContain("MAIN WORKTREE — COMMIT BLOCKED");
  });

  it("with ZERO live lanes a main-worktree commit needs no env var — the guard is lane-live-only", () => {
    // Narrowed 2026-07-31. team-workflow-hardening had made this gate unconditional,
    // which forced LANE_MAIN_RECOVERY=1 on every ordinary direct-to-dev commit and
    // made CLAUDE.md's trunk-based rule false. The hazard it exists for — a
    // concurrent lane's `git add -A` sweeping work staged here (2026-07-27) — cannot
    // occur when no lane is live, so with no live lane the gate must be inert.
    writeFileSync(join(repo, ".git", "dc-lanes.json"), JSON.stringify({ lanes: [] }, null, 2));
    sh("echo change > docs/note.md && git add docs/note.md", repo);
    const bare = lane(repo, "check-staged"); // NO LANE_MAIN_RECOVERY
    expect(bare.status).toBe(0);
    expect(bare.stderr).not.toContain("MAIN WORKTREE — COMMIT BLOCKED");
  });

  it("a PARKED lane does not gate the main worktree either — liveness, not existence, is the trigger", () => {
    writeRegistry(repo, {
      name: "docs-lane", branch: "lane/docs-lane", worktree: join(root, "docs-lane"),
      owns: ["src/feature.ts"], pid: process.pid, startedAt: nowIso(), lastActive: nowIso(),
      status: "parked", parkedReason: "manual",
    });
    sh("echo change > docs/note.md && git add docs/note.md", repo);
    const bare = lane(repo, "check-staged"); // NO LANE_MAIN_RECOVERY
    expect(bare.status).toBe(0);
    expect(bare.stderr).not.toContain("MAIN WORKTREE — COMMIT BLOCKED");
  });

  // REWRITTEN 2026-08-16 for ADR 0001 §D3. This case used to assert the opposite — that a
  // live lane blocks a main-worktree commit for a path it does NOT own — which is exactly
  // the coarse lock D3 removes. Kept rather than deleted, because the interesting half is
  // still here: the block must remain for a path the lane DOES own, and the escape hatch
  // must survive. The full D3 matrix lives in src/test/laneOwnershipScope.test.ts.
  it("a live lane no longer blocks main for paths it does not own (D3), but still does for paths it owns", () => {
    writeRegistry(repo, {
      name: "feature-lane", branch: "lane/feature-lane", worktree: join(root, "feature-lane"),
      owns: ["src/feature.ts"], pid: process.pid, startedAt: nowIso(), lastActive: nowIso(), status: "live",
    });

    // docs/note.md is owned by no lane. Before D3 the main-worktree gate refused it
    // anyway; a lane scoped to src/feature.ts has no claim on it and now must not.
    sh("echo change > docs/note.md && git add docs/note.md", repo);
    const unowned = lane(repo, "check-staged");
    expect(unowned.status).toBe(0);
    expect(unowned.stderr).not.toContain("MAIN WORKTREE — COMMIT BLOCKED");

    // The same lane, the same main worktree, a path it DOES own: still refused, and the
    // refusal names the lane so the fix is obvious.
    sh("git reset -q && mkdir -p src && echo change > src/feature.ts && git add src/feature.ts", repo);
    const owned = lane(repo, "check-staged");
    expect(owned.status).toBe(1);
    expect(owned.stderr).toContain("MAIN WORKTREE — COMMIT BLOCKED");
    expect(owned.stderr).toContain("feature-lane");

    // LANE_MAIN_RECOVERY covers the MAIN-WORKTREE gate, not cross-lane ownership — so it
    // does NOT release a path another live lane owns. Pre-existing behaviour, pinned here
    // because the banner above advertises the hatch and it is worth being explicit about
    // what it does not buy: for an owned path the answer is to unstage it or park the
    // lane, not to set an env var.
    const recoveryOnOwned = laneWithEnv(repo, { LANE_MAIN_RECOVERY: "1" }, "check-staged");
    expect(recoveryOnOwned.status).toBe(1);

    // On an UNOWNED path the hatch is moot after D3 — that commit no longer needs it.
    sh("git reset -q && echo change > docs/note.md && git add docs/note.md", repo);
    expect(laneWithEnv(repo, { LANE_MAIN_RECOVERY: "1" }, "check-staged").status).toBe(0);
  }, process.platform === "win32" ? 20_000 : 5_000);

  it("NEW PATH: lane:park releases ownership so the same commit succeeds — no --no-verify", () => {
    const wt = join(root, "docs-lane");
    writeRegistry(repo, {
      name: "docs-lane", branch: "lane/docs-lane", worktree: wt,
      owns: ["docs/**"], pid: process.pid, startedAt: nowIso(), lastActive: nowIso(), status: "live",
    });
    sh("echo change > docs/note.md && git add docs/note.md", repo);
    expect(ownershipProbe(repo).status).toBe(1); // blocked before park

    const parked = lane(repo, "park", "docs-lane");
    expect(parked.status).toBe(0);
    const reg = readRegistry(repo);
    expect(reg.status).toBe("parked");
    // Park PRESERVES everything — branch, worktree, owns are all intact for resume.
    expect(reg.branch).toBe("lane/docs-lane");
    expect(reg.worktree).toBe(wt);
    expect(reg.owns).toEqual(["docs/**"]);

    // The guard now lets the owned file through — the deadlock is broken cleanly.
    // Bare, with no env var: parking left ZERO live lanes, so neither the ownership
    // rule nor the (lane-live-only) main-worktree gate has anything to enforce.
    const after = lane(repo, "check-staged");
    expect(after.status).toBe(0);
    expect(after.stderr).not.toContain("COMMIT BLOCKED");
  });

  it("lane:resume restores ownership (guard blocks the owned path again)", () => {
    writeRegistry(repo, {
      name: "docs-lane", branch: "lane/docs-lane", worktree: join(root, "docs-lane"),
      owns: ["docs/**"], pid: process.pid, startedAt: nowIso(), lastActive: nowIso(), status: "parked", parkedReason: "manual",
    });
    // While parked, another session commits an owned path freely — no env var needed.
    sh("echo other > docs/other.md && git add docs/other.md", repo);
    expect(lane(repo, "check-staged").status).toBe(0);
    sh("git commit -qm 'other session commits owned path'", repo);

    // Resume re-claims ownership (re-anchoring the pid to this live session)…
    expect(lane(repo, "resume", "docs-lane").status).toBe(0);
    const resumed = readRegistry(repo);
    expect(resumed.status).toBe("live");
    // The command runs in a short-lived child under Vitest, unlike a real terminal
    // session. Keep the registry live with this test process so the assertion below
    // exercises ownership restoration rather than subprocess-parent timing.
    writeRegistry(repo, { ...resumed, pid: process.pid, lastActive: nowIso() });
    // …and the guard enforces docs/** again.
    sh("echo more > docs/more.md && git add docs/more.md", repo);
    const reblocked = ownershipProbe(repo); // lane is live again → lift the main gate
    expect(reblocked.status).toBe(1);
    expect(reblocked.stderr).toContain("LANE OWNERSHIP — COMMIT BLOCKED");
    // Timeout raised above the 5s default because this test drives several real lane
    // subprocesses, and on Windows each lane:start/lane:resume resolves its session
    // anchor through a PowerShell process query (~600ms, almost all of it interpreter
    // startup). That cost is real and intentional — see sessionAnchor() — so the budget
    // reflects it rather than the test being flaky.
  }, 20_000);

  it("a lane whose agent has exited reports INACTIVE and self-releases to parked — branch + worktree untouched", () => {
    const wt = join(root, "docs-lane");
    writeRegistry(repo, {
      name: "docs-lane", branch: "lane/docs-lane", worktree: wt,
      owns: ["docs/**"], pid: DEAD_PID, startedAt: nowIso(), lastActive: nowIso(), status: "live",
    });
    // Ownership is NOT enforced for a dead-pid lane… (bare: reaping it to parked
    // leaves zero LIVE lanes, so the main-worktree gate is inert too.)
    sh("echo x > docs/note.md && git add docs/note.md", repo);
    expect(lane(repo, "check-staged").status).toBe(0);
    // …and it self-degrades to parked (never abandoned — a liveness heuristic must not delete).
    const reg = readRegistry(repo);
    expect(reg.status).toBe("parked");
    expect(reg.parkedReason).toBe("inactive");
    expect(reg.branch).toBe("lane/docs-lane"); // branch reference preserved
    expect(reg.worktree).toBe(wt);             // worktree reference preserved
  });

  it("lane:ship preflight reports MULTIPLE broken preconditions at once, before running any gate", () => {
    // A real lane worktree so lane:ship recognizes it.
    sh("git branch lane/pf", repo);
    const wt = join(root, "pf");
    sh(`git worktree add -q "${wt}" lane/pf`, repo);
    writeRegistry(repo, {
      name: "pf", branch: "lane/pf", worktree: wt,
      owns: ["src/**"], pid: process.pid, startedAt: nowIso(), lastActive: nowIso(), status: "live",
    });
    // Break TWO external preconditions inside the lane worktree:
    //   (1) dirty tree, (2) iOS dev live-reload URL leaked into capacitor.config.json
    mkdirSync(join(wt, "ios/App/App"), { recursive: true });
    writeFileSync(join(wt, "ios/App/App/capacitor.config.json"), JSON.stringify({ server: { url: "http://192.168.1.9:8080" } }));
    writeFileSync(join(wt, "stray.txt"), "scratch");

    const r = lane(wt, "ship");
    const out = r.stdout + r.stderr;
    expect(r.status).toBe(1);
    expect(out).toContain("live-reload URL");     // precondition (2) reported
    expect(out).toContain("lane worktree is dirty"); // precondition (1) reported
    // Crucially, NO gates ran — the whole point is to fail cheap.
    expect(out).not.toMatch(/typecheck:crash|npm run test|npm run build/);
  }, process.platform === "win32" ? 20_000 : 5_000);
});
