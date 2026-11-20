/**
 * Regression suite: THE PEER-DETECTION FORENSIC LOG (2026-08-06).
 *
 * The session registry shipped advisory, with two follow-ups explicitly gated on "once the
 * false-positive rate is known" — promoting the banner to a commit-time block, and
 * broadening identity beyond the `claude` process so Codex counts as a peer. Neither gate
 * was reachable, because nothing measured anything: the banner printed to a terminal, the
 * wip skip printed to a hook's stderr, and both vanished with the session.
 *
 * scripts/lib/agent-detection-log.mjs is the instrument. What is asserted here:
 *   1. every peer evaluation is recorded — the skip AND the proceed, because a rate needs
 *      a denominator,
 *   2. each claimed peer carries the `ps` evidence captured at the moment of the claim,
 *      which is what makes a false positive PROVABLE rather than remembered,
 *   3. the adjudicator scores those records: a claimed peer that was not an agent process
 *      is SUSPECT, and "we could not look" is scored as unknown, never as wrong,
 *   4. an unclean death is visible as activity with no `session-end` and a dead pid,
 *   5. logging can NEVER cost an auto-save — a broken log still commits.
 *
 * (5) is the load-bearing one. This module is imported by the Stop hook, which is the
 * auto-save safety net; a measuring instrument that breaks the thing it measures is worse
 * than no measurement at all.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { summarize } from "../../scripts/lib/agent-detection-log.mjs";

const WIP = resolve("scripts/wip.mjs");

/** Above the platform maximum, so kill(pid, 0) throws ESRCH and pidAlive() reports false. */
const DEAD_PID = 2_147_483_600;

function sh(cmd: string, cwd: string) {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cmd failed (${cmd}): ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

let repo: string;

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "dc-detect-log-"));
  sh("git init -q -b dev .", dir);
  sh('git config user.email "t@e.st" && git config user.name "T"', dir);
  sh("git config core.hooksPath /dev/null", dir);
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  sh("git add -A && git commit -qm seed", dir);
  return dir;
}

const logPath = () => join(repo, ".git", "dc-agent-detections.jsonl");
type Peer = { id: string; pid: number | null; alive: boolean; comm: string | null };
type Record_ = {
  event: string;
  me: { id: string | null; pid: number; resolved: boolean };
  peers: Peer[];
  ancestry: { pid: number; comm: string }[];
  psAvailable: boolean;
};
const readLog = (): Record_[] =>
  existsSync(logPath())
    ? readFileSync(logPath(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

const writeRegistry = (reg: unknown) =>
  writeFileSync(join(repo, ".git", "dc-agent-sessions.json"), JSON.stringify(reg, null, 2) + "\n");

/**
 * A peer row backed by a pid that IS alive (this vitest process) but is NOT an agent
 * process. That combination is exactly the failure the log exists to expose: `kill(pid, 0)`
 * says live, `ps` says "node".
 */
const peer = (id: string, worktree: string, pid = process.pid) => ({
  id: `session:${id}`,
  label: id,
  pid,
  source: "env",
  worktree,
  startedAt: new Date().toISOString(),
  lastSeen: new Date().toISOString(),
});

function runWipHook(id: string, paths: string, extraEnv: Record<string, string> = {}) {
  return spawnSync("node", [WIP, "--hook"], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      DC_AGENT_SESSION_ID: id,
      DC_AGENT_SESSION_PID: String(process.pid),
      WIP_PATHS: paths,
      DORMCHECK_WIP_DISABLE: "",
      WIP_DISABLE: "",
      ...extraEnv,
    },
  });
}

const commitCount = () => Number(sh("git rev-list --count HEAD", repo));

beforeEach(() => { repo = makeRepo(); });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe("every peer evaluation is recorded", () => {
  it("logs a wip-skip naming the peer, with the ps evidence behind the claim", () => {
    writeRegistry({ sessions: [peer("other-tab", repo)], resources: {} });
    writeFileSync(join(repo, "shared.txt"), "half-finished edit\n");

    const r = runWipHook("mine", "shared.txt");
    expect(r.stderr).toContain("SKIPPING the auto-save");

    const records = readLog();
    const skip = records.find((x) => x.event === "wip-skip");
    expect(skip).toBeTruthy();
    expect(skip!.me.id).toBe("session:mine");
    expect(skip!.peers).toHaveLength(1);
    expect(skip!.peers[0].id).toBe("session:other-tab");
    // Capture what the platform process lookup called that pid. Unix `ps` returns a
    // command string; Windows may preserve an explicit null when no equivalent command
    // name is available, which is still evidence rather than a fabricated identity.
    expect(skip!.peers[0].alive).toBe(true);
    expect(skip!.peers[0]).toHaveProperty("comm");
    expect(skip!.peers[0].comm === null || typeof skip!.peers[0].comm === "string").toBe(true);
    // And how THIS process would have been identified — the walk identity resolution makes.
    expect(Array.isArray(skip!.ancestry)).toBe(true);
    if (process.platform !== "win32") {
      expect(skip!.ancestry.length).toBeGreaterThan(0);
    }
  });

  it("logs the PROCEED case too — a rate is meaningless without its denominator", () => {
    writeRegistry({ sessions: [], resources: {} });
    writeFileSync(join(repo, "mine.txt"), "my work\n");

    const r = runWipHook("mine", "mine.txt");
    expect(r.stderr).not.toContain("SKIPPING");

    const records = readLog();
    expect(records.some((x) => x.event === "wip-alone")).toBe(true);
    expect(records.find((x) => x.event === "wip-alone")!.peers).toEqual([]);
  });

  it("writes one parseable JSON object per line, in the git dir", () => {
    writeFileSync(join(repo, "mine.txt"), "my work\n");
    runWipHook("a", "mine.txt");
    runWipHook("b", "mine.txt");
    const raw = readFileSync(logPath(), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
  });

  it("records nothing when DC_DETECTION_LOG=0", () => {
    writeFileSync(join(repo, "mine.txt"), "my work\n");
    runWipHook("mine", "mine.txt", { DC_DETECTION_LOG: "0" });
    expect(existsSync(logPath())).toBe(false);
  });
});

describe("logging can never cost an auto-save", () => {
  it("still commits when the log path is unwritable", () => {
    // A directory where the log file should be: appendFileSync throws EISDIR every time.
    mkdirSync(logPath(), { recursive: true });
    writeFileSync(join(repo, "mine.txt"), "my work\n");
    const before = commitCount();

    const r = runWipHook("mine", "mine.txt");

    expect(r.status).toBe(0);
    expect(commitCount()).toBe(before + 1);
    expect(sh("git show --name-only --format= HEAD", repo)).toBe("mine.txt");
  });

  it("still SKIPS correctly when the log path is unwritable", () => {
    mkdirSync(logPath(), { recursive: true });
    writeRegistry({ sessions: [peer("other-tab", repo)], resources: {} });
    writeFileSync(join(repo, "shared.txt"), "half-finished\n");
    const before = commitCount();

    const r = runWipHook("mine", "shared.txt");

    expect(r.stderr).toContain("SKIPPING the auto-save");
    expect(commitCount()).toBe(before);
  });
});

// ── the adjudicator: pure over records, so the verdict never depends on this machine ──
const rec = (o: Record<string, unknown>) => ({
  iso: new Date().toISOString(),
  event: "wip-skip",
  me: { id: "session:mine", pid: 111, source: "env", resolved: true },
  peers: [],
  psAvailable: true,
  ...o,
});

describe("summarize scores the records", () => {
  it("corroborates a peer that ps confirmed was an agent process", () => {
    const sum = summarize([rec({ peers: [{ id: "cli:9", pid: 9, alive: true, comm: "claude" }] })]);
    expect(sum.detections).toBe(1);
    expect(sum.suspects).toHaveLength(0);
  });

  it("flags a claimed peer whose pid was NOT an agent process — a provable false positive", () => {
    const sum = summarize([rec({ peers: [{ id: "cli:9", pid: 9, alive: true, comm: "zsh" }] })]);
    expect(sum.suspects).toHaveLength(1);
    expect(sum.suspects[0].peer.comm).toBe("zsh");
  });

  it("flags a claimed peer whose pid ps did not know about at all", () => {
    const sum = summarize([rec({ peers: [{ id: "cli:9", pid: 9, alive: true, comm: null }] })]);
    expect(sum.suspects).toHaveLength(1);
  });

  it("scores 'we could not look' as unknown, never as wrong", () => {
    const sum = summarize([
      rec({ psAvailable: false, peers: [{ id: "cli:9", pid: 9, alive: true, comm: null }] }),
    ]);
    expect(sum.detections).toBe(1);
    expect(sum.suspects).toHaveLength(0);
  });

  it("counts unresolved identity separately — it is the fail-open path, not a detection", () => {
    const sum = summarize([rec({ me: { id: null, pid: 0, source: "unknown", resolved: false } })]);
    expect(sum.unresolved).toBe(1);
    expect(sum.detections).toBe(0);
  });

  it("accepts a full-path comm, the form an app-bundle install reports", () => {
    const sum = summarize([
      rec({ peers: [{ id: "cli:9", pid: 9, alive: true, comm: "/opt/homebrew/bin/claude" }] }),
    ]);
    expect(sum.suspects).toHaveLength(0);
  });
});

describe("summarize sees an unclean death", () => {
  const activity = (id: string, pid: number) =>
    rec({ event: "wip-alone", me: { id, pid, source: "env", resolved: true }, peers: [] });
  const ended = (id: string, pid: number) =>
    rec({ event: "session-end", me: { id, pid, source: "env", resolved: true }, peers: [] });

  it("reports a session that logged activity, never ended, and whose pid is gone", () => {
    const sum = summarize([activity("session:ghost", DEAD_PID)]);
    expect(sum.uncleanExits.map((s) => s.id)).toEqual(["session:ghost"]);
  });

  it("does NOT report a session that deregistered cleanly", () => {
    const sum = summarize([activity("session:tidy", DEAD_PID), ended("session:tidy", DEAD_PID)]);
    expect(sum.uncleanExits).toHaveLength(0);
  });

  it("does NOT report a session that is simply still running", () => {
    const sum = summarize([activity("session:live", process.pid)]);
    expect(sum.uncleanExits).toHaveLength(0);
  });
});

describe("wiring", () => {
  it("exposes the documented read command", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["agent:detections"]).toBe("node scripts/agent-lock.mjs detections");
  });

  it("prints a summary a human can act on", () => {
    writeFileSync(join(repo, "mine.txt"), "my work\n");
    runWipHook("mine", "mine.txt");
    const r = spawnSync("node", [resolve("scripts/agent-lock.mjs"), "detections"], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, DC_AGENT_SESSION_ID: "mine", DC_AGENT_SESSION_PID: String(process.pid) },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("peer detections");
    expect(r.stdout).toContain("SUSPECT");
    expect(r.stdout).toContain("unclean exits");
  });
});
