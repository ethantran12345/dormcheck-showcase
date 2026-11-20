import { describe, expect, it } from "vitest";
import { reapDeadLanes } from "../../scripts/lib/lanes.mjs";

describe("closed lane registry cleanup", () => {
  it("prunes only a terminal record whose branch and worktree are already absent", () => {
    const lanes = [{
      name: "already-shipped", branch: "lane/definitely-absent-workflow-test",
      worktree: "/tmp/definitely-absent-workflow-test", status: "shipped",
      owns: [], startedAt: new Date().toISOString(), lastActive: new Date().toISOString(),
    }];
    const result = reapDeadLanes({ lanes });
    expect(result.pruned).toEqual(["already-shipped"]);
    expect(lanes).toEqual([]);
  });

  it("preserves a parked record for lane:resume even when recovery objects are absent", () => {
    const lane = {
      name: "resumable", branch: "lane/definitely-absent-resumable-test",
      worktree: "/tmp/definitely-absent-resumable-test", status: "parked",
      owns: ["docs/**"], startedAt: new Date().toISOString(), lastActive: new Date().toISOString(),
    };
    const lanes = [lane];
    const result = reapDeadLanes({ lanes });
    expect(result.pruned).toEqual([]);
    expect(lanes).toEqual([lane]);
  });

  it("never prunes a live record merely because its recovery objects are unavailable", () => {
    const lane = {
      name: "live-unknown", branch: "lane/definitely-absent-live-test",
      worktree: "/tmp/definitely-absent-live-test", status: "live", pid: null,
      owns: [], startedAt: new Date().toISOString(), lastActive: new Date().toISOString(),
    };
    const lanes = [lane];
    const result = reapDeadLanes({ lanes });
    expect(result.pruned).toEqual([]);
    expect(lanes).toHaveLength(1);
  });
});
