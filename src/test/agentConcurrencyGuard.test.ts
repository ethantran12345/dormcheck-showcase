/**
 * Regression suite: MULTI-SESSION SAFETY IN ONE SHARED WORKING TREE (2026-08-05).
 *
 * Four Claude sessions were started by opening four Herd tabs in the repo root.
 * One working tree, four writers, zero lanes — and the `[auto]` wip Stop hook swept work
 * BETWEEN them into d06ca641 and 90d2a704: two commits nobody authored, each carrying two
 * sessions' work. wip.mjs's transcript scoping was correct per session and still produced
 * this, because on a shared tree two sessions' touched-file sets overlap.
 *
 * What is asserted here, in the order the failure happens:
 *   1. the auto-save SKIPS when another agent is live in the same main worktree,
 *   2. it saves NORMALLY, scoped, the moment it is the only session — the single-session
 *      behaviour that must not regress is the whole reason the guard fails open,
 *   3. a peer in a DIFFERENT worktree (i.e. a lane — the correct configuration) is ignored,
 *   4. the single local Supabase stack is a real claim: the second holder is REFUSED,
 *      and a claim whose holder is dead is stolen rather than deadlocking,
 *   5. `agent:new` refuses to guess `--owns`.
 *
 * Everything drives the SHIPPED scripts against throwaway repos, so the code path under
 * test is the one that runs in production. Two concurrent sessions are staged with
 * DC_AGENT_SESSION_ID / DC_AGENT_SESSION_PID rather than by launching two Claude CLIs.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const WIP = resolve("scripts/wip.mjs");
const AGENT_LOCK = resolve("scripts/agent-lock.mjs");
const AGENT_NEW = resolve("scripts/agent-new.mjs");

// A pid that is certainly not running: above the platform maximum, so kill(pid, 0) throws
// ESRCH and pidAlive() reports false. Used to age a claim out without waiting 12 hours.
const DEAD_PID = 2_147_483_600;

function sh(cmd: string, cwd: string) {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cmd failed (${cmd}): ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

let repo: string;

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "dc-agent-guard-"));
  sh("git init -q -b dev .", dir);
  sh('git config user.email "t@e.st" && git config user.name "T"', dir);
  // Neutralize the repo's own hooks: this suite is about the wip hook's decision, not
  // about the pre-commit gates, which have their own suites.
  sh("git config core.hooksPath /dev/null", dir);
  writeFileSync(join(dir, "seed.txt"), "seed\n");
  sh("git add -A && git commit -qm seed", dir);
  return dir;
}

const registryPath = () => join(repo, ".git", "dc-agent-sessions.json");
const readRegistry = () =>
  existsSync(registryPath())
    ? (JSON.parse(readFileSync(registryPath(), "utf8")) as {
        sessions: { id: string; worktree: string }[];
        resources: Record<string, { holder: string; pid: number; label: string }>;
      })
    : { sessions: [], resources: {} };
const writeRegistry = (reg: unknown) =>
  writeFileSync(registryPath(), JSON.stringify(reg, null, 2) + "\n");

/** A live peer session: alive pid (ours), fresh heartbeat, sitting in `worktree`. */
const peer = (id: string, worktree: string) => ({
  id: `session:${id}`,
  label: id,
  pid: process.pid,
  source: "env",
  worktree,
  startedAt: new Date().toISOString(),
  lastSeen: new Date().toISOString(),
});

/** Run the real Stop-hook invocation as session `id`, scoped to `paths`. */
function runWipHook(id: string, paths: string) {
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
    },
  });
}

function runAgentLock(args: string[], id: string, pid = process.pid) {
  return spawnSync("node", [AGENT_LOCK, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, DC_AGENT_SESSION_ID: id, DC_AGENT_SESSION_PID: String(pid) },
  });
}

const commitCount = () => Number(sh("git rev-list --count HEAD", repo));

beforeEach(() => { repo = makeRepo(); });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe("auto-wip on a shared working tree", () => {
  it("SKIPS the auto-save while another agent is live in this same worktree", () => {
    writeRegistry({ sessions: [peer("other-tab", repo)], resources: {} });
    writeFileSync(join(repo, "shared.txt"), "half-finished edit\n");
    const before = commitCount();

    const r = runWipHook("mine", "shared.txt");

    expect(r.status).toBe(0);
    expect(r.stderr).toContain("SKIPPING the auto-save");
    expect(r.stderr).toContain("other-tab");
    expect(r.stderr).toContain("npm run agent:new");
    // The point of the whole guard: no commit, and the work is untouched in the tree.
    expect(commitCount()).toBe(before);
    expect(sh("git status --porcelain", repo)).toContain("shared.txt");
  });

  it("saves NORMALLY, scoped, when it is the only session (no behaviour change)", () => {
    writeRegistry({ sessions: [], resources: {} });
    writeFileSync(join(repo, "mine.txt"), "my work\n");
    writeFileSync(join(repo, "someone-elses.txt"), "not mine\n");
    const before = commitCount();

    const r = runWipHook("mine", "mine.txt");

    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("SKIPPING");
    expect(commitCount()).toBe(before + 1);
    // Still scoped: only the touched file is committed, the rest stays dirty.
    expect(sh("git show --name-only --format= HEAD", repo)).toBe("mine.txt");
    expect(sh("git status --porcelain", repo)).toContain("someone-elses.txt");
  });

  it("registers itself, so a solo session becomes the peer the NEXT session sees", () => {
    writeFileSync(join(repo, "mine.txt"), "my work\n");
    runWipHook("mine", "mine.txt");
    const ids = readRegistry().sessions.map((s) => s.id);
    expect(ids).toContain("session:mine");
  });

  it("IGNORES a peer in a different worktree — two agents in two lanes is the correct setup", () => {
    writeRegistry({ sessions: [peer("lane-agent", join(repo, "..", "dc-lanes", "elsewhere"))], resources: {} });
    writeFileSync(join(repo, "mine.txt"), "my work\n");
    const before = commitCount();

    const r = runWipHook("mine", "mine.txt");

    expect(r.stderr).not.toContain("SKIPPING");
    expect(commitCount()).toBe(before + 1);
  });

  it("IGNORES a peer whose process is gone (a stale row must never cost an auto-save)", () => {
    writeRegistry({ sessions: [{ ...peer("ghost", repo), pid: DEAD_PID }], resources: {} });
    writeFileSync(join(repo, "mine.txt"), "my work\n");
    const before = commitCount();

    const r = runWipHook("mine", "mine.txt");

    expect(r.stderr).not.toContain("SKIPPING");
    expect(commitCount()).toBe(before + 1);
  });

  it("leaves the MANUAL full-tree save alone even with a peer live", () => {
    // `npm run wip` is a human deliberately saving their tree — the documented anti-stash
    // net. The guard is for the automatic hook only.
    writeRegistry({ sessions: [peer("other-tab", repo)], resources: {} });
    writeFileSync(join(repo, "a.txt"), "a\n");
    const before = commitCount();

    const r = spawnSync("node", [WIP], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, DC_AGENT_SESSION_ID: "mine", DC_AGENT_SESSION_PID: String(process.pid), DORMCHECK_WIP_DISABLE: "", WIP_DISABLE: "" },
    });

    expect(r.stdout + r.stderr).not.toContain("SKIPPING");
    expect(commitCount()).toBe(before + 1);
  });
});

describe("the single local Supabase stack is claimed, not shared", () => {
  it("refuses a second session and names the holder", () => {
    const first = runAgentLock(["db-claim", "lane-a"], "a");
    expect(first.status).toBe(0);

    const second = runAgentLock(["db-claim", "lane-b"], "b");
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("lane-a");
    expect(second.stderr).toContain("npm run agent:db:release");
  });

  it("lets the SAME session renew its own claim (bootstrap → verify in one session)", () => {
    expect(runAgentLock(["db-claim", "lane-a"], "a").status).toBe(0);
    expect(runAgentLock(["db-claim", "lane-a verify"], "a").status).toBe(0);
  });

  it("steals a claim whose holder is dead instead of deadlocking on it", () => {
    expect(runAgentLock(["db-claim", "lane-a"], "a").status).toBe(0);
    const reg = readRegistry();
    reg.resources["local-supabase"].pid = DEAD_PID;
    writeRegistry(reg);

    const second = runAgentLock(["db-claim", "lane-b"], "b");
    expect(second.status).toBe(0);
    expect(second.stderr + second.stdout).toContain("STALE");
  });

  it("releases on request, and a release frees it for the next session", () => {
    expect(runAgentLock(["db-claim", "lane-a"], "a").status).toBe(0);
    expect(runAgentLock(["db-release"], "a").status).toBe(0);
    expect(runAgentLock(["db-claim", "lane-b"], "b").status).toBe(0);
  });

  it("unregistering a session drops the claims it was holding", () => {
    expect(runAgentLock(["db-claim", "lane-a"], "a").status).toBe(0);
    expect(runAgentLock(["unregister"], "a").status).toBe(0);
    expect(readRegistry().resources["local-supabase"]).toBeUndefined();
  });
});

describe("agent:new", () => {
  it("refuses to guess --owns, and shows an example instead", () => {
    const r = spawnSync("node", [AGENT_NEW, "some-lane"], { cwd: repo, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--owns is required");
    expect(r.stderr).toContain('npm run agent:new -- <name> --owns');
  });

  it("refuses with no name at all", () => {
    const r = spawnSync("node", [AGENT_NEW], { cwd: repo, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no lane name given");
  });

  it("is wired as an npm script, so the documented command exists", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["agent:new"]).toBe("node scripts/agent-new.mjs");
    expect(pkg.scripts["agent:db:release"]).toBe("node scripts/agent-lock.mjs db-release");
  });

  it("is unregistered at SessionEnd, so a closed tab stops counting as a peer", () => {
    const settings = JSON.parse(readFileSync(".claude/settings.json", "utf8"));
    const commands = settings.hooks.SessionEnd.flatMap(
      (entry: { hooks: { command: string }[] }) => entry.hooks.map((h) => h.command),
    );
    expect(commands.some((c: string) => c.includes("agent-lock.mjs") && c.includes("unregister"))).toBe(true);
  });
});
