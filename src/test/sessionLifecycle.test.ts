import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MODULE = pathToFileURL(resolve("scripts/lib/agent-registry.mjs")).href;
const VALIDATE_SCOPE = resolve("scripts/validate-scope.mjs");
const DEAD_PID = 2_147_483_600;

describe("session registry lifecycle", () => {
  it("persists dead-row cleanup when sessions are read", () => {
    const repo = mkdtempSync(join(tmpdir(), "dc-session-life-"));
    try {
      spawnSync("git", ["init", "-q", "-b", "dev", repo]);
      const registry = join(repo, ".git", "dc-agent-sessions.json");
      writeFileSync(registry, JSON.stringify({
        sessions: [{ id: "cli:dead", pid: DEAD_PID, worktree: repo, startedAt: new Date().toISOString(), lastSeen: new Date().toISOString() }],
        resources: {},
      }));
      const result = spawnSync("node", ["--input-type=module", "-e", `import { liveSessions } from '${MODULE}'; liveSessions();`], {
        cwd: repo, encoding: "utf8",
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(registry, "utf8")).sessions).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("preserves the first character of porcelain status paths", () => {
    const repo = mkdtempSync(join(tmpdir(), "dc-validate-scope-"));
    try {
      spawnSync("git", ["init", "-q", "-b", "dev", repo]);
      writeFileSync(join(repo, "AGENTS.md"), "seed\n");
      spawnSync("git", ["add", "AGENTS.md"], { cwd: repo });
      spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "seed"], { cwd: repo });
      writeFileSync(join(repo, "AGENTS.md"), "changed\n");

      const result = spawnSync("node", [VALIDATE_SCOPE], { cwd: repo, encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("· AGENTS.md");
      expect(result.stdout).not.toContain("· GENTS.md");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
