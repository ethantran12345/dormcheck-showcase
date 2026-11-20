#!/usr/bin/env node
/**
 * Docs drift guard. docs/ once went 1,253 commits stale and ended up asserting
 * things that were FALSE, not merely missing (Pitt-only, iOS-only, binary
 * is_admin, no moderation, plus four files that had already been deleted). An
 * inverted doc is worse than no doc, because an agent acts on it confidently.
 * Manual upkeep already failed, so: the volatile parts are GENERATED and the
 * false parts FAIL.
 *
 *   check 1  dead references  — every repo path and every backticked SQL
 *                               identifier named in docs/*.md, .claude/rules/*.md,
 *                               CLAUDE.md, AGENTS.md and README.md must still
 *                               exist. The agent-instruction files are in scope
 *                               because CLAUDE.md loads into EVERY turn of every
 *                               session — a false claim there is the most
 *                               expensive one in the repo.
 *   check 2  generated blocks — <!-- GENERATED:<name> --> regions are rebuilt
 *                               from their oracle; a diff is a failure.
 *   check 4  AGENTS.md        — generated from CLAUDE.md; a diff is a failure.
 *   check 3  freshness stamp  — ADVISORY ONLY. Warns when a doc's
 *                               `verified-against` commit is far behind HEAD
 *                               *and* the paths it describes have moved. A pure
 *                               age check is noise, and noise trains people to
 *                               ignore the gate.
 *   check 5  ignore reasons   — every `docs-drift-ignore` tag needs a reason
 *                               (`name — reason`); bare tags are allowed only if
 *                               grandfathered in scripts/docs-ignore-baseline.json,
 *                               which is itself capped by IGNORE_DEBT_CEILING below.
 *                               See the comment above checkIgnoreReasons().
 *
 * Check 1 exemption is frontmatter-driven, never a filename list: a doc carrying
 * `snapshot: YYYY-MM-DD` is exempt because a dated snapshot is SUPPOSED to name
 * things that no longer exist. Unmarked is the failing default. Check 5 shares the
 * same exemption — an ignore comment inside a dated snapshot is never evaluated.
 *
 * Usage:
 *   npm run docs:check            verify (checks 1, 2, 4, 5 gate; check 3 warns)
 *   npm run docs:check -- --fix   rewrite the generated blocks + AGENTS.md in place
 *   npm run docs:check -- --stamp rewrite `verified-against` stamps to HEAD, and
 *                                 fill any bare `snapshot:` key with the file's
 *                                 last commit date
 *
 * `--stamp` is deliberately separate from `--fix`: regenerating a block
 * re-verifies the volatile facts, it does NOT re-verify the prose, and a stamp
 * claims a human looked.
 *
 * Does not push or modify the repo (outside the explicit --fix / --stamp
 * rewrites).
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { renderAgentsMd } from "./gen-agents-md.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const FIX = process.argv.includes("--fix");
const STAMP = process.argv.includes("--stamp");

const DOCS_DIR = "docs";

/**
 * Named, expiring waivers for check 2 — see scripts/docs-drift-waivers.json for the
 * full contract. One situation only: a GENERATED block whose oracle lives in another
 * live lane's in-flight work, where regenerating from this checkout would write that
 * lane's unshipped state into dev.
 *
 * Deliberately not a blanket "cross-lane" flag on lane:ship. That would be
 * self-declared and would switch the docs guard off for any lane that found it
 * inconvenient. A waiver names one file and one block, names the owning lane, and
 * expires — so it suppresses exactly what was reasoned about and nothing else, and
 * stops suppressing on a date rather than whenever someone stops paying attention.
 */
const WAIVERS_PATH = "scripts/docs-drift-waivers.json";
const WAIVERS = (() => {
  try {
    return JSON.parse(read(WAIVERS_PATH)).generatedBlocks ?? [];
  } catch {
    return []; // no waiver file, or unparseable: waive nothing. Fail closed.
  }
})();

/** today in UTC as YYYY-MM-DD — string compare is safe for ISO dates. */
const TODAY = new Date().toISOString().slice(0, 10);

/** The matching waiver for a problem, or null. Expired waivers still match — the caller reports them as expired rather than silently letting the block fail unexplained. */
function waiverFor(problem) {
  return WAIVERS.find((w) => w.file === problem.file && w.block === problem.name) ?? null;
}

/**
 * Check 1 covers docs/*.md plus the agent-facing instruction files, which are the
 * highest-leverage place a false claim can live: CLAUDE.md loads into every turn of
 * every session, and `.claude/rules/*.md` auto-load whenever their paths are touched.
 * A dead reference there is acted on confidently by every agent, forever.
 */
const CHECK_1_ROOT_FILES = ["CLAUDE.md", "AGENTS.md", "README.md"];
const CHECK_1_RULES_DIR = ".claude/rules";

/**
 * `npm run audit:app` overwrites this directory wholesale on every crawl (index.md
 * + per-page JSON/PNG) — it is a generated artifact, not authored prose, and no
 * doc or rule points into it. A dated `snapshot:` marker would just get clobbered
 * by the next crawl, so this is an exclusion, not a snapshot.
 */
const CHECK_1_EXCLUDED_DIRS = ["docs/audits/app-bug-audit-report"];

function check1Targets() {
  const docsMd = walk(DOCS_DIR)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !CHECK_1_EXCLUDED_DIRS.some((d) => f === d || f.startsWith(`${d}/`)))
    .sort();
  return [
    ...docsMd,
    ...listDir(CHECK_1_RULES_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => `${CHECK_1_RULES_DIR}/${f}`),
    ...CHECK_1_ROOT_FILES.filter((f) => TRACKED_FILES.has(f)),
  ];
}

/**
 * Dated-snapshot exemption.
 *
 * A doc carrying `snapshot: YYYY-MM-DD` in its frontmatter is exempt from check 1. This
 * replaces a hardcoded filename list, for three reasons:
 *
 *   - A dated snapshot SHOULD name things that no longer exist — that is the entire
 *     value of a snapshot. AUDIT_REPORT.md names ~250 objects as of 2026-06-21; rewriting
 *     them to the present state would destroy the document.
 *   - A filename list gives the NEXT dated audit no exemption, so the path of least
 *     resistance becomes "loosen the rule" rather than "mark the file". Marking is now
 *     the easy path: add `snapshot:` and run `--stamp`.
 *   - CHANGELOG.md, DECISIONS.md and the design review log were three separate special
 *     cases of one idea. Now they are one idea.
 *
 * Unmarked is the failing default: absence of a marker is never an exemption.
 */
/**
 * Empty by design, and meant to stay that way — this is the escape hatch for the
 * exact situation `ipp1-perf` was in: a file that needs the `snapshot:` marker but
 * is owned by a live lane, so the ownership guard refuses the commit that would add
 * it (`--no-verify` past that guard is banned). `docs/CHANGELOG.md` and
 * `docs/DECISIONS.md` sat here until `ipp1-perf` shipped (2026-07-28); both now
 * carry `snapshot:` frontmatter and were removed in the same commit that emptied
 * this list, per the hard-fail below.
 *
 * When this recurs: add
 *   ---
 *   snapshot:
 *   ---
 * to the top of the file, list it here, and once the owning lane ships, run
 * `npm run docs:check -- --stamp` and delete the entry. The check below hard-fails
 * the moment a listed file already carries a marker, so an entry cannot outlive its
 * reason — and an empty list is the passing, no-debt steady state, not a smell.
 */
const PENDING_SNAPSHOT_MARKER = [];

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/;
const SNAPSHOT_RE = /^snapshot:[ \t]*(\S*)[ \t]*$/m;

/** The snapshot date a doc declares, or null if it declares none (or an undated key). */
function snapshotDate(text) {
  const fm = text.match(FRONTMATTER_RE);
  if (!fm) return null;
  const m = fm[1].match(SNAPSHOT_RE);
  if (!m) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(m[1]) ? m[1] : null;
}

/** True when a doc declares `snapshot:` but left the date blank for `--stamp` to fill. */
function hasBareSnapshotKey(text) {
  const fm = text.match(FRONTMATTER_RE);
  if (!fm) return false;
  const m = fm[1].match(SNAPSHOT_RE);
  return Boolean(m) && !/^\d{4}-\d{2}-\d{2}$/.test(m[1]);
}

/**
 * `--stamp` fills a bare `snapshot:` with the file's last commit date rather than today's:
 * "as of when was this observed" is a property of the content, and a git date is
 * reproducible where `new Date()` is not.
 */
function stampSnapshots() {
  const stamped = [];
  for (const rel of check1Targets()) {
    const text = read(rel);
    if (!hasBareSnapshotKey(text)) continue;
    let date;
    try {
      date = git(["log", "-1", "--format=%ad", "--date=short", "--", rel]);
    } catch {
      date = "";
    }
    if (!date) continue;
    const fm = text.match(FRONTMATTER_RE);
    const nextFm = fm[0].replace(SNAPSHOT_RE, `snapshot: ${date}`);
    writeFileSync(join(REPO_ROOT, rel), text.replace(fm[0], nextFm));
    stamped.push(`${rel} → ${date}`);
  }
  return stamped;
}

/** Docs that carry a `verified-against` stamp, and the paths each one describes. */
const STAMPED_DOCS = {
  "ARCHITECTURE.md": ["src", "api", "supabase", "ios", "android"],
  "schema-map.md": ["supabase/registry", "supabase/migrations"],
};
/** Commits behind HEAD before a stamped doc is even considered for a warning. */
const STALE_COMMIT_THRESHOLD = 50;

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function read(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function listDir(rel) {
  try {
    return readdirSync(join(REPO_ROOT, rel));
  } catch {
    return [];
  }
}

function walk(rel, out = []) {
  for (const name of listDir(rel)) {
    const child = `${rel}/${name}`;
    if (statSync(join(REPO_ROOT, child)).isDirectory()) walk(child, out);
    else out.push(child);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Oracles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the generated Supabase types. Cheap brace-depth walk rather than a TS
 * parse: the file is machine-generated, so its shape is stable.
 */
function parseGeneratedTypes() {
  const lines = read("src/integrations/supabase/types.ts").split("\n");
  const blocks = { Tables: [], Views: [], Functions: [], Enums: [] };
  const columns = new Set();

  let section = null;
  let sectionIndent = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const head = line.match(/^(\s*)(Tables|Views|Functions|Enums): \{/);
    if (head && Object.hasOwn(blocks, head[2])) {
      section = head[2];
      sectionIndent = head[1].length;
      continue;
    }
    if (!section) continue;

    // End of the section: a closing brace at the section's own indent.
    if (line.length && line.trimEnd() === `${" ".repeat(sectionIndent)}}`) {
      section = null;
      continue;
    }

    const member = line.match(/^(\s*)([A-Za-z_][\w]*): /);
    if (member && member[1].length === sectionIndent + 2) {
      blocks[section].push(member[2]);
    }
    // Row/Insert/Update column names live two levels deeper.
    if (member && member[1].length > sectionIndent + 2) {
      columns.add(member[2]);
    }
  }

  for (const key of Object.keys(blocks)) {
    blocks[key] = [...new Set(blocks[key])].sort();
  }
  return { ...blocks, columns };
}

function registryTables() {
  const registry = JSON.parse(read("supabase/registry/table-classification.json"));
  return registry.tables;
}

/**
 * Replay CREATE/DROP over the migrations in ONE ordered pass so the result is
 * "what exists now", not "what was ever created". Order matters within a single
 * file too — a drop-then-recreate is common, and scanning all creates before all
 * drops would wrongly bury the object.
 *
 * Supplies the objects PostgREST does not expose — trigger functions, policies,
 * types — which docs legitimately name. Also yields TOMBSTONES: names an actual
 * migration dropped and never brought back. A tombstone is the strongest signal
 * this guard has, so it outranks every other way a name might resolve.
 */
function replayMigrations() {
  const live = new Set();
  const tombstones = new Set();

  // Anchored to the start of a statement. Unanchored, `ALTER PUBLICATION
  // supabase_realtime DROP TABLE public.marketplace_listings` reads as a table
  // drop and tombstones a live table — it is a publication-membership change.
  //
  // Constraints get their own two arms. A CHECK/UNIQUE/FK constraint is never
  // born from `CREATE <kind> <name>` — it arrives via `ALTER TABLE … ADD
  // CONSTRAINT` or inline in a CREATE TABLE body — and `sourceSymbols()` does
  // not walk `supabase/migrations`, so without these arms a live constraint
  // that docs legitimately name resolves nowhere and reads as drift.
  const stmt = new RegExp(
    [
      // Schema objects, anchored to the start of a statement (see above).
      String.raw`(?:^|;)\s*(?<verb>create|drop)\s+(?:or\s+replace\s+)?(?:materialized\s+)?(?:unique\s+)?(?<kind>table|view|function|policy|trigger|type|index)\s+(?:if\s+(?:not\s+)?exists\s+)?"?(?:public\.)?"?(?<name>[a-z_][a-z0-9_]*)"?`,
      // `ALTER TABLE … ADD|DROP CONSTRAINT x` — mid-statement by construction,
      // so deliberately NOT anchored.
      String.raw`(?<cverb>add|drop)\s+constraint\s+(?:if\s+(?:not\s+)?exists\s+)?"?(?<cname>[a-z_][a-z0-9_]*)"?`,
      // Inline `CONSTRAINT "x" CHECK (…)` inside a CREATE TABLE body.
      String.raw`constraint\s+"?(?<iname>[a-z_][a-z0-9_]*)"?\s+(?:check|unique|primary\s+key|foreign\s+key|exclude)`,
    ].join("|"),
    "gim",
  );

  const files = listDir("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    for (const m of read(`supabase/migrations/${file}`).matchAll(stmt)) {
      const g = m.groups;
      if (g.name) {
        const name = g.name.toLowerCase();
        if (g.verb.toLowerCase() === "create") {
          live.add(name);
          tombstones.delete(name);
        } else if (["table", "view", "function"].includes(g.kind.toLowerCase())) {
          // Only drops of real schema objects tombstone. Dropping a policy or
          // index says nothing about whether the underlying object still exists.
          live.delete(name);
          tombstones.add(name);
        }
      } else if (g.cname) {
        const name = g.cname.toLowerCase();
        if (g.cverb.toLowerCase() === "add") {
          live.add(name);
          tombstones.delete(name);
        } else {
          // `DROP CONSTRAINT` does not tombstone: drop-then-re-add in the same
          // file is the normal way to widen a CHECK, and the re-add follows in
          // this same ordered pass.
          live.delete(name);
        }
      } else if (g.iname) {
        live.add(g.iname.toLowerCase());
      }
    }
  }
  return { live, tombstones };
}

/**
 * Symbols that appear anywhere in first-party source. A doc may legitimately
 * backtick a localStorage key, a Deno hook name, or a TS constant — those are
 * real, they just aren't schema. Verified by existence, not guessed.
 */
function sourceSymbols() {
  const symbols = new Set();
  const files = [...walk("src"), ...walk("api"), ...walk("supabase/functions")].filter((f) =>
    /\.(ts|tsx|sql|json)$/.test(f),
  );
  for (const file of files) {
    for (const m of read(file).matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g)) symbols.add(m[1]);
  }
  return symbols;
}

/**
 * Postgres/Supabase vocabulary that reads like an identifier but names a role,
 * a keyword, or an option rather than an object in this schema.
 */
const NON_SCHEMA_VOCABULARY = new Set([
  "security_invoker",
  "security_definer",
  "security_definer_view",
  "row_level_security",
  "service_role",
  "current_user",
  "session_user",
  "search_path",
  "on_conflict",
  "if_exists",
  "if_not_exists",
  // Tooling, not schema: MCP tool names and well-known directory names that
  // docs quote in backticks.
  "list_tables",
  "list_migrations",
  "get_advisors",
  "apply_migration",
  "execute_sql",
  // Supabase's own migration ledger, in the `supabase_migrations` schema.
  "schema_migrations",
  "use_figma",
  "get_design_context",
  "get_variable_defs",
  "node_modules",
  // Supabase advisor lint rule names, quoted in security-todo.md.
  "rls_enabled_no_policy",
  "auth_otp_long_expiry",
  "function_search_path_mutable",
  "unindexed_foreign_keys",
  "unused_index",
  // Postgres built-ins.
  "has_function_privilege",
  "string_agg",
  "split_part",
]);

/**
 * Prefixes that mark a token as not-this-schema by construction, so the guard does not
 * need a growing enumeration of them:
 *   `pg_`      Postgres catalogs and built-ins (`pg_proc`, `pg_get_constraintdef`).
 *   `browser_` Playwright MCP tool names, quoted throughout the UI-verification rules.
 * Nothing in this repo's own schema uses either prefix, so neither can mask a real drift.
 */
const NON_SCHEMA_PREFIXES = ["pg_", "browser_"];

/** Extensions tried when a doc names a module without one (`api/notify-message`). */
const PATH_EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js", ".json", ".sql"];

/**
 * Resolve paths against git, not the working tree. An existsSync-only check is
 * environment-dependent and this bit on the very first CI run: `android/key.properties`
 * exists on the author's disk but is gitignored (signing secrets), so the gate
 * passed locally and reddened the trunk on a clean checkout. The tracked-file
 * set is identical everywhere, which is the whole point of a gate.
 */
const TRACKED_FILES = new Set(git(["ls-files"]).split("\n").filter(Boolean));
const TRACKED_DIRS = new Set();
for (const file of TRACKED_FILES) {
  const parts = file.split("/");
  for (let i = 1; i < parts.length; i += 1) TRACKED_DIRS.add(parts.slice(0, i).join("/"));
}

/** Gitignored but real — a doc may legitimately name a local-only file. */
function isGitIgnored(ref) {
  try {
    execFileSync("git", ["check-ignore", "-q", "--no-index", ref], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function pathResolves(rawRef) {
  const ref = rawRef.replace(/\/+$/, ""); // `supabase/functions/` names a directory
  const hit = PATH_EXTENSIONS.some(
    (ext) => TRACKED_FILES.has(ref + ext) || TRACKED_DIRS.has(ref + ext),
  );
  if (hit) return true;
  // Untracked-but-present is NOT a pass: it would red the trunk on a clean
  // checkout, exactly as above. Only a deliberate gitignore counts.
  return isGitIgnored(ref);
}

const TYPES = parseGeneratedTypes();
const REGISTRY = registryTables();
const { live: MIGRATION_OBJECTS, tombstones: TOMBSTONES } = replayMigrations();
const SOURCE_SYMBOLS = sourceSymbols();

/** The gated sources of truth. Anything here exists, period. */
const AUTHORITATIVE_ALIVE = new Set([
  ...Object.keys(REGISTRY),
  ...TYPES.Tables,
  ...TYPES.Views,
  ...TYPES.Functions,
  ...TYPES.Enums,
  ...TYPES.columns,
]);

/** Everything a backticked snake_case token in a doc is allowed to refer to. */
const KNOWN_IDENTIFIERS = new Set([
  ...Object.keys(REGISTRY),
  ...TYPES.Tables,
  ...TYPES.Views,
  ...TYPES.Functions,
  ...TYPES.Enums,
  ...TYPES.columns,
  ...MIGRATION_OBJECTS,
  ...SOURCE_SYMBOLS,
  ...NON_SCHEMA_VOCABULARY,
]);

// ─────────────────────────────────────────────────────────────────────────────
// Check 1 — dead references
// ─────────────────────────────────────────────────────────────────────────────

const PATH_ROOTS = ["src/", "supabase/", "api/", "ios/", "android/"];
// The lookbehind matters: without it `~/.android/debug.keystore` (a HOME path)
// reads as the repo path `android/debug.keystore`.
const PATH_RE = /(?<![\w./~-])(?:src|supabase|api|ios|android)\/[A-Za-z0-9_./@*-]+/g;
const IDENT_RE = /`([a-z_][a-z0-9_]*)(?:\(\))?`/g;

/** A doc may name a deliberately-removed object; declare it and say why. */
const IGNORE_RE = /<!--\s*docs-drift-ignore:\s*([^>]*?)\s*-->/g;

/**
 * Split a `docs-drift-ignore` tag's content into its comma-separated names and an
 * optional reason. Accepted separators, ALL requiring surrounding whitespace:
 * ` — ` (em dash), ` – ` (en dash), ` -- `, ` - `. The whitespace is not optional:
 * a NAME legitimately contains hyphens (`src/components/dorm-portal/Foo.tsx`,
 * `off_campus_dining_spots`), and a bare `-` separator would slice such a name in
 * half and accept its tail as a bogus "reason" — marking real debt as justified.
 * `:` is deliberately NOT accepted; it collides with paths and identifiers.
 * The FIRST separator wins, since names never contain one but reasons often do.
 * Content with no separator has no reason.
 */
const IGNORE_REASON_SEP_RE = /\s(?:—|–|--|-)\s/;

function parseIgnoreContent(content) {
  const sep = IGNORE_REASON_SEP_RE.exec(content);
  const dashIdx = sep ? sep.index : -1;
  const namesPart = dashIdx === -1 ? content : content.slice(0, dashIdx);
  const reason = dashIdx === -1 ? "" : content.slice(dashIdx + sep[0].length).trim();
  const names = namesPart
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return { names, namesPart: namesPart.trim(), reason };
}

function stripFencedBlocks(text) {
  // Fenced blocks are illustrative (directory sketches, SQL snippets, shell).
  // Blank them rather than delete them so line numbers survive.
  const lines = text.split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return "";
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

function checkDeadReferences() {
  const failures = [];

  // The interim allowance must die the moment it is no longer needed.
  for (const file of PENDING_SNAPSHOT_MARKER) {
    if (existsSync(join(REPO_ROOT, file)) && snapshotDate(read(file))) {
      failures.push({
        file,
        lineNo: 1,
        kind: "stale exemption",
        ref: `${file} now carries a snapshot marker — delete it from PENDING_SNAPSHOT_MARKER`,
      });
    }
  }

  for (const file of check1Targets()) {
    const raw = read(file);
    // A dated snapshot is exempt: it is supposed to describe a past state.
    if (snapshotDate(raw)) continue;
    if (PENDING_SNAPSHOT_MARKER.includes(file)) continue;
    const ignored = new Set();
    for (const m of raw.matchAll(IGNORE_RE)) {
      const { names } = parseIgnoreContent(m[1].trim());
      for (const name of names) ignored.add(name);
    }

    const body = stripFencedBlocks(raw);
    const lines = body.split("\n");

    lines.forEach((line, idx) => {
      const lineNo = idx + 1;

      for (const m of line.matchAll(PATH_RE)) {
        // Glob/placeholder test runs BEFORE trailing-punctuation stripping, or
        // `/api/notify-*` becomes the unresolvable literal `api/notify-`.
        if (/[*<>{}]/.test(m[0])) continue;
        const ref = m[0].replace(/[.,)-]+$/, "");
        if (!ref) continue;
        if (ignored.has(ref)) continue;
        if (!PATH_ROOTS.some((r) => ref.startsWith(r))) continue;
        if (pathResolves(ref)) continue;
        failures.push({ file, lineNo, kind: "path", ref });
      }

      for (const m of line.matchAll(IDENT_RE)) {
        const ident = m[1];
        if (!ident.includes("_")) continue; // single words are prose, not schema
        if (ident.startsWith("_")) continue; // i18n plural suffixes (`_one`, `_other`) and the like
        if (ident.length < 4) continue;
        if (ignored.has(ident)) continue;
        if (NON_SCHEMA_PREFIXES.some((p) => ident.startsWith(p))) continue;
        // The registry and the generated types are authoritative-ALIVE: if
        // PostgREST or the gated registry lists it, it exists, and no amount of
        // migration archaeology overrides that.
        if (AUTHORITATIVE_ALIVE.has(ident)) continue;
        // Otherwise a tombstone outranks every other resolution: a migration
        // explicitly dropped this and never brought it back, so a doc asserting
        // it is the exact inverted-doc failure this guard exists for.
        if (TOMBSTONES.has(ident)) {
          failures.push({ file, lineNo, kind: "dropped object", ref: ident });
          continue;
        }
        if (KNOWN_IDENTIFIERS.has(ident)) continue;
        failures.push({ file, lineNo, kind: "identifier", ref: ident });
      }
    });
  }

  return failures;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 5 — docs-drift-ignore comments must carry a reason
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A bare `<!-- docs-drift-ignore: name -->` silences check 1 forever with zero
 * record of WHY — and that gap is not hypothetical: a single pass
 * (`3d60594e`, 2026-07-27) added 163 of them and not one carried a reason. Three
 * were sampled and found to be papering over prose that was wrong, not prose that
 * was legitimately historical — indistinguishable from the other ~160 without
 * reading every one. `validate_pitt_email` alone picked up 4 separate bare
 * ignores across the pass, the exact fact three earlier sessions spent fixing.
 *
 * Same "never fix a red run by lowering the floor" rule as the color/shape/glyph
 * gates, applied to the exemption mechanism itself: the floor didn't move, an
 * escape hatch grew silently under it.
 *
 * Fix: require `<!-- docs-drift-ignore: name — reason -->` (comma-separated names
 * share one reason) for any NEW ignore. The reason separator may be any of
 * ` — `, ` – `, ` -- `, ` - ` — whitespace-delimited, so a hyphenated NAME is never
 * split (see parseIgnoreContent above); no keyboard-hostile character is required. A doc naming something that genuinely no
 * longer exists — `docs/audits/orphan-unwired.md`'s "Was: `X.tsx`" entries are the
 * textbook legitimate case — should say so in the reason; that costs one clause,
 * not a redesign.
 *
 * Existing bare ignores are grandfathered via `scripts/docs-ignore-baseline.json`
 * (exact per-file content, mirroring `scripts/color-baseline.json`'s exact-hex
 * idiom, not a headroom count — a BRAND NEW bare ignore fails even in a file with
 * plenty of ratchet room, because "new" is judged by identity, not by count).
 * `IGNORE_DEBT_CEILING` below is the second, independent guard: a hardcoded
 * number, exactly like `scripts/npm-audit-ratchet.sh`'s `BASELINE`, so the debt
 * total can only shrink by someone adding a reason or deleting a dead reference —
 * never grow by someone quietly padding the JSON file itself. Do NOT raise it to
 * paper over a new bare ignore; that is a docs/DECISIONS.md call, not a silent
 * edit. Do NOT back-fill reasons into the baseline file to make this check
 * "pass more" — an entry leaves the baseline by getting a real reason IN THE DOC
 * (or being deleted), never by editing the JSON.
 */
const IGNORE_BASELINE_PATH = "scripts/docs-ignore-baseline.json";
const IGNORE_DEBT_CEILING = 138;

function loadIgnoreBaseline() {
  const path = join(REPO_ROOT, IGNORE_BASELINE_PATH);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

function checkIgnoreReasons() {
  const baseline = loadIgnoreBaseline();
  const failures = [];
  let ceilingFailure = null;

  const totalBaselineEntries = Object.entries(baseline)
    .filter(([key]) => key !== "_note")
    .reduce((n, [, arr]) => n + arr.length, 0);
  if (totalBaselineEntries > IGNORE_DEBT_CEILING) {
    ceilingFailure = `${IGNORE_BASELINE_PATH} carries ${totalBaselineEntries} grandfathered entries, above the recorded ceiling of ${IGNORE_DEBT_CEILING} in check-docs-drift.mjs. The baseline file grew — that is only ever legitimate as a deliberate, reviewed decision (bump IGNORE_DEBT_CEILING with a reason), never a side effect of another change.`;
  }

  for (const file of check1Targets()) {
    const raw = read(file);
    if (snapshotDate(raw)) continue;
    if (PENDING_SNAPSHOT_MARKER.includes(file)) continue;

    const consumable = [...(baseline[file] ?? [])];
    const body = stripFencedBlocks(raw);
    const lines = body.split("\n");

    lines.forEach((line, idx) => {
      for (const m of line.matchAll(IGNORE_RE)) {
        const { namesPart, reason } = parseIgnoreContent(m[1].trim());
        if (reason) continue; // justified — always allowed, regardless of baseline
        const pos = consumable.indexOf(namesPart);
        if (pos !== -1) {
          consumable.splice(pos, 1); // grandfathered — consume one match, not the whole entry
          continue;
        }
        failures.push({ file, lineNo: idx + 1, content: namesPart });
      }
    });
  }

  return { failures, ceilingFailure, totalBaselineEntries };
}

const BLOCK_BUILDERS = {
  routes() {
    const files = listDir("src/routes")
      .filter((f) => /Routes\.tsx$/.test(f))
      .sort();
    const rows = files.map((file) => {
      const src = read(`src/routes/${file}`);
      const paths = [...src.matchAll(/\bpath="([^"]+)"/g)].map((m) => m[1]);
      const unique = [...new Set(paths)];
      return `| \`${file}\` | ${unique.length} | ${unique.map((p) => `\`${p}\``).join(", ")} |`;
    });
    return [
      `**${files.length} zone route trees** in \`src/routes/\`.`,
      "",
      "| Route tree | Paths | Declared paths |",
      "|---|---|---|",
      ...rows,
    ].join("\n");
  },

  "edge-functions"() {
    const dirs = listDir("supabase/functions")
      .filter((d) => d !== "_shared" && statSync(join(REPO_ROOT, "supabase/functions", d)).isDirectory())
      .sort();
    return `**${dirs.length} Edge Functions** in \`supabase/functions/\` (excluding \`_shared\`): ${dirs
      .map((d) => `\`${d}\``)
      .join(", ")}.`;
  },

  "api-handlers"() {
    // `api/_lib/` is shared plumbing, not a routable handler.
    const files = walk("api")
      .filter((f) => f.endsWith(".ts") && !f.startsWith("api/_lib/"))
      .map((f) => f.slice("api/".length))
      .sort();
    return `**${files.length} Vercel \`/api\` handlers** (excluding the shared \`api/_lib/\` modules): ${files
      .map((f) => `\`${f}\``)
      .join(", ")}.`;
  },

  tables() {
    const classes = {};
    for (const [name, meta] of Object.entries(REGISTRY)) {
      (classes[meta.class] ??= []).push(name);
    }
    const total = Object.keys(REGISTRY).length;
    const breakdown = Object.keys(classes)
      .sort()
      .map((c) => `${classes[c].length} ${c}`)
      .join(" + ");
    return `**${total} base tables** in schema \`public\` (${breakdown}), plus ${TYPES.Views.length} views. Counted from \`supabase/registry/table-classification.json\`, which \`npm run test:db\` keeps honest.`;
  },

  "table-classes"() {
    const classes = {};
    for (const [name, meta] of Object.entries(REGISTRY)) {
      (classes[meta.class] ??= []).push(name);
    }
    const rows = Object.keys(classes)
      .sort()
      .map((c) => {
        const names = classes[c].sort();
        return `| **${c}** | ${names.length} | ${names.map((n) => `\`${n}\``).join(", ")} |`;
      });
    return ["| Class | Count | Tables |", "|---|---|---|", ...rows].join("\n");
  },

  views() {
    return `**${TYPES.Views.length} views:** ${TYPES.Views.map((v) => `\`${v}\``).join(", ")}.`;
  },

  "platform-versions"() {
    const pbx = read("ios/App/App.xcodeproj/project.pbxproj");
    const ios = [...new Set([...pbx.matchAll(/CURRENT_PROJECT_VERSION = ([^;]+);/g)].map((m) => m[1].trim()))];
    const iosMarketing = [...new Set([...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1].trim()))];
    const gradle = read("android/app/build.gradle");
    const code = gradle.match(/versionCode\s+(\S+)/)?.[1] ?? "?";
    const name = gradle.match(/versionName\s+"([^"]+)"/)?.[1] ?? "?";
    return [
      "| Platform | Marketing version | Build |",
      "|---|---|---|",
      `| iOS (\`ios/App/App.xcodeproj\`) | ${iosMarketing.join(", ")} | \`CURRENT_PROJECT_VERSION\` ${ios.join(", ")} |`,
      `| Android (\`android/app/build.gradle\`) | ${name} | \`versionCode\` ${code} |`,
    ].join("\n");
  },
};

function blockRegions(text) {
  const re = /<!-- GENERATED:([a-z-]+) -->\n([\s\S]*?)\n?<!-- \/GENERATED:\1 -->/g;
  return [...text.matchAll(re)].map((m) => ({
    name: m[1],
    body: m[2],
    full: m[0],
    index: m.index,
  }));
}

function checkGeneratedBlocks() {
  const problems = [];
  const rewritten = [];

  const docs = listDir(DOCS_DIR).filter((f) => f.endsWith(".md")).sort();

  for (const file of docs) {
    const rel = `${DOCS_DIR}/${file}`;
    const original = read(rel);
    let next = original;

    for (const region of blockRegions(original)) {
      const builder = BLOCK_BUILDERS[region.name];
      if (!builder) {
        problems.push({ file, name: region.name, reason: "no builder registered for this block name" });
        continue;
      }
      const expected = builder().trimEnd();
      if (region.body.trimEnd() === expected) continue;

      if (FIX) {
        next = next.replace(
          region.full,
          `<!-- GENERATED:${region.name} -->\n${expected}\n<!-- /GENERATED:${region.name} -->`,
        );
      } else {
        problems.push({
          file,
          name: region.name,
          reason: "block is out of date",
          expected,
          actual: region.body.trimEnd(),
        });
      }
    }

    if (FIX && next !== original) {
      writeFileSync(join(REPO_ROOT, rel), next);
      rewritten.push(rel);
    }
  }

  return { problems, rewritten };
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 4 — AGENTS.md is generated, not hand-copied
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AGENTS.md used to be a hand-maintained find-replace copy of CLAUDE.md and had already
 * drifted (and invented `.Codex/rules/` + `npm run check:Codex-md`, neither of which
 * exists). Two hand-maintained copies of one document is the drift failure this whole
 * guard exists to stop, so it is generated and a diff fails here.
 *
 * Returns null when in sync, or a reason string when stale. `--fix` regenerates it.
 */
function checkAgentsMd() {
  const rel = "AGENTS.md";
  const expected = renderAgentsMd();
  if (!existsSync(join(REPO_ROOT, rel))) {
    if (FIX) {
      writeFileSync(join(REPO_ROOT, rel), expected);
      return null;
    }
    return "file is missing";
  }
  if (read(rel) === expected) return null;
  if (FIX) {
    writeFileSync(join(REPO_ROOT, rel), expected);
    return null;
  }
  return "out of date with CLAUDE.md";
}

// ─────────────────────────────────────────────────────────────────────────────
// Check 3 — freshness stamp (ADVISORY; never fails)
// ─────────────────────────────────────────────────────────────────────────────

const STAMP_RE = /<!--\s*verified-against:\s*([0-9a-f]{7,40})\s*-->/;

function checkFreshness() {
  const warnings = [];

  // Check 3 is advisory and must NEVER take the build down. A shallow clone or a
  // detached/empty history makes `rev-parse HEAD` throw, and an uncaught throw
  // here would fail CI on the one check that is explicitly not a gate.
  let head;
  try {
    head = git(["rev-parse", "HEAD"]);
  } catch {
    return ["freshness check skipped — no resolvable git HEAD (shallow or unborn checkout)."];
  }

  for (const [file, paths] of Object.entries(STAMPED_DOCS)) {
    const rel = `${DOCS_DIR}/${file}`;
    if (!existsSync(join(REPO_ROOT, rel))) continue;
    const text = read(rel);

    if (STAMP) {
      const stamped = STAMP_RE.test(text)
        ? text.replace(STAMP_RE, `<!-- verified-against: ${head.slice(0, 8)} -->`)
        : text;
      if (stamped !== text) writeFileSync(join(REPO_ROOT, rel), stamped);
      continue;
    }

    const match = text.match(STAMP_RE);
    if (!match) {
      warnings.push(`${rel}: no \`verified-against\` stamp — add one, then re-verify with --stamp.`);
      continue;
    }
    const sha = match[1];

    let behind;
    let pathsChanged;
    try {
      behind = Number.parseInt(git(["rev-list", "--count", `${sha}..HEAD`]), 10) || 0;
      pathsChanged =
        Number.parseInt(git(["rev-list", "--count", `${sha}..HEAD`, "--", ...paths]), 10) || 0;
    } catch {
      warnings.push(`${rel}: stamped commit \`${sha}\` is not in history — re-stamp it.`);
      continue;
    }

    // BOTH conditions, deliberately. Age alone is noise; a doc can be old and
    // correct because nothing it describes moved.
    if (behind >= STALE_COMMIT_THRESHOLD && pathsChanged > 0) {
      warnings.push(
        `${rel}: stamped at \`${sha}\`, ${behind} commits behind HEAD, and ${pathsChanged} commit(s) since then touched ${paths.join(", ")}.`,
      );
    }
  }

  return warnings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

let failed = false;

// Snapshot stamping runs FIRST so a doc marked in this same invocation is already
// exempt by the time check 1 reads it.
const snapshotsStamped = STAMP ? stampSnapshots() : [];

const { problems, rewritten } = checkGeneratedBlocks();
const dead = checkDeadReferences();
const agentsStale = checkAgentsMd();
const warnings = checkFreshness();
const { failures: ignoreFailures, ceilingFailure, totalBaselineEntries } = checkIgnoreReasons();

if (STAMP) {
  console.log("Stamped `verified-against` to HEAD in the tracked architecture docs.");
  for (const s of snapshotsStamped) console.log(`  snapshot: ${s}`);
}

console.log(
  "check 1 — dead references (docs/*.md, .claude/rules/*.md, CLAUDE.md, AGENTS.md, README.md;\n" +
    "          docs carrying a dated `snapshot:` frontmatter marker are exempt)",
);
for (const f of PENDING_SNAPSHOT_MARKER) {
  console.log(
    `  TODO ${f} is exempt WITHOUT a marker — a live lane owns it. Add \`snapshot:\`\n` +
      "       frontmatter + `--stamp` once that lane ships, then delete it from PENDING_SNAPSHOT_MARKER.",
  );
}
if (dead.length === 0) {
  console.log("  ok — every path and SQL identifier resolves.\n");
} else {
  failed = true;
  for (const f of dead) {
    console.log(`  FAIL ${f.file}:${f.lineNo}  ${f.kind} \`${f.ref}\` does not exist`);
  }
  console.log(
    `  ${dead.length} dead reference(s). Fix the doc, or if the name is deliberately historical add\n` +
      "  `<!-- docs-drift-ignore: name -->` in that file with a reason.\n",
  );
}

console.log("check 2 — generated blocks");
if (FIX) {
  console.log(rewritten.length ? `  rewrote ${rewritten.join(", ")}\n` : "  nothing to rewrite.\n");
}
// Under --fix we regenerate, so a waiver is meaningless: if the block can be rebuilt
// here, rebuild it. Waivers only ever soften the read-only report.
const waived = [], blocking = [];
for (const p of problems) {
  const w = FIX ? null : waiverFor(p);
  if (w && w.expires >= TODAY) waived.push({ ...p, waiver: w });
  else blocking.push({ ...p, waiver: w });
}

if (problems.length === 0) {
  if (!FIX) console.log("  ok — every GENERATED block matches its oracle.\n");
} else if (blocking.length === 0) {
  console.log(`  ok — ${waived.length} block(s) stale but WAIVED; every other block matches.`);
}

for (const p of waived) {
  console.log(
    `  WAIVED ${DOCS_DIR}/${p.file}  GENERATED:${p.name} — ${p.reason}\n` +
      `         owner ${p.waiver.owner}, expires ${p.waiver.expires}. ${p.waiver.reason}`,
  );
}
if (waived.length) {
  console.log(
    `  Waivers are not fixes. Delete the entry in ${WAIVERS_PATH} the moment the owning\n` +
      "  lane lands and regenerates the block.\n",
  );
}

if (blocking.length) {
  failed = true;
  for (const p of blocking) {
    console.log(`  FAIL ${DOCS_DIR}/${p.file}  GENERATED:${p.name} — ${p.reason}`);
    if (p.waiver) {
      console.log(
        `    ⚠ a waiver for this block EXPIRED on ${p.waiver.expires} (owner ${p.waiver.owner}).\n` +
          "      That is the point: it is red so somebody looks at it. Either the owning lane\n" +
          `      landed and the block should be regenerated, or extend the expiry in ${WAIVERS_PATH}\n` +
          "      on purpose, with a reason.",
      );
    }
    if (p.expected !== undefined) {
      console.log("    expected:");
      for (const l of p.expected.split("\n")) console.log(`      ${l}`);
      console.log("    actual:");
      for (const l of p.actual.split("\n")) console.log(`      ${l}`);
    }
  }
  console.log("  Run `npm run docs:check -- --fix`.\n");
}

console.log("check 4 — AGENTS.md is generated from CLAUDE.md");
if (!agentsStale) {
  console.log("  ok — AGENTS.md matches its generator.\n");
} else {
  failed = true;
  console.log(`  FAIL AGENTS.md — ${agentsStale}`);
  console.log("  Edit CLAUDE.md (never AGENTS.md), then run `npm run gen:agents`.\n");
}

console.log("check 3 — freshness stamp (advisory, never fails CI)");
if (warnings.length === 0) {
  console.log("  ok — stamped docs are current, or nothing they describe has moved.");
} else {
  for (const w of warnings) console.log(`  WARN ${w}`);
  console.log("  Advisory only. Re-read the doc, then `npm run docs:check -- --stamp`.");
}

console.log(`\ncheck 5 — docs-drift-ignore comments require a reason (baseline debt: ${totalBaselineEntries}/${IGNORE_DEBT_CEILING}, shrink-only)`);
if (ceilingFailure) {
  failed = true;
  console.log(`  FAIL ${ceilingFailure}`);
} else if (ignoreFailures.length === 0) {
  console.log("  ok — every ignore comment either has a reason or is grandfathered.\n");
} else {
  failed = true;
  for (const f of ignoreFailures) {
    console.log(`  FAIL ${f.file}:${f.lineNo}  docs-drift-ignore \`${f.content}\` has no reason and is not in ${IGNORE_BASELINE_PATH}`);
  }
  console.log(
    `  ${ignoreFailures.length} unreasoned, ungrandfathered ignore comment(s). Add a reason:\n` +
      "  `<!-- docs-drift-ignore: name - why this is deliberately historical -->`\n" +
      "  (comma-separated names may share one reason). The separator can be any of\n" +
      "  ` — `, ` – `, ` -- `, ` - ` and MUST have whitespace on both sides, so a\n" +
      "  hyphenated name is never mistaken for name + reason. Do NOT add it to\n" +
      `  ${IGNORE_BASELINE_PATH} instead — that file is frozen debt, not a whitelist to grow.\n`,
  );
}

if (failed) {
  console.log("\ndocs:check FAILED.");
  process.exit(1);
}
console.log("\ndocs:check passed.");
