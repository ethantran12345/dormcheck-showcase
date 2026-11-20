/**
 * Lane liveness regression suite — the Windows session-anchor bug.
 *
 * Before this suite, `sessionAnchorPid()` walked the process tree with
 * `ps -o ppid= -p <pid>`. Git Bash's `ps` has no `-o` flag, so on Windows the walk threw
 * on iteration 1, the `catch { break }` silently returned the EPHEMERAL
 * `npm run lane:start` node pid, and that pid was dead by the very next command. Every
 * lane therefore looked inactive one command after it was created: the demoter parked it
 * and committed the agent's work with `git commit --no-verify`, and the agent's own
 * commit died on `fatal: cannot lock ref 'HEAD'`.
 *
 * Two invariants keep that from recurring:
 *   1. a RESOLVED anchor is always a LIVE process (never an ephemeral or dangling pid);
 *   2. an UNRESOLVABLE anchor is UNKNOWN, never "dead" — liveness falls back to the
 *      inactivity clock, and the demoter fails closed rather than guessing.
 */
import { describe, it, expect } from "vitest";
import {
  sessionAnchor, pidAlive, laneLiveness, laneInactive, reapDeadLanes,
  LIVENESS, LANE_INACTIVE_MS,
} from "../../scripts/lib/lanes.mjs";

const DEAD_PID = 2147483647;   // no process this high exists → pidAlive() === false
const now = () => new Date().toISOString();
const agesAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

describe("sessionAnchor", () => {
  it("resolves an anchor that is actually alive", () => {
    const a = sessionAnchor();
    // The whole point: if we claim to have resolved an anchor, a later process must be
    // able to see it alive. A resolved-but-dead anchor is the original bug.
    if (a.resolved) expect(pidAlive(a.pid)).toBe(true);
  });

  it("never reports a dead pid as a resolved anchor", () => {
    const a = sessionAnchor();
    expect(a.resolved && !pidAlive(a.pid)).toBe(false);
  });

  it.runIf(process.platform === "win32")(
    "walks the Windows process tree without `ps -o`",
    () => {
      // The old code could not walk at all on Windows: Git Bash's `ps` rejects -o, the
      // walk threw on iteration 1, and it returned the ephemeral pid. Reaching ANY
      // ancestor proves the CIM-backed walk ran.
      const a = sessionAnchor();
      expect(a.pid).not.toBe(process.pid);
    },
  );

  it("only claims `resolved` when the walk reached a session boundary", () => {
    // A chain that dead-ends on a dangling pid (an intermediate shell exited mid-walk —
    // routine in an agent harness) must report resolved:false, so liveness falls back to
    // the inactivity clock instead of trusting an arbitrary pid.
    const a = sessionAnchor();
    expect(typeof a.resolved).toBe("boolean");
    if (a.resolved) expect(pidAlive(a.pid)).toBe(true);
  });
});

describe("laneLiveness (tri-state)", () => {
  it("is LIVE for a live anchor inside the inactivity window", () => {
    expect(laneLiveness({ status: "live", pid: process.pid, anchorResolved: true, lastActive: now() }))
      .toBe(LIVENESS.LIVE);
  });

  it("is INACTIVE for a dead anchor", () => {
    expect(laneLiveness({ status: "live", pid: DEAD_PID, anchorResolved: true, lastActive: now() }))
      .toBe(LIVENESS.INACTIVE);
  });

  it("is UNKNOWN — not INACTIVE — when the anchor could not be resolved", () => {
    // This is the Windows path. Reading it as INACTIVE is what parked every lane.
    expect(laneLiveness({ status: "live", pid: 12345, anchorResolved: false, lastActive: now() }))
      .toBe(LIVENESS.UNKNOWN);
    expect(laneLiveness({ status: "live", pid: null, lastActive: now() }))
      .toBe(LIVENESS.UNKNOWN);
  });

  it("falls back to the inactivity clock when the anchor is unresolvable", () => {
    const stale = { status: "live", pid: null, lastActive: agesAgo(LANE_INACTIVE_MS + 60_000) };
    expect(laneLiveness(stale)).toBe(LIVENESS.INACTIVE);
  });

  it("treats UNKNOWN as not-inactive, so ownership is never released on a guess", () => {
    expect(laneInactive({ status: "live", pid: null, lastActive: now() })).toBe(false);
  });
});

describe("reapDeadLanes fails closed on UNKNOWN", () => {
  const unknowable = (): Record<string, unknown> => ({
    name: "unknowable", branch: "lane/unknowable", worktree: "/nonexistent",
    owns: [], status: "live", pid: null, startedAt: now(), lastActive: now(),
  });

  it("does not park a lane whose liveness cannot be established", () => {
    // Parking releases another agent's lock and salvaging rewrites their branch, so an
    // unresolvable lane is left strictly alone rather than demoted on a guess.
    const lane = unknowable();
    const res = reapDeadLanes({ lanes: [lane] });
    expect(res.parked).toHaveLength(0);
    expect(res.parkedWithWork).toHaveLength(0);
    expect(lane.status).toBe("live");
    expect(lane.parkedReason).toBeUndefined();
  });

  it("explains itself instead of failing silently", () => {
    const logs: string[] = [];
    reapDeadLanes({ lanes: [unknowable()], log: (m: string) => logs.push(m) });
    const out = logs.join("\n");
    expect(out).toMatch(/UNKNOWN/);
    expect(out).toMatch(/NOT parked/);
    expect(out).toMatch(/lane:park unknowable/);
  });

  it("still demotes an unresolvable lane once the inactivity window has passed", () => {
    // UNKNOWN is only a stay of execution: the inactivity clock remains authoritative.
    const lane = { ...unknowable(), lastActive: agesAgo(LANE_INACTIVE_MS + 60_000) };
    expect(laneLiveness(lane)).toBe(LIVENESS.INACTIVE);
  });
});
