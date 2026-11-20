import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const WIP = resolve("scripts/wip.mjs");

function runWip(args: string[]) {
  const result = spawnSync("node", [WIP, ...args], {
    env: { ...process.env, DORMCHECK_WIP_DISABLE: "1" },
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  return { stdout: result.stdout, stderr: result.stderr };
}

describe("Claude Stop WIP hook", () => {
  it("uses the script directly, without npm's stdout banner", () => {
    const settings = JSON.parse(readFileSync(".claude/settings.json", "utf8"));
    expect(settings.hooks.Stop[0].hooks[0].command).toBe(
      'node "$CLAUDE_PROJECT_DIR/scripts/wip.mjs" --hook --throttle=10',
    );
  });

  // Regression: hooks inherit the SESSION's current working directory, which a plain `cd` in a
  // Bash tool call moves for the rest of the session. A relative `node scripts/wip.mjs` therefore
  // resolved against wherever the shell happened to be — observed 2026-07-31 as
  // `Cannot find module '<repo>/.github/workflows/scripts/wip.mjs'` on every Stop. Every hook that
  // invokes a script by path must anchor it to $CLAUDE_PROJECT_DIR.
  it("anchors every wip.mjs hook to $CLAUDE_PROJECT_DIR so cwd drift cannot break it", () => {
    const settings = JSON.parse(readFileSync(".claude/settings.json", "utf8"));
    const commands = Object.values(
      settings.hooks as Record<string, { hooks: { command: string }[] }[]>,
    )
      .flat()
      .flatMap((entry) => entry.hooks.map((h) => h.command));
    const wipCommands = commands.filter((c) => c.includes("wip.mjs"));
    expect(wipCommands.length).toBeGreaterThan(0);
    for (const command of wipCommands) {
      expect(command).toContain('"$CLAUDE_PROJECT_DIR/scripts/wip.mjs"');
      expect(command).not.toMatch(/node\s+scripts\/wip\.mjs/);
    }
  });

  it("keeps successful hook output off stdout", () => {
    const result = runWip(["--hook"]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("wip: disabled for this session");
  });

  it("keeps manual WIP status visible in stdout", () => {
    const result = runWip([]);
    expect(result.stdout).toContain("wip: disabled for this session");
    expect(result.stderr).toBe("");
  });
});
