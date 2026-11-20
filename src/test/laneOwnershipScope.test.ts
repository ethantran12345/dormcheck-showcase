/**
 * Regression suite for ADR 0001 §D3 and the two bugs it surfaced (2026-08-16).
 *
 * (D3) THE MAIN-WORKTREE BLOCK WAS GLOBAL. Any live lane blocked EVERY commit in main,
 *      including for files that lane never claimed. Combined with a lane owning
 *      `docs/handoffs/` — a collision lane:start itself created — it shut both commit
 *      routes at once and froze the repo outright. It is now path-scoped, staying blunt
 *      only when a lane declares broad ownership.
 *
 * (MID-MERGE) `git merge` fires pre-merge-commit, but a CONFLICTED merge is finished by
 *      hand with `git commit`, which fires pre-commit. The exemption covered only the
 *      dependency rule, so the clean path was exempt and the conflict path was not —
 *      and merging a lane necessarily stages that lane's own files, starting with its
 *      handoff. Measured: shipping lane lv1-delegation-class could not be completed in
 *      main while that same lane was live.
 *
 * (PACKAGE.JSON) The dependency rule could not tell a `scripts` entry from real
 *      dependency churn, so a one-line script addition needed a whole dependency lane.
 *
 * These drive the REAL scripts/lane.mjs against a throwaway repo, so what is under test
 * is the shipped code path rather than a re-implementation of its rules.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// DC_TEST_LANE_MJS points the suite at a DIFFERENT build of the guard, which is how
// "these fail against the old behaviour" was demonstrated rather than asserted:
//   DC_TEST_LANE_MJS=<pre-D3 lane.mjs> npx vitest run src/test/laneOwnershipScope.test.ts
// gives 4 failures, measured: the D3 unowned-allow case, the D3 named-block case (the
// old message named neither the path nor its lane), the mid-merge case, and the
// package.json scripts-only case. The other 6 pass against both builds by design —
// they pin behaviour this change must NOT alter. Defaults to the copy shipping
// alongside this test.
const LANE_MJS = process.env.DC_TEST_LANE_MJS || resolve(__dirname, "../../scripts/lane.mjs");

let repo: string;

const git = (args: string[], cwd = repo) =>
  spawnSync("git", args, { cwd, encoding: "utf8" });

/**
 * Run the real guard in `repo` and return its exit code plus combined output.
 *
 * GITHUB_ACTIONS IS CLEARED unless a case sets it back. checkStaged() has a deliberate
 * runner exemption — on a runner, a commit whose staged set is ENTIRELY dependency paths
 * is allowed without a lane, because a runner is a throwaway single-purpose clone with no
 * second agent (that is what lets Dependabot Triage commit a lockfile). Inheriting the
 * ambient environment therefore made three of these cases pass locally and fail in CI,
 * which is exactly what happened on 5cc31acb: the guard was right both times and the test
 * was asking a different question depending on where it ran. A test that changes its
 * subject with the environment is not testing anything.
 */
const checkStaged = (env: Record<string, string> = {}) => {
  const r = spawnSync("node", [LANE_MJS, "check-staged"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "", ...env },
  });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
};

/** A live lane owning `owns`. pid is this process so the reaper leaves it alone. */
const writeLanes = (lanes: Array<{ name: string; owns: string[] }>) =>
  writeFileSync(
    join(repo, ".git", "dc-lanes.json"),
    JSON.stringify(
      {
        lanes: lanes.map((l) => ({
          name: l.name,
          branch: `lane/${l.name}`,
          // A path that is NOT this repo, so the guard treats us as the main worktree.
          worktree: join(tmpdir(), "dc-lanes-absent", l.name),
          owns: l.owns,
          status: "live",
          pid: process.pid,
          startedAt: new Date().toISOString(),
          lastActive: new Date().toISOString(),
        })),
      },
      null,
      2,
    ),
  );

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "dc-d3-"));
  git(["init", "-q", "-b", "dev"]);
  git(["config", "user.email", "t@t.t"]);
  git(["config", "user.name", "t"]);
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "package.json"), `${JSON.stringify({ name: "t", scripts: { a: "a" }, dependencies: { left: "^1.0.0" } }, null, 2)}\n`);
  writeFileSync(join(repo, "docs", "owned.md"), "base\n");
  writeFileSync(join(repo, "docs", "free.md"), "base\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("D3 — the main-worktree block is path-scoped", () => {
  it("ALLOWS a staged path no live lane owns (the case that was broken)", () => {
    writeLanes([{ name: "other-lane", owns: ["docs/owned.md"] }]);
    writeFileSync(join(repo, "docs", "free.md"), "edited\n");
    git(["add", "docs/free.md"]);

    const { code, out } = checkStaged();
    expect(code).toBe(0);
    // It should say the file is unowned rather than block on it.
    expect(out).toMatch(/owned by no lane/i);
  });

  it("BLOCKS a staged path a live lane owns, and names that lane", () => {
    writeLanes([{ name: "other-lane", owns: ["docs/owned.md"] }]);
    writeFileSync(join(repo, "docs", "owned.md"), "edited\n");
    git(["add", "docs/owned.md"]);

    const { code, out } = checkStaged();
    expect(code).toBe(1);
    expect(out).toContain("other-lane");
    expect(out).toContain("docs/owned.md");
  });

  it("keeps the GLOBAL block when a live lane declares broad ownership", () => {
    // src/** is in BROAD_OWNERSHIP_GLOBS. The staged file is still unowned, but a lane
    // that owns everything can sweep anything, so precision is not available here.
    writeLanes([{ name: "broad-lane", owns: ["src/**"] }]);
    writeFileSync(join(repo, "docs", "free.md"), "edited\n");
    git(["add", "docs/free.md"]);

    const { code, out } = checkStaged();
    expect(code).toBe(1);
    expect(out).toMatch(/BROAD/i);
    expect(out).toContain("broad-lane");
  });

  it("still allows everything when no lane is live at all", () => {
    writeLanes([]);
    writeFileSync(join(repo, "docs", "owned.md"), "edited\n");
    git(["add", "docs/owned.md"]);
    expect(checkStaged().code).toBe(0);
  });
});

describe("mid-merge — finishing a conflicted merge is integration, not authoring", () => {
  /**
   * Builds a real add/add conflict so MERGE_HEAD is genuinely present. The staged set
   * includes a file the live lane owns, which is what a lane merge always looks like.
   */
  const conflictedMerge = () => {
    git(["checkout", "-q", "-b", "side"]);
    writeFileSync(join(repo, "docs", "owned.md"), "side\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "side"]);
    git(["checkout", "-q", "dev"]);
    writeFileSync(join(repo, "docs", "owned.md"), "dev\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "dev"]);
    git(["merge", "--no-ff", "side"]); // conflicts
    writeFileSync(join(repo, "docs", "owned.md"), "resolved\n");
    git(["add", "docs/owned.md"]);
  };

  it("ALLOWS the commit that completes a conflicted merge, lane still live", () => {
    writeLanes([{ name: "other-lane", owns: ["docs/owned.md"] }]);
    conflictedMerge();
    expect(checkStaged().code).toBe(0);
  });

  it("still BLOCKS the same staged path when no merge is in progress", () => {
    // The exemption must be reachable only from genuine MERGE_HEAD state — otherwise it
    // is just a hole in the ownership rule.
    writeLanes([{ name: "other-lane", owns: ["docs/owned.md"] }]);
    writeFileSync(join(repo, "docs", "owned.md"), "edited\n");
    git(["add", "docs/owned.md"]);
    expect(checkStaged().code).toBe(1);
  });
});

describe("package.json — gate the dependency graph, not the scripts block", () => {
  const stagePackageJson = (mutate: (p: Record<string, unknown>) => void) => {
    const pkg = { name: "t", scripts: { a: "a" }, dependencies: { left: "^1.0.0" } } as Record<string, unknown>;
    mutate(pkg);
    writeFileSync(join(repo, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    git(["add", "package.json"]);
  };

  it("ALLOWS a scripts-only edit outside a dependency lane", () => {
    writeLanes([]);
    stagePackageJson((p) => {
      (p.scripts as Record<string, string>)["docs:assemble"] = "node scripts/docs-assemble.mjs";
    });
    expect(checkStaged().code).toBe(0);
  });

  it("REFUSES a dependencies edit outside a dependency lane", () => {
    writeLanes([]);
    stagePackageJson((p) => {
      (p.dependencies as Record<string, string>)["left-pad"] = "^1.3.0";
    });
    const { code, out } = checkStaged();
    expect(code).toBe(1);
    expect(out).toContain("dependency lane");
  });

  it("REFUSES a devDependencies edit too", () => {
    writeLanes([]);
    stagePackageJson((p) => {
      p.devDependencies = { vitest: "^1.0.0" };
    });
    expect(checkStaged().code).toBe(1);
  });

  it("REFUSES a lockfile unconditionally, even with no dependency key change", () => {
    writeLanes([]);
    writeFileSync(join(repo, "package-lock.json"), '{"lockfileVersion":3}\n');
    git(["add", "package-lock.json"]);
    expect(checkStaged().code).toBe(1);
  });

  // The runner exemption these three cases have to opt OUT of, pinned deliberately rather
  // than left as ambient behaviour nobody named. On a runner a PURE dependency commit is
  // allowed without a lane — that is what lets Dependabot Triage land a lockfile — but the
  // set must be entirely dependency paths, so a lockfile smuggled in beside something else
  // is still refused.
  it("on a CI runner, allows a PURE dependency commit but still refuses a mixed one", () => {
    writeLanes([]);
    writeFileSync(join(repo, "package-lock.json"), '{"lockfileVersion":3}\n');
    git(["add", "package-lock.json"]);
    expect(checkStaged({ GITHUB_ACTIONS: "true" }).code).toBe(0);

    writeFileSync(join(repo, "docs", "free.md"), "unrelated\n");
    git(["add", "docs/free.md"]);
    expect(checkStaged({ GITHUB_ACTIONS: "true" }).code).toBe(1);
  });
});
