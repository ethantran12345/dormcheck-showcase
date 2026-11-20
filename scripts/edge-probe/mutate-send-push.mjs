/**
 * Mutation harness for the send-push probe.
 *
 * A probe that cannot catch the bug it was written for is decoration, and this
 * repo has four logged instances of exactly that. So the defect is re-introduced
 * mechanically, on demand, and the probe must go RED — `bash scripts/test-edge-push.sh
 * --mutate` runs that as a check rather than as a one-off someone did once and
 * wrote down.
 *
 * THE MUTATION: drop the `.eq("user_id", userId)` filter from the device_tokens
 * query, so the fan-out loop walks EVERY device token in the table instead of the
 * addressed student's. This is not a historical defect recovered from git — it is
 * the defect class this probe exists for, and it is one deleted line away at all
 * times:
 *
 *     const { data: rows, error: tokensError } = await supabase
 *       .from("device_tokens")
 *       .select("token, platform")
 *   -   .eq("user_id", userId)
 *       .in("platform", ["ios", "android"]);
 *
 * Nothing else in the system would notice. The function still answers 200, still
 * reports a `sent` count, still logs "done" — the count is just larger, and the
 * notification is on other students' lock screens. Push is live on iOS and Android,
 * and a delivered notification cannot be recalled.
 *
 * A SEPARATE FILE from mutate.mjs on purpose: that one carries a verbatim historical
 * expression from the parent of 6548db1a and refuses to loosen its match. Teaching
 * it a second target would put the moderate-listing gate's teeth at risk to save a
 * dozen lines.
 *
 * Usage:  node scripts/edge-probe/mutate-send-push.mjs apply|restore|status
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, "../../supabase/functions/send-push/index.ts");
// The backup lives OUTSIDE supabase/functions/. `supabase functions serve` watches
// that whole directory and reloads the runtime on ANY file appearing in it — a
// backup written next to index.ts bounces the runtime mid-run and drops in-flight
// requests, which shows up as cases that never reached the vendor stub.
const BACKUP = join(HERE, ".send-push-index.premutation");

const FIXED = `  const { data: rows, error: tokensError } = await supabase
    .from("device_tokens")
    .select("token, platform")
    .eq("user_id", userId)
    .in("platform", ["ios", "android"]);`;

const BUGGED = `  const { data: rows, error: tokensError } = await supabase
    .from("device_tokens")
    .select("token, platform")
    .in("platform", ["ios", "android"]);`;

const cmd = process.argv[2];

if (cmd === "apply") {
  if (existsSync(BACKUP)) {
    console.error(
      "✗ a .premutation backup already exists — a previous run did not restore.\n" +
        "  Inspect it, then: node scripts/edge-probe/mutate-send-push.mjs restore",
    );
    process.exit(1);
  }
  const src = readFileSync(TARGET, "utf8");
  if (!src.includes(FIXED)) {
    console.error(
      "✗ the scoped device_tokens query is not in index.ts verbatim, so the mutation\n" +
        "  cannot be applied honestly. The function was refactored — update\n" +
        "  scripts/edge-probe/mutate-send-push.mjs to match, do NOT loosen the match.",
    );
    process.exit(1);
  }
  writeFileSync(BACKUP, src);
  writeFileSync(TARGET, src.replace(FIXED, BUGGED));
  console.log("✓ mutation applied: device_tokens is no longer filtered by user_id.");
} else if (cmd === "restore") {
  if (!existsSync(BACKUP)) {
    console.log("· nothing to restore (no .premutation backup).");
    process.exit(0);
  }
  writeFileSync(TARGET, readFileSync(BACKUP, "utf8"));
  unlinkSync(BACKUP);
  console.log("✓ index.ts restored from backup.");
} else if (cmd === "status") {
  const src = readFileSync(TARGET, "utf8");
  console.log(existsSync(BACKUP) || !src.includes(FIXED) ? "MUTATED" : "clean");
} else {
  console.error("usage: node scripts/edge-probe/mutate-send-push.mjs apply|restore|status");
  process.exit(2);
}
