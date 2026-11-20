/**
 * Regression suite: GIT ACTIVITY IS A LANE HEARTBEAT (defect found 2026-08-02).
 *
 * Only an explicit `lane:*` command used to stamp `lastActive`. A lane being worked hard
 * — commit after commit, with no reason to run a lane command — therefore read INACTIVE
 * after 90 minutes and stopped recognizing ITSELF: `laneIsLive` went false, the
 * pre-commit guard found no `self`, and the lane began enforcing its own rules against
 * its owner (it refused its owner's `package.json` under the dependency rule). Being
 * inactive AND dirty is also the precondition that let the `reapDeadLanes` recursion
 * fire.
 *
 * The timeout is NOT raised here and must not be: releasing a lock held by a DEAD agent
 * is its whole purpose. What changed is what counts as proof of life — an agent that is
 * committing is demonstrably not dead.
 *
 * Attribution is by WORKTREE, not pid. `sessionAnchor()` could name the committing
 * session, but it reports `resolved: false` whenever the process walk dead-ends, which
 * its own comments note happens routinely in an agent harness that spawns a short-lived
 * shell per command. A commit inside a lane's worktree is lane activity by definition.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  touchLaneForWorktree, laneIsLive, LANE_INACTIVE_MS,
} from "../../scripts/lib/lanes.mjs";

const LANE = resolve("scripts/lane.mjs");
const NINETY_MIN_AGO = () => new Date(Date.now() - LANE_INACTIVE_MS - 60_000).toISOString();

function sh(cmd: string, cwd: string) {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cmd failed (${cmd}): ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

describe("touchLaneForWorktree (unit)", () => {
  const live = (over: Record<string, unknown> = {}) => ({
    name: "worked-hard",
    branch: "lane/worked-hard",
    worktree: "/tmp/dc-lanes/worked-hard",
    owns: ["src/x/**"],
    pid: null,
    anchorResolved: true,
    startedAt: NINETY_MIN_AGO(),
    lastActive: NINETY_MIN_AGO(),
    status: "live",
    ...over,
  });

  it("a lane idle past the window reads DEAD before the heartbeat and LIVE after", () => {
    const lane = live();
    expect(laneIsLive(lane)).toBe(false);          // the defect, reproduced
    lane.lastActive = new Date().toISOString();    // what the heartbeat does
    expect(laneIsLive(lane)).toBe(true);
  });

  it("refuses to revive a PARKED lane", () => {
    // Parking is an explicit release of ownership. A stray commit in the worktree must
    // not silently re-take the lock — lane:resume is that door, deliberately.
    const lane = live({ status: "parked" });
    expect(laneIsLive(lane)).toBe(false);
  });

  it("returns null for a path that is not a lane worktree, and for no path", () => {
    expect(touchLaneForWorktree("")).toBeNull();
    expect(touchLaneForWorktree(null as unknown as string)).toBeNull();
    expect(touchLaneForWorktree("/definitely/not/a/lane")).toBeNull();
  });
});

/**
 * End-to-end: drive the REAL `lane.mjs check-staged` (what .githooks/pre-commit runs)
 * against a throwaway repo and a throwaway registry, so the code path under test is the
 * shipped one. The 90 minutes are simulated by backdating `lastActive` — the point is
 * the state, not the wall clock.
 */
describe("a lane committing for >90min with no lane:* command stays live", () => {
  let tmp: string, main: string, wt: string, registry: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "dc-lane-hb-"));
    // A REAL linked worktree, not just a second repo. The main checkout is an
    // inspect-only preview while any lane is live, so a lane worktree that is also the
    // main worktree would trip that block instead of the code under test — the shape of
    // the fixture has to match the shape of the model.
    main = join(tmp, "main");
    wt = join(tmp, "lane-wt");
    mkdirSync(main, { recursive: true });
    sh("git init -q -b main && git config user.email t@t.t && git config user.name t", main);
    writeFileSync(join(main, "seed.txt"), "seed\n");
    sh("git add -A && git commit -q -m seed --no-verify", main);
    sh(`git worktree add -q -b lane/worked-hard ${JSON.stringify(wt)}`, main);

    // lanes.mjs resolves the registry from the git COMMON dir, which every worktree
    // shares — so it lives in the main checkout's .git and the lane worktree sees it.
    registry = join(main, ".git", "dc-lanes.json");
    writeFileSync(registry, JSON.stringify({
      lanes: [{
        name: "worked-hard",
        branch: "lane/worked-hard",
        worktree: wt,
        owns: ["src/**"],
        pid: null,
        anchorResolved: true,
        handoffRequired: false,
        startedAt: NINETY_MIN_AGO(),
        lastActive: NINETY_MIN_AGO(),
        status: "live",
      }],
    }, null, 2));
  });

  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const readLane = () => JSON.parse(readFileSync(registry, "utf8")).lanes[0];

  it("check-staged stamps lastActive, so the lane never trips the inactivity sweep", () => {
    const before = readLane();
    expect(laneIsLive(before)).toBe(false);        // pre-heartbeat: the defect state

    writeFileSync(join(wt, "work.txt"), "commit 1\n");
    sh("git add -A", wt);
    const r = spawnSync("node", [LANE, "check-staged"], { cwd: wt, encoding: "utf8" });
    expect(r.status).toBe(0);

    const after = readLane();
    expect(after.status).toBe("live");             // NOT parked by the sweep
    expect(new Date(after.lastActive).getTime())
      .toBeGreaterThan(new Date(before.lastActive).getTime());
    expect(laneIsLive(after)).toBe(true);
  });

  it("survives a long run of commits: each one re-proves life, none runs a lane command", () => {
    // Six commits, each with lastActive rewound past the window BEFORE it — i.e. the
    // worst case, a lane that would have been reaped between every pair of commits.
    for (let i = 0; i < 6; i++) {
      const reg = JSON.parse(readFileSync(registry, "utf8"));
      reg.lanes[0].lastActive = NINETY_MIN_AGO();
      writeFileSync(registry, JSON.stringify(reg, null, 2));

      writeFileSync(join(wt, `work-${i}.txt`), `commit ${i}\n`);
      sh("git add -A", wt);
      const r = spawnSync("node", [LANE, "check-staged"], { cwd: wt, encoding: "utf8" });
      expect(r.status).toBe(0);

      const lane = readLane();
      expect(lane.status, `commit ${i} parked the lane`).toBe("live");
      expect(laneIsLive(lane), `commit ${i} left the lane reading dead`).toBe(true);
    }
    // 30s on every platform, not just Windows. This body does SIX real `git add` +
    // `git commit` pairs and spawns `node lane check-staged` six times; that is process
    // startup, not computation, and it does not care which OS is slow today. The old
    // `win32 ? 30_000 : 5_000` assumed POSIX would always finish in five seconds, and
    // under a full parallel suite it does not — this test timed out at 5000ms on
    // 2026-09-04 while a sibling suite in the same run took 14.2s. It had been read as
    // a real failure twice: it is what the three-school-feature-demo lane recorded as
    // its "unrelated parallel-load timeout" blocker on 2026-08-28, leaving that lane
    // parked for a week. A timeout tuned to an unloaded machine is a flake generator.
  }, 30_000);

  it("the heartbeat runs BEFORE the sweep — ordering is the whole fix", () => {
    // reapDeadLanes() is checkStaged()'s other early call and it PARKS on the way in. If
    // the heartbeat were placed after it, this lane would come back parked and the fix
    // would be silently inert. Asserting the observable consequence rather than the
    // source order, so a refactor that reorders them fails here.
    const reg = JSON.parse(readFileSync(registry, "utf8"));
    reg.lanes[0].lastActive = NINETY_MIN_AGO();
    writeFileSync(registry, JSON.stringify(reg, null, 2));

    writeFileSync(join(wt, "ordering.txt"), "x\n");
    sh("git add -A", wt);
    spawnSync("node", [LANE, "check-staged"], { cwd: wt, encoding: "utf8" });

    expect(readLane().status).toBe("live");
    expect(readLane().parkedReason).toBeUndefined();
  });

  it("does not touch a lane when the commit happens somewhere else", () => {
    const other = join(tmp, "other-repo");
    mkdirSync(other, { recursive: true });
    sh("git init -q -b main && git config user.email t@t.t && git config user.name t", other);
    writeFileSync(join(other, "f.txt"), "x\n");
    sh("git add -A", other);

    const before = readLane().lastActive;
    spawnSync("node", [LANE, "check-staged"], { cwd: other, encoding: "utf8" });
    // Different repo entirely -> different registry -> our lane is untouched.
    expect(readLane().lastActive).toBe(before);
    expect(existsSync(registry)).toBe(true);
  });
});
