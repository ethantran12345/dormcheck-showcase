/**
 * lane:ship red-trunk exemption (2026-10-29).
 *
 * A newly published npm advisory turns `CI (dev push)` red with no commit at fault, and
 * the lockfile fix may only be staged from a dependency lane. Before this exemption the
 * ship preflight refused every lane on a red trunk, so the fix for the red could never
 * ship. Now a DEPENDENCY lane whose own tree passes `audit:deps` may proceed; every
 * other lane, and a dependency lane that does not pass, still refuses.
 *
 * Drives the real scripts/lane.mjs against a throwaway repo with a fake `gh` on PATH
 * that reports the newest ci-dev-push run as failed. A dirty lane worktree keeps the
 * preflight refusing, so no gate ever runs; the assertions read which CI line it printed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const LANE = resolve("scripts/lane.mjs");

function sh(cmd: string, cwd: string) {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cmd failed (${cmd}): ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

let root: string;
let repo: string;
let bin: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "lane-red-trunk-")));
  repo = join(root, "repo");
  bin = join(root, "bin");
  mkdirSync(repo);
  mkdirSync(bin);
  // Fake gh: the trunk gate's newest run on dev is a completed failure.
  writeFileSync(join(bin, "gh"), "#!/bin/sh\necho '[{\"status\":\"completed\",\"conclusion\":\"failure\"}]'\n");
  chmodSync(join(bin, "gh"), 0o755);
  sh("git init -q -b dev && git config user.email t@t.com && git config user.name t", repo);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function shipFrom(owns: string[], auditExit: number) {
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "t", scripts: { "audit:deps": `exit ${auditExit}` } }));
  sh("git add -A && git commit -qm init && git branch lane/rt", repo);
  const wt = join(root, "rt");
  sh(`git worktree add -q "${wt}" lane/rt`, repo);
  writeFileSync(join(repo, ".git", "dc-lanes.json"), JSON.stringify({ lanes: [{
    name: "rt", branch: "lane/rt", worktree: wt, owns, pid: process.pid,
    startedAt: new Date().toISOString(), lastActive: new Date().toISOString(), status: "live",
  }] }, null, 2));
  writeFileSync(join(wt, "stray.txt"), "keeps preflight refusing so no gate runs");
  const r = spawnSync("node", [LANE, "ship"], {
    cwd: wt, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

describe("lane:ship on a red trunk", () => {
  it("a non-dependency lane still refuses", () => {
    const { status, out } = shipFrom(["src/**"], 0);
    expect(status).toBe(1);
    expect(out).toContain("refusing to pile onto a red trunk");
    expect(out).not.toContain("Proceeding: this dependency lane");
  });

  it("a dependency lane that passes audit:deps is let through the CI precondition", () => {
    const { out } = shipFrom(["package.json"], 0);
    expect(out).toContain("Proceeding: this dependency lane passes audit:deps");
    expect(out).not.toContain("refusing to pile onto a red trunk");
    expect(out).toContain("lane worktree is dirty"); // the other precondition still refuses
  });

  it("a dependency lane that fails audit:deps still refuses", () => {
    const { status, out } = shipFrom(["package.json"], 1);
    expect(status).toBe(1);
    expect(out).toContain("does not pass audit:deps either");
    expect(out).not.toContain("Proceeding: this dependency lane");
  });
});
