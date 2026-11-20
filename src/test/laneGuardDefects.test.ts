/**
 * Regression suite for two lane-guard defects found 2026-08-02. Both are in the guard
 * every other rule in this repo depends on being correct, so both get a test that fails
 * against the old behavior.
 *
 * (a) OWNERSHIP MISREAD. `lane:start --owns "a b c"` split on commas only, so all three
 *     globs were stored as ONE space-joined registry entry. minimatch matched none of
 *     them, so the lane owned NOTHING: its own commits reported "owned by no lane", and
 *     the pre-commit dependency rule — which asks whether SELF owns package.json —
 *     refused the lane's own package.json. Fixed on both sides: lane:start splits on
 *     whitespace too, and every ownership read normalizes via expandOwns() so registries
 *     already on disk in the broken shape start working rather than silently owning
 *     nothing.
 *
 * (b) UNBOUNDED RECURSION. reapDeadLanes() salvages an inactive lane's dirty tree with a
 *     real `git commit`, which runs .githooks/pre-commit, which runs `lane.mjs
 *     check-staged`, whose first act is reapDeadLanes(). The lane is only marked parked
 *     AFTER the commit returns, so every nested level saw status 'live' + dirty and
 *     salvaged again:
 *
 *       reap -> git commit -> pre-commit -> check-staged -> reap -> git commit -> ...
 *
 *     One `npm run lane:status` produced 10+ concurrent check-staged processes and hung
 *     an unrelated `git commit` for two minutes. The guard is an ENV VAR, not a
 *     module-level boolean, because the recursion crosses process boundaries.
 */
import { describe, it, expect, afterEach } from "vitest";
import { ownsFile, expandOwns, ownershipConflicts, globsConflict, reapDeadLanes } from "../../scripts/lib/lanes.mjs";

describe("lane ownership globs (defect a)", () => {
  const PATHS = ["scripts/lane.mjs", "scripts/lib/lanes.mjs", "src/test/foo.test.ts"];

  it("matches every path in a SPACE-JOINED legacy registry entry", () => {
    // Exactly what lane:start wrote before the fix, and what is still on disk for any
    // lane registered earlier. Pre-fix this returned false for all three.
    const owns = ["scripts/lane.mjs scripts/lib/lanes.mjs src/test/", "docs/handoffs/lane-x.md"];
    for (const p of PATHS) expect(ownsFile(owns, p)).toBe(true);
    expect(ownsFile(owns, "docs/handoffs/lane-x.md")).toBe(true);
  });

  it("still matches a properly split list, and still refuses a non-owned path", () => {
    const owns = ["scripts/lane.mjs", "scripts/lib/lanes.mjs", "src/test/"];
    for (const p of PATHS) expect(ownsFile(owns, p)).toBe(true);
    expect(ownsFile(owns, "src/pages/Foo.tsx")).toBe(false);
    expect(ownsFile(owns, "package.json")).toBe(false);
  });

  it("tolerates a comma-joined entry too, and normalizes both shapes identically", () => {
    expect(ownsFile(["a/b.ts,c/d.ts"], "c/d.ts")).toBe(true);
    expect(expandOwns(["a b", "c,d", " e "])).toEqual(["a", "b", "c", "d", "e"]);
    expect(expandOwns([])).toEqual([]);
    expect(expandOwns(undefined as unknown as string[])).toEqual([]);
  });

  // Third instance of the same class, found by this suite: `--owns "scripts/"` is
  // accepted by lane:start and reads as "this directory", but minimatch treats it as a
  // literal path matching no file — so that lane owned nothing either.
  it("treats a TRAILING-SLASH entry as the directory it obviously means", () => {
    expect(ownsFile(["src/test/"], "src/test/foo.test.ts")).toBe(true);
    expect(ownsFile(["src/test/"], "src/test/deep/nested.test.ts")).toBe(true);
    expect(ownsFile(["scripts/"], "scripts/lib/lanes.mjs")).toBe(true);
    // and it must not leak into a sibling directory with the same prefix
    expect(ownsFile(["src/test/"], "src/tests-other/foo.ts")).toBe(false);
    expect(expandOwns(["scripts/"])).toEqual(["scripts/**"]);
    // A bare directory name without the slash is deliberately NOT rewritten — it is
    // indistinguishable from an extensionless file path.
    expect(expandOwns(["scripts"])).toEqual(["scripts"]);
  });

  it("does not invent ownership from an empty or whitespace-only entry", () => {
    expect(ownsFile(["   "], "anything.ts")).toBe(false);
    expect(ownsFile([], "anything.ts")).toBe(false);
  });
});

/**
 * (c) THE OVERLAP CHECK DID NOT EXPAND, so it disagreed with the check that does.
 *
 * Found 2026-08-06 the expensive way: lane `detection-log` was granted
 * `src/test/agentDetectionLog.test.ts` while live lane `admin-tests` owned `src/test/`,
 * and pre-commit then blocked that file after the work was finished. `ownsFile()`
 * normalizes through `expandOwns()`; `ownershipConflicts()` compared the RAW globs, and
 * `concreteRep('src/test/')` is still `src/test/`, which minimatch matches against no
 * file path in either direction. Same shape as defect (a) one level up — the
 * normalization was added to the read path and never to the overlap check.
 *
 * The failure direction is what makes it worth a test: lane:start says yes, so the work
 * gets DONE, and the refusal arrives at commit time when the only remaining options are
 * to park someone else's lane or to hand-carry the file.
 */
describe("ownership overlap detection (defect c)", () => {
  const live = (name: string, owns: string[]) => ({
    name,
    owns,
    status: "live",
    startedAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
    pid: process.pid,
    worktree: `/tmp/dc-lanes/${name}`,
  });

  it("refuses a FILE inside a directory a live lane already owns", () => {
    const lanes = [live("admin-tests", ["src/test/", "src/pages/admin/"])];
    const hits = ownershipConflicts(["src/test/agentDetectionLog.test.ts"], lanes);
    expect(hits).toHaveLength(1);
    expect(hits[0].lane).toBe("admin-tests");
    // The refusal names what the human declared, not the glob we derived from it.
    expect(hits[0].owned).toBe("src/test/");
    expect(hits[0].requested).toBe("src/test/agentDetectionLog.test.ts");
  });

  it("catches it in the other direction too — a DIRECTORY over an owned file", () => {
    const lanes = [live("other", ["src/test/agentDetectionLog.test.ts"])];
    expect(ownershipConflicts(["src/test/"], lanes)).toHaveLength(1);
  });

  it("catches a nested directory claim under an owned directory", () => {
    const lanes = [live("other", ["src/"])];
    expect(ownershipConflicts(["src/components/marketplace/"], lanes)).toHaveLength(1);
  });

  it("still lets genuinely disjoint lanes coexist — the common case must not regress", () => {
    const lanes = [live("admin-tests", ["src/test/", "src/pages/admin/", "supabase/tests/"])];
    expect(ownershipConflicts(["scripts/lib/agent-detection-log.mjs"], lanes)).toEqual([]);
    expect(ownershipConflicts(["docs/dev-loop.md", "package.json"], lanes)).toEqual([]);
    // A sibling directory sharing a prefix is not an overlap.
    expect(ownershipConflicts(["src/tests-other/"], lanes)).toEqual([]);
  });

  it("normalizes a space- or comma-joined declaration on BOTH sides", () => {
    // The legacy registry shape from defect (a), still on disk for older lanes.
    const lanes = [live("legacy", ["src/test/ src/pages/admin/"])];
    expect(ownershipConflicts(["src/test/foo.test.ts"], lanes)).toHaveLength(1);
    expect(ownershipConflicts(["src/test/foo.test.ts,docs/x.md"], lanes)).toHaveLength(1);
  });

  it("ignores a lane that is not live — parking releases the claim", () => {
    const parked = { ...live("parked", ["src/test/"]), status: "parked" };
    expect(ownershipConflicts(["src/test/foo.test.ts"], [parked])).toEqual([]);
  });

  it("never conflicts a lane with itself (resume re-declares its own globs)", () => {
    const lanes = [live("mine", ["src/test/"])];
    expect(ownershipConflicts(["src/test/foo.test.ts"], lanes, "mine")).toEqual([]);
  });

  it("pins the mechanism: the raw comparison genuinely could not see this", () => {
    // Stands in for a mutation test. Compared RAW — which is what shipped before — these
    // two globs conflict in NEITHER direction, because concreteRep('src/test/') is still
    // 'src/test/' and minimatch matches that against no file path. Compared EXPANDED they
    // do. Without this, the fix reads as an arbitrary call rather than the only one that
    // closes the gap, and a future "simplification" back to raw globs looks harmless.
    expect(globsConflict("src/test/agentDetectionLog.test.ts", "src/test/")).toBe(false);
    expect(globsConflict("src/test/agentDetectionLog.test.ts", "src/test/**")).toBe(true);
    expect(expandOwns(["src/test/"])).toEqual(["src/test/**"]);
  });

  it("keeps agreeing with ownsFile — the two checks answering differently IS the bug", () => {
    // For every path a live lane's globs own, starting a lane that declares that exact
    // path must be refused. This is the invariant defect (c) violated.
    const owns = ["src/test/", "scripts/", "docs/handoffs/lane-x.md"];
    const lanes = [live("holder", owns)];
    for (const p of ["src/test/foo.test.ts", "scripts/lib/lanes.mjs", "docs/handoffs/lane-x.md"]) {
      expect(ownsFile(owns, p)).toBe(true);
      expect(ownershipConflicts([p], lanes).length).toBeGreaterThan(0);
    }
    for (const p of ["src/pages/Foo.tsx", "package.json"]) {
      expect(ownsFile(owns, p)).toBe(false);
      expect(ownershipConflicts([p], lanes)).toEqual([]);
    }
  });
});

describe("reapDeadLanes re-entrancy (defect b)", () => {
  const prev = process.env.DC_LANE_REAPING;
  afterEach(() => {
    if (prev === undefined) delete process.env.DC_LANE_REAPING;
    else process.env.DC_LANE_REAPING = prev;
  });

  // An inactive lane the sweep WOULD act on: explicitly live, no pid (so liveness falls
  // back to the inactivity clock), last active well past the 90m window. `worktree`
  // points at a path that does not exist, so the sweep classifies and parks it without
  // running git against a real tree — the recursion under test is about whether the
  // function re-enters, not about what git does.
  const inactiveLane = () => [{
    name: "synthetic-inactive",
    branch: "lane/synthetic-inactive",
    worktree: "/nonexistent/dc-lanes/synthetic-inactive",
    owns: ["src/nothing/**"],
    pid: null,
    anchorResolved: true,
    startedAt: "2026-01-01T00:00:00.000Z",
    lastActive: "2026-01-01T00:00:00.000Z",
    status: "live",
  }];

  it("is a NO-OP when DC_LANE_REAPING is already set (the hook's child process)", () => {
    process.env.DC_LANE_REAPING = "1";
    const lanes = inactiveLane();
    const r = reapDeadLanes({ lanes });
    expect(r.parked).toEqual([]);
    expect(r.parkedWithWork).toEqual([]);
    // and it must not have mutated the lane it declined to sweep
    expect(lanes[0].status).toBe("live");
  });

  it("sweeps normally when the flag is NOT set", () => {
    delete process.env.DC_LANE_REAPING;
    const lanes = inactiveLane();
    const r = reapDeadLanes({ lanes });
    expect(r.parked.map((l: { name: string }) => l.name)).toEqual(["synthetic-inactive"]);
    expect(lanes[0].status).toBe("parked");
  });

  it("sets the flag DURING the sweep, so a nested call re-enters as a no-op", () => {
    delete process.env.DC_LANE_REAPING;
    const lanes = inactiveLane();
    let flagDuring: string | undefined;
    let nested: ReturnType<typeof reapDeadLanes> | null = null;
    reapDeadLanes({
      lanes,
      // `log` fires from inside the sweep — the same position the salvage commit
      // occupies. Pre-fix, a nested call here swept and salvaged all over again.
      log: () => {
        flagDuring = process.env.DC_LANE_REAPING;
        nested = reapDeadLanes({ lanes: inactiveLane() });
      },
    });
    expect(flagDuring).toBe("1");
    expect(nested).not.toBeNull();
    expect(nested!.parked).toEqual([]);
  });

  it("restores the previous flag value after the sweep, including when unset", () => {
    delete process.env.DC_LANE_REAPING;
    reapDeadLanes({ lanes: inactiveLane() });
    expect("DC_LANE_REAPING" in process.env).toBe(false);

    process.env.DC_LANE_REAPING = "0";
    reapDeadLanes({ lanes: inactiveLane() });
    expect(process.env.DC_LANE_REAPING).toBe("0");
  });
});
