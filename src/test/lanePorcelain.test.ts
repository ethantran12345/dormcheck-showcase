/**
 * Porcelain-parsing regression suite for the lane git helpers.
 *
 * THE BUG (third instance of one root cause, fixed here at the root):
 * `git status --porcelain` emits a fixed three-column prefix `XY<space>path`, and
 * for an UNSTAGED file the X column is a literal SPACE — " M src/x.ts". The shared
 * helper in scripts/lib/lanes.mjs was
 *
 *     export const git = (cmd, opts) => execSync(...).trim();
 *     export const gLines = (cmd, opts) => tryGit(cmd, opts).split('\n')…
 *
 * so .trim() ate that leading space off the FIRST line only, and the `.slice(3)`
 * every consumer does then removed one character too many: "src/x.ts" came back as
 * "rc/x.ts". In a four-file dirty list exactly one path is mangled and three are
 * intact, which reads as a display glitch.
 *
 * It is not a display glitch. The same string is matched against a live lane's
 * --owns globs to decide whether a NEW lane may start over conflicting dirt. A
 * mangled path matches no glob, so the guard reports "no overlapping dirt" and
 * opens a lane on top of a genuinely conflicting uncommitted file — silently, with
 * no error, the loss surfacing later as a merge conflict blamed on something else.
 *
 * WHY THESE TESTS HAVE TEETH: the first-file fixture below is ONE unstaged
 * modification at a path whose first character is load-bearing for the glob
 * ('src/x.ts' vs 'src/**'). Against the pre-fix helper it yields 'rc/x.ts' and
 * ownsFile() returns false, so `expect(ownsFile(...)).toBe(true)` fails. The
 * "replayed pre-fix implementation" test pins that down explicitly: it runs the old
 * trim-then-slice code against the same fixture and asserts it produces the mangled
 * path, so the suite documents and detects the exact regression, not merely a
 * symptom. Restoring the trim turns the first three tests red.
 *
 * Also covered: porcelain's C-quoting of paths containing spaces / non-ASCII bytes,
 * a latent second bug in the same hand-slicing call sites, which the -z machine
 * interface removes.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gLines, porcelainPaths, ownsFile } from "../../scripts/lib/lanes.mjs";

const sh = (cmd: string, cwd: string) =>
  execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let repo: string;

/** A repo with ONE unstaged modification at src/x.ts — the minimal reproduction. */
function seedOneUnstagedFile() {
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "x.ts"), "export const x = 1;\n");
  sh("git add -A && git commit -qm init", repo);
  writeFileSync(join(repo, "src", "x.ts"), "export const x = 2;\n"); // modify, do NOT stage
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "dc-porcelain-"));
  sh("git init -q -b dev && git config user.email t@t.com && git config user.name t", repo);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("porcelain parsing — the leading-space trim bug", () => {
  it("returns the first dirty path intact, with its first character", () => {
    seedOneUnstagedFile();
    const paths = porcelainPaths({ cwd: repo });
    expect(paths).toEqual(["src/x.ts"]);
    expect(paths[0]).toBe("src/x.ts"); // NOT "rc/x.ts"
  });

  it("the first dirty path still matches the glob that owns it", () => {
    seedOneUnstagedFile();
    const paths = porcelainPaths({ cwd: repo });
    // This is the assertion the bug defeated: a mangled path matches no glob, so
    // the overlap check wrongly concluded "no conflicting dirt" and started a lane.
    expect(ownsFile(["src/**"], paths[0])).toBe(true);
  });

  it("gLines preserves the leading status column on the FIRST line", () => {
    seedOneUnstagedFile();
    const lines = gLines("status --porcelain", { cwd: repo });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(" M src/x.ts"); // leading space intact — trim would eat it
    expect(lines[0].slice(3)).toBe("src/x.ts"); // so the legacy slice(3) is correct again
  });

  it("the legacy gLines+slice(3) call-site shape still resolves to an OWNED path", () => {
    seedOneUnstagedFile();
    // scripts/lane.mjs and the pre-commit guard consume porcelain in exactly this
    // shape. This asserts the CONSEQUENCE rather than the byte: with the trim
    // restored the path becomes 'rc/x.ts' and this returns false — the silent
    // failure that let a lane start over conflicting dirt.
    const dirtyFiles = gLines("status --porcelain", { cwd: repo }).map((l) => l.slice(3));
    expect(dirtyFiles[0]).toBe("src/x.ts");
    expect(ownsFile(["src/**"], dirtyFiles[0])).toBe(true);
  });

  it("replays the pre-fix implementation to prove the fixture has teeth", () => {
    seedOneUnstagedFile();
    // The exact helper that shipped before this fix: a scalar .trim() applied to
    // line-oriented output. Kept here so the failure mode stays visible and any
    // reintroduction is unmistakable, rather than being re-derived from scratch a
    // fourth time.
    const preFix = (cmd: string) =>
      execSync(`git ${cmd}`, { cwd: repo, encoding: "utf8" })
        .trim()
        .split("\n")
        .filter(Boolean);
    const mangled = preFix("status --porcelain").map((l) => l.slice(3));
    expect(mangled).toEqual(["rc/x.ts"]); // one character eaten — the bug, reproduced
    expect(ownsFile(["src/**"], mangled[0])).toBe(false); // and the guard goes blind
  });

  it("only the FIRST line was ever affected — which is why it read as cosmetic", () => {
    mkdirSync(join(repo, "src"), { recursive: true });
    for (const n of ["a", "b", "c"]) writeFileSync(join(repo, "src", `${n}.ts`), "1\n");
    sh("git add -A && git commit -qm init", repo);
    for (const n of ["a", "b", "c"]) writeFileSync(join(repo, "src", `${n}.ts`), "2\n");
    expect(porcelainPaths({ cwd: repo })).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });
});

describe("porcelain parsing — quoting and rename entries", () => {
  it("returns a path containing a space unquoted", () => {
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "my file.ts"), "1\n");
    sh("git add -A && git commit -qm init", repo);
    writeFileSync(join(repo, "src", "my file.ts"), "2\n");
    // Human porcelain would render this as `"src/my file.ts"` — quotes and all —
    // and every hand-slicing call site kept the quotes or split on the space.
    expect(porcelainPaths({ cwd: repo })).toEqual(["src/my file.ts"]);
  });

  it("returns a non-ASCII path unescaped", () => {
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "café.ts"), "1\n");
    sh("git add -A && git commit -qm init", repo);
    writeFileSync(join(repo, "src", "café.ts"), "2\n");
    // Human porcelain escapes this as "src/caf\303\251.ts".
    const paths = porcelainPaths({ cwd: repo });
    expect(paths).toEqual(["src/café.ts"]);
    expect(ownsFile(["src/**"], paths[0])).toBe(true);
  });

  it("resolves a rename to its destination and drops the origin field", () => {
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "old.ts"), "export const x = 1;\n");
    sh("git add -A && git commit -qm init", repo);
    sh("git mv src/old.ts src/new.ts", repo);
    // -z emits `R  src/new.ts\0src/old.ts\0`; the origin field must be consumed,
    // never reported as a second dirty path.
    expect(porcelainPaths({ cwd: repo })).toEqual(["src/new.ts"]);
  });

  it("returns an empty list for a clean tree", () => {
    writeFileSync(join(repo, "seed.txt"), "1\n");
    sh("git add -A && git commit -qm init", repo);
    expect(porcelainPaths({ cwd: repo })).toEqual([]);
  });
});
