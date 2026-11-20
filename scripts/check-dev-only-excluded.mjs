#!/usr/bin/env node
/**
 * guard:dev-only — prove the dev-only graph is NOT in the production bundle.
 *
 * `src/App.tsx` keeps `/__variants` (the landing decision board, its 16 landing
 * compositions) and the design TweaksPanel out of production with a dead branch:
 *
 *     const VariantsGallery = import.meta.env.DEV ? lazy(() => import(...)) : null;
 *
 * Vite substitutes a literal `false` for `import.meta.env.DEV` in a prod build, so
 * Rollup drops the branch, the dynamic import inside it, and the whole graph. That
 * is real — but it is also INVISIBLE. Refactor the ternary into a plain top-level
 * `lazy()` and everything still compiles, still passes tests, still deploys; the
 * only symptom is that students can now open the dev board. The comment in App.tsx
 * used to claim this was "verified after every build by grepping dist/". It was
 * not. This script is that check.
 *
 *   npm run guard:dev-only                 # scan dist/, building first if it is stale
 *   npm run guard:dev-only -- --no-build   # never build; fail if dist/ is missing
 *
 * The scan needs a CURRENT production build, not merely some dist/. CI and
 * lane:ship both run `npm run build` in the step before this one, so rebuilding
 * unconditionally would pay for the slowest gate twice; running against whatever
 * dist/ happens to exist would let a stale bundle report a false green. So it
 * compares dist/'s newest mtime against the newest input mtime and rebuilds only
 * when it has to.
 *
 * WHAT IT LOOKS FOR, and why not just the variant ids: the ids are ordinary words
 * ("process", "device", "level", "anchor"), so a bare substring grep for them
 * matches minified prod code constantly. Three precise signals instead:
 *
 *   1. ROUTE + PANEL LITERALS — "__variants", "TweaksPanel", and the tournament's
 *      doc paths. None of these can appear in a prod bundle by coincidence.
 *   2. REGISTRY COPY — each variant's `note` sentence, read out of the registry
 *      source at scan time. Minifiers rewrite identifiers, never string contents,
 *      so if the registry module shipped, these ship verbatim.
 *   3. CHUNK FILENAMES — Vite names a dynamic chunk after its entry module, so a
 *      shipped variant appears as `dist/assets/airy-<hash>.js`. Catches the case
 *      where the graph is emitted but its strings are somehow reworded.
 *
 * Exit 0 = the dev graph is absent. Exit 1 = it leaked, naming every hit.
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, resolve, extname, basename } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = resolve(ROOT, "dist");
const REGISTRY = resolve(ROOT, "src/components/marketing/landing/variants/index.ts");

const C = { g: "\x1b[32m", r: "\x1b[31m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };
const say = (s = "") => console.log(s);

const noBuild = process.argv.includes("--no-build") || process.env.DC_GUARD_NO_BUILD === "1";

/**
 * Text-ish outputs only. Fonts and images cannot carry a JS graph, and reading
 * them as UTF-8 would just be slow noise.
 */
const TEXT_EXT = new Set([".js", ".mjs", ".cjs", ".css", ".html", ".json", ".txt", ".map", ".svg"]);

/** Read the registry SOURCE (never imported — it pulls in 16 lazy React modules). */
function readRegistry() {
  const src = readFileSync(REGISTRY, "utf8");
  const start = src.indexOf("export const LANDING_VARIANTS");
  if (start < 0) {
    fail(`could not find LANDING_VARIANTS in ${relative(ROOT, REGISTRY)} — has the registry moved?`);
  }
  const body = src.slice(start);
  const ids = [...body.matchAll(/^\s*id:\s*"([^"]+)"/gm)].map((m) => m[1]);
  const notes = [...body.matchAll(/^\s*note:\s*"([^"]+)"/gm)].map((m) => m[1]);
  if (ids.length < 2 || notes.length < 2) {
    fail(
      `parsed ${ids.length} id(s) and ${notes.length} note(s) out of the registry — the shape changed, ` +
        "so this guard would pass vacuously. Fix the parser before trusting a green run.",
    );
  }
  return { ids, notes };
}

function fail(msg) {
  say(`${C.r}${C.b}✗ guard:dev-only${C.x} ${msg}`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Newest mtime under a tree, or 0 if it does not exist. */
function newestMtime(dir) {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const f of walk(dir)) newest = Math.max(newest, statSync(f).mtimeMs);
  return newest;
}

/**
 * Is dist/ newer than every input that feeds it? Sources plus the build config —
 * an env/config-only change can flip whether a dead branch is dropped.
 */
function distIsCurrent() {
  const dist = newestMtime(DIST);
  if (!dist) return false;
  const inputs = [
    newestMtime(resolve(ROOT, "src")),
    ...["index.html", "vite.config.ts", "package.json", "tailwind.config.ts"]
      .map((f) => resolve(ROOT, f))
      .filter(existsSync)
      .map((f) => statSync(f).mtimeMs),
  ];
  return dist >= Math.max(...inputs);
}

if (existsSync(DIST) && distIsCurrent()) {
  say(`${C.d}dist/ is newer than every input — scanning it as-is.${C.x}`);
} else if (noBuild) {
  fail(
    existsSync(DIST)
      ? "dist/ is older than src/ and --no-build was passed, so this would scan a stale bundle."
      : `no dist/ at ${relative(ROOT, DIST)} and --no-build was passed. Run \`npm run build\` first.`,
  );
} else {
  say(`${C.d}dist/ is missing or stale — building (vite build)…${C.x}`);
  try {
    execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  } catch {
    fail("the production build failed, so there is nothing to verify.");
  }
}

const { ids, notes } = readRegistry();

/** Every needle, with the story its presence would tell. */
const NEEDLES = [
  ["__variants", "the dev-only board's route path"],
  ["TweaksPanel", "the dev-only design tweak panel"],
  ["docs/taste-finalists.md", "the tournament registry's provenance literal"],
  ["docs/taste-rubric.md", "the tournament registry's provenance literal"],
  // Registry copy: truncated so a later copy-edit to the tail of a sentence does
  // not silently turn the check off; the opening clause is distinctive enough.
  ...notes.map((n) => [n.slice(0, 40), "a landing variant's registry copy"]),
];

const files = walk(DIST);
const hits = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  const name = basename(file);

  // Signal 3: a dynamic chunk emitted for a variant module.
  for (const id of ids) {
    if (new RegExp(`^${id}-[A-Za-z0-9_-]+\\.(js|css|map)$`).test(name)) {
      hits.push(`${rel} — chunk emitted for variant "${id}"`);
    }
  }

  if (!TEXT_EXT.has(extname(file))) continue;
  const text = readFileSync(file, "utf8");
  for (const [needle, why] of NEEDLES) {
    if (text.includes(needle)) {
      hits.push(`${rel} — contains ${JSON.stringify(needle)} (${why})`);
    }
  }
}

say(`${C.b}guard:dev-only${C.x}  ${C.d}${files.length} file(s) in dist/, ${NEEDLES.length} needle(s), ${ids.length} variant chunk pattern(s)${C.x}`);

if (hits.length) {
  say("");
  say(`${C.r}${C.b}✗ DEV-ONLY CODE IS IN THE PRODUCTION BUNDLE${C.x} — ${hits.length} hit(s):`);
  for (const h of hits) say(`  ${C.r}✗${C.x} ${h}`);
  say("");
  say("  The dead-branch gates in src/App.tsx are what keep this out:");
  say("    const VariantsGallery = import.meta.env.DEV ? lazy(() => import(...)) : null;");
  say("  A plain top-level lazy() is a LIVE reference — Rollup emits the chunk even when");
  say("  nothing routes to it. Restore the ternary; do not weaken it to fix this.");
  process.exit(1);
}

say(`${C.g}${C.b}✓ guard:dev-only PASSED${C.x} — no variant chunk, route literal or registry copy in dist/.`);
process.exit(0);
