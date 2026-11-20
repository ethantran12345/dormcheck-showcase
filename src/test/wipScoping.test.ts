/**
 * auto-wip scoping regression suite.
 *
 * The defect (5aa09a5f, 2026-08-04): `scripts/wip.mjs` staged with an explicit
 * pathspec (`git add -A -- <paths>`, correct since the 2026-07-22 rewrite) but then
 * ran a BARE `git commit`, which commits the ENTIRE INDEX. Anything a concurrent
 * session had already staged rode along — that is how `326ab23c` swallowed another
 * session's staged Swift deletions plus its CHANGELOG line. The same bug also
 * inflated the commit SUBJECT, which was counted from a bare `diff --cached`.
 *
 * It has regressed once already (2026-07-22 scoped the staging and missed the
 * commit), so it demonstrably comes back when nobody is watching. Hence these tests.
 *
 * Everything is asserted against REAL git state (`git show --name-status`,
 * `git diff --cached --name-only`), never against the script's stdout — stdout is
 * cosmetic and will drift. Conventions (throwaway repo per case, local `sh`) follow
 * laneShipRebase.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const WIP = resolve("scripts/wip.mjs");

function sh(cmd: string, cwd: string) {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`cmd failed (${cmd}): ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

/**
 * Runs the real script. `WIP_PATHS` is the documented explicit-touched-set entry point
 * (scripts/wip.mjs § HOOK context) and is what an agent/test uses instead of a session
 * transcript; setting it alone selects the SCOPED path without needing `--hook`.
 */
function wip(cwd: string, opts: { paths?: string[]; all?: boolean } = {}) {
  const env = { ...process.env } as Record<string, string>;
  if (opts.paths) env.WIP_PATHS = opts.paths.join("\n");
  else delete env.WIP_PATHS;
  const r = spawnSync("node", [WIP, ...(opts.all ? ["--all"] : [])], { cwd, encoding: "utf8", env });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

/** `git show --name-status` for HEAD, as "STATUS\tpath" lines — the committed set. */
function committed(cwd: string) {
  return sh("git show --name-status --format= HEAD", cwd).split("\n").filter(Boolean).sort();
}
/** What is STILL staged after the commit — i.e. what the other session kept. */
function stillStaged(cwd: string) {
  return sh("git diff --cached --name-only", cwd).split("\n").filter(Boolean).sort();
}
function subject(cwd: string) {
  return sh("git log -1 --format=%s", cwd);
}

let root: string;
let repo: string;

/**
 * A repo with three tracked files committed, then SESSION B stages its work:
 * a deletion of a tracked file plus a modification. Session A's own dirty file is
 * left unstaged, exactly as the hook finds it.
 */
function scaffold() {
  repo = join(root, "repo");
  sh(`git init -q -b dev repo`, root);
  sh("git config user.email t@t.com && git config user.name t && git config commit.gpgsign false", repo);
  writeFileSync(join(repo, "a-session.txt"), "session A original\n");
  writeFileSync(join(repo, "b-doc.md"), "session B doc\n");
  writeFileSync(join(repo, "b-deleted.swift"), "session B will delete this\n");
  sh("git add -A && git commit -qm init", repo);

  // SESSION B stages its work and walks away — a deletion and a modification.
  unlinkSync(join(repo, "b-deleted.swift"));
  writeFileSync(join(repo, "b-doc.md"), "session B doc + changelog line\n");
  sh("git add -A -- b-deleted.swift b-doc.md", repo);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "wip-scoping-")));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("auto-wip commits only this session's files", () => {
  it("commits session A's file only, and leaves session B's staged entries in the index", () => {
    scaffold();
    writeFileSync(join(repo, "a-session.txt"), "session A edit\n");

    const r = wip(repo, { paths: ["a-session.txt"] });
    expect(r.status).toBe(0);

    // Only session A's file is in the commit. Before 5aa09a5f this also contained
    // b-doc.md and the b-deleted.swift deletion.
    expect(committed(repo)).toEqual(["M\ta-session.txt"]);
    // …and B's work is untouched, still staged, waiting for its owner.
    expect(stillStaged(repo)).toEqual(["b-deleted.swift", "b-doc.md"]);
    expect(sh("git diff --cached --name-status -- b-deleted.swift", repo)).toContain("D\tb-deleted.swift");
  });

  it("counts the commit SUBJECT from its own pathspec, not the whole index", () => {
    scaffold();
    writeFileSync(join(repo, "a-session.txt"), "session A edit\n");

    expect(wip(repo, { paths: ["a-session.txt"] }).status).toBe(0);
    // The second bug in 5aa09a5f, and the one most likely to regress silently: it
    // corrupts nothing, it just lies. Pre-fix this read "(3 files)".
    expect(subject(repo)).toContain("(1 file)");
    expect(subject(repo)).not.toMatch(/\(\d+ files\)/);
  });

  it("commits session A's own DELETION as a deletion while B's staged deletion survives", () => {
    scaffold();
    unlinkSync(join(repo, "a-session.txt"));

    expect(wip(repo, { paths: ["a-session.txt"] }).status).toBe(0);

    // `git commit -- <paths>` commits worktree content, so a vanished tracked file
    // must land as a real D — not be silently skipped.
    expect(committed(repo)).toEqual(["D\ta-session.txt"]);
    expect(stillStaged(repo)).toEqual(["b-deleted.swift", "b-doc.md"]);
  });

  it("still commits the WHOLE index on the manual --all path", () => {
    scaffold();
    writeFileSync(join(repo, "a-session.txt"), "session A edit\n");

    // A hand-run is the documented anti-stash net: it saves everything, deliberately.
    // Future scoping work must not quietly narrow this.
    expect(wip(repo, { all: true }).status).toBe(0);
    expect(committed(repo)).toEqual(["D\tb-deleted.swift", "M\ta-session.txt", "M\tb-doc.md"]);
    expect(stillStaged(repo)).toEqual([]);
  });
});

/**
 * THE 90d2a704 SHAPE — hook mode with no usable answer to "what did THIS session touch".
 *
 * `90d2a704` landed on dev as "dorm-portal + marketplace + hooks +more (7 files) [auto]":
 * one `[auto]` commit carrying three features from three different sessions. The header of
 * scripts/wip.mjs promises that when the touched set cannot be determined the hook SKIPS
 * rather than guesses — so the obvious suspicion was that the transcript scoping silently
 * fell back to a broad add.
 *
 * It does not, and these tests are what pins that down. The `touched === null` branch exits
 * 0 without staging anything, on every route into it: no stdin at all, a `transcript_path`
 * pointing at a file that is not there, and a payload that is not JSON. (90d2a704's real
 * cause was one level up — two sessions sharing one tree, so both touched sets were correct
 * AND overlapping; that is covered in agentConcurrencyGuard.test.ts.)
 *
 * The positive control at the end matters as much as the skips: without it, "no commit"
 * would also pass if hook mode had simply stopped working.
 */
function wipHook(cwd: string, stdin = "") {
  const env = { ...process.env } as Record<string, string>;
  delete env.WIP_PATHS;               // the whole point: no explicit touched set
  env.DORMCHECK_WIP_DISABLE = "";
  env.WIP_DISABLE = "";
  const r = spawnSync("node", [WIP, "--hook"], { cwd, encoding: "utf8", env, input: stdin });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const commitCount = (cwd: string) => Number(sh("git rev-list --count HEAD", cwd));
const dirtyPaths = (cwd: string) =>
  sh("git status --porcelain", cwd).split("\n").filter(Boolean).map((l) => l.slice(3)).sort();

/** Seven dirty files across three unrelated features — the 90d2a704 commit's own shape. */
function scaffoldThreeFeatures() {
  repo = join(root, "repo");
  sh("git init -q -b dev repo", root);
  sh("git config user.email t@t.com && git config user.name t && git config commit.gpgsign false", repo);
  // Neutralize any inherited core.hooksPath: this suite asserts wip's own decision.
  sh("git config core.hooksPath /dev/null", repo);
  writeFileSync(join(repo, "seed.txt"), "seed\n");
  sh("git add -A && git commit -qm seed", repo);
  for (const f of [
    "dorm-portal-a.txt", "dorm-portal-b.txt",
    "marketplace-a.txt", "marketplace-b.txt", "marketplace-c.txt",
    "hooks-a.txt", "hooks-b.txt",
  ]) writeFileSync(join(repo, f), `${f} — half-finished\n`);
}

const SEVEN = [
  "dorm-portal-a.txt", "dorm-portal-b.txt",
  "hooks-a.txt", "hooks-b.txt",
  "marketplace-a.txt", "marketplace-b.txt", "marketplace-c.txt",
].sort();

describe("auto-wip skips rather than guessing when the session's scope is unresolvable", () => {
  it("does NOT commit when the hook gets no stdin at all", () => {
    scaffoldThreeFeatures();
    const before = commitCount(repo);

    const r = wipHook(repo);

    expect(r.status).toBe(0);                    // never fails the session
    expect(commitCount(repo)).toBe(before);      // and never invents a commit
    expect(dirtyPaths(repo)).toEqual(SEVEN);     // every edit still in the tree, nothing staged
    expect(stillStaged(repo)).toEqual([]);
  });

  it("does NOT commit when transcript_path points at a file that is not there", () => {
    scaffoldThreeFeatures();
    const before = commitCount(repo);

    const r = wipHook(repo, JSON.stringify({ transcript_path: join(root, "no-such-transcript.jsonl") }));

    expect(r.status).toBe(0);
    expect(commitCount(repo)).toBe(before);
    expect(dirtyPaths(repo)).toEqual(SEVEN);
  });

  it("does NOT commit when the hook payload is not JSON", () => {
    scaffoldThreeFeatures();
    const before = commitCount(repo);

    const r = wipHook(repo, "this is not json");

    expect(r.status).toBe(0);
    expect(commitCount(repo)).toBe(before);
    expect(dirtyPaths(repo)).toEqual(SEVEN);
  });

  it("DOES commit — scoped to the transcript's own files — when the transcript is readable", () => {
    // The control. Without it every assertion above would also pass if hook mode were
    // broken outright, which is the failure this suite would then be hiding.
    scaffoldThreeFeatures();
    const transcript = join(root, "transcript.jsonl");
    writeFileSync(
      transcript,
      [
        JSON.stringify({ message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: join(repo, "hooks-a.txt") } }] } }),
        JSON.stringify({ message: { content: [{ type: "tool_use", name: "Write", input: { file_path: join(repo, "hooks-b.txt") } }] } }),
        JSON.stringify({ message: { content: [{ type: "tool_use", name: "Read", input: { file_path: join(repo, "marketplace-a.txt") } }] } }),
      ].join("\n") + "\n",
    );
    const before = commitCount(repo);

    const r = wipHook(repo, JSON.stringify({ transcript_path: transcript }));

    expect(r.status).toBe(0);
    expect(commitCount(repo)).toBe(before + 1);
    // Only the two files this session WROTE. `Read` is not a touch, and the other two
    // features are untouched — that is the difference between a scoped save and 90d2a704.
    expect(committed(repo)).toEqual(["A\thooks-a.txt", "A\thooks-b.txt"]);
    expect(dirtyPaths(repo)).toEqual([
      "dorm-portal-a.txt", "dorm-portal-b.txt",
      "marketplace-a.txt", "marketplace-b.txt", "marketplace-c.txt",
    ]);
  });
});
