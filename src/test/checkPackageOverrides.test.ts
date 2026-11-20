import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];
const script = join(process.cwd(), "scripts/check-package-overrides.mjs");

function manifest(overrides: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "dormcheck-override-policy-"));
  dirs.push(dir);
  const path = join(dir, "package.json");
  writeFileSync(path, JSON.stringify({ name: "fixture", overrides }));
  return path;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("package override policy", () => {
  it("accepts exact, caret, tilde, and nested deterministic overrides", () => {
    const path = manifest({ sharp: "^0.35.3", undici: "7.28.0", "eslint-plugin-jsx-a11y": { minimatch: "~3.1.2" } });
    expect(execFileSync(process.execPath, [script, path], { encoding: "utf8" })).toContain("deterministic");
  });

  it("rejects a comparator range before it can invalidate npm ci", () => {
    const path = manifest({ minimatch: ">=10.2.1" });
    expect(() => execFileSync(process.execPath, [script, path], { encoding: "utf8", stdio: "pipe" })).toThrow(/not an exact/);
  });
});
