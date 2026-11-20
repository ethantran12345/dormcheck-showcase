#!/usr/bin/env node
/**
 * Static drift guard for content_reports.chk_content_type.
 *
 * WHY THIS EXISTS
 * ---------------
 * `supabase/migrations/20260731040000_student_setups_hidden_and_reports.sql` does not
 * carry a historical value list. By its own documented contract (section 4, note (a))
 * it carries the FINAL-STATE authorized set, so that replaying that one file on top of
 * a database at HEAD cannot narrow the CHECK. That makes the list a standing
 * maintenance obligation: every later migration that widens chk_content_type has to
 * add its new value there too, in the same commit.
 *
 * Twice, nobody did:
 *   20260825010000_dm_message_reporting.sql  added 'dm_message'
 *   20260906000000_restore_dorm_reviews.sql  added 'student_review'
 * `npm run test:migration-replay` caught it and went red — and then stayed red from
 * 2026-08-25 to 2026-08-17, because that harness needs Docker and a local Supabase
 * stack and is wired into no workflow. A guard nobody runs is not a guard.
 *
 * So this is the same invariant expressed statically: no database, no Docker, ~10ms,
 * safe to run as a blocking gate on every push. It does not REPLACE the replay
 * harness (which proves the constraint's live behaviour after an actual replay); it
 * makes the text drift fail fast, in CI, on the commit that causes it.
 *
 * WHAT IT ASSERTS
 * ---------------
 *   1. The value list in 20260731040000 equals the authorized set.
 *   2. The value list in the LAST migration (by version order) that re-adds
 *      chk_content_type equals the authorized set — i.e. a clean replay from zero
 *      finishes on exactly the authorized values.
 *
 * The authorized set is read from `_authorized` in
 * supabase/tests/content_type_check_drift.test.sql, which is its single definition.
 * Do not add a second copy here; two lists is the bug this file exists to catch.
 *
 * Usage: node scripts/check-content-type-replay-set.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const DRIFT_TEST = join(ROOT, "supabase", "tests", "content_type_check_drift.test.sql");
const REPLAY_SAFE = "20260731040000_student_setups_hidden_and_reports.sql";

/** Strip `--` line comments so a value named in prose is never read as a value. */
const stripComments = (sql) => sql.replace(/--[^\n]*/g, "");

const fail = (msg) => {
  console.error(`❌ ${msg}`);
  process.exitCode = 1;
};

/**
 * The authorized set: the `_authorized` (content_reports) INSERT in the drift test.
 * Bounded at the next statement so the second, `_authorized_ma` (moderation_actions)
 * list cannot leak in — they legitimately differ.
 */
function authorizedSet() {
  const sql = stripComments(readFileSync(DRIFT_TEST, "utf8"));
  const m = sql.match(/INSERT\s+INTO\s+_authorized\s+VALUES([\s\S]*?);/i);
  if (!m) {
    fail(`could not find the _authorized INSERT in ${DRIFT_TEST}. If that list moved, this guard is blind — fix the parse, do not delete the gate.`);
    process.exit(1);
  }
  return new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
}

/**
 * Every `ADD CONSTRAINT chk_content_type[_new] ... CHECK (...)` value list in one
 * migration file, in file order. Returns [] when the file does not touch it.
 */
function listsIn(file) {
  const sql = stripComments(readFileSync(join(MIGRATIONS, file), "utf8"));
  const out = [];
  const re = /ADD\s+CONSTRAINT\s+chk_content_type(?:_new)?\s+CHECK\s*\(([\s\S]*?)\)\s*\)/gi;
  for (const m of sql.matchAll(re)) {
    out.push(new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])));
  }
  return out;
}

const show = (s) => [...s].sort().join(", ");
const diff = (a, b) => [...a].filter((v) => !b.has(v)).sort();

function compare(label, actual, authorized) {
  const missing = diff(authorized, actual);
  const extra = diff(actual, authorized);
  if (missing.length === 0 && extra.length === 0) return true;
  if (missing.length) fail(`${label} is TOO NARROW, missing: ${missing.join(", ")}`);
  if (extra.length) fail(`${label} is TOO BROAD, unexpected: ${extra.join(", ")}`);
  return false;
}

const authorized = authorizedSet();
if (authorized.size === 0) {
  fail("parsed an EMPTY authorized set — the parse is broken, not the migrations.");
  process.exit(1);
}

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

// 1. The designated replay-safe file.
const replaySafe = listsIn(REPLAY_SAFE);
if (replaySafe.length !== 1) {
  fail(`expected exactly 1 chk_content_type value list in ${REPLAY_SAFE}, found ${replaySafe.length}. That file is the replay-safety anchor; a second list there makes "the" set ambiguous.`);
} else if (compare(`${REPLAY_SAFE} replay-safe list`, replaySafe[0], authorized)) {
  console.log(`✅ ${REPLAY_SAFE} lists exactly the ${authorized.size} authorized values`);
}

// 2. The final state a clean replay from zero lands on.
let lastFile = null;
let lastList = null;
for (const f of files) {
  const lists = listsIn(f);
  if (lists.length) { lastFile = f; lastList = lists[lists.length - 1]; }
}
if (!lastList) {
  fail("no migration re-adds chk_content_type at all — the parse is broken.");
} else if (compare(`${lastFile} (last migration to set chk_content_type)`, lastList, authorized)) {
  console.log(`✅ ${lastFile} leaves chk_content_type at exactly the ${authorized.size} authorized values`);
}

if (process.exitCode) {
  console.error("");
  console.error(`   Authorized set (supabase/tests/content_type_check_drift.test.sql): ${show(authorized)}`);
  console.error("   A migration that widens chk_content_type must ALSO widen the list in");
  console.error(`   supabase/migrations/${REPLAY_SAFE} — see its section 4, note (c).`);
  console.error("   Do NOT edit the authorized set to make this pass unless a migration in the");
  console.error("   same commit actually changes what the database holds.");
}
