import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("lint:a11y launcher", () => {
  it("uses the local ESLint JavaScript CLI instead of the platform-specific npx shim", () => {
    const source = readFileSync(resolve("scripts/lint-a11y-unused.mjs"), "utf8");

    expect(source).toContain("spawnSync(process.execPath");
    expect(source).toContain('"node_modules", "eslint", "bin", "eslint.js"');
    expect(source).not.toContain('spawnSync("npx"');
  });
});
