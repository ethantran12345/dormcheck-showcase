#!/usr/bin/env node
/**
 * Seed public.master_housing with the CMU starter dataset (multi-university activation, step 8).
 *
 *   node scripts/seed-cmu-housing.mjs [--env .env] [--csv cmu_master_housing_seed.csv] [--dry-run]
 *
 * - Reads the review CSV (see CMU_Housing_Seed_Review.md for provenance), drops the review-only
 *   helper columns (university_slug, source_page, data_provenance, needs_enrichment).
 * - Resolves university_slug 'cmu' to its universities.id UUID and sets university_id explicitly
 *   on every row - never relies on the single-tenant Pitt DEFAULT (the activation drops it).
 * - master_housing has no natural unique key (bigint id PK, no sequence), so the script is
 *   idempotent by delete-then-insert scoped to the CMU university_id. Safe while CMU is dark
 *   (is_active = false); this script owns all CMU rows.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = args.includes("--dry-run");
const ENV_FILE = flag("--env") ?? ".env";
const CSV_PATH = join(REPO_ROOT, flag("--csv") ?? "cmu_master_housing_seed.csv");

loadEnv(join(REPO_ROOT, ENV_FILE));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error(`Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env file: ${ENV_FILE})`);
  process.exit(1);
}

// CSV columns that are review metadata, not master_housing columns.
const HELPER_COLUMNS = ["university_slug", "source_page", "data_provenance", "needs_enrichment"];
// DB booleans and the bigint floors column; everything else in the CSV is text or numeric.
const BOOLEAN_COLUMNS = ["heat_and_air_conditioning", "meal_plan_options", "wifi_and_cable", "window_coverings"];
const NUMERIC_COLUMNS = ["latitude", "longitude"];
const INTEGER_COLUMNS = ["floors"];

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

// Minimal RFC-4180 parser: quoted fields may contain commas, quotes ("") and newlines.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

function coerce(column, raw) {
  const value = raw.trim();
  if (value === "") return null;
  if (BOOLEAN_COLUMNS.includes(column)) return value.toUpperCase() === "TRUE";
  if (INTEGER_COLUMNS.includes(column)) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (NUMERIC_COLUMNS.includes(column)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

async function main() {
  const [header, ...dataRows] = parseCsv(readFileSync(CSV_PATH, "utf8"));
  if (!header?.includes("residence_hall") || !header.includes("university_slug")) {
    console.error(`Unexpected CSV header in ${CSV_PATH}; aborting.`);
    process.exit(1);
  }

  const records = dataRows.map((cells) => {
    const rec = {};
    header.forEach((col, i) => {
      if (!HELPER_COLUMNS.includes(col)) rec[col] = coerce(col, cells[i] ?? "");
    });
    return rec;
  });
  const badSlug = dataRows.filter((cells) => cells[header.indexOf("university_slug")] !== "cmu");
  if (badSlug.length > 0) {
    console.error(`${badSlug.length} rows have university_slug != 'cmu'; aborting.`);
    process.exit(1);
  }
  console.log(`Parsed ${records.length} CMU residences from ${CSV_PATH}`);

  if (DRY_RUN) {
    console.log(JSON.stringify(records.slice(0, 3), null, 2));
    console.log(`Columns per row: ${Object.keys(records[0]).join(", ")}`);
    console.log(`[dry-run] would replace all CMU master_housing rows with ${records.length} rows`);
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: cmu, error: uniError } = await supabase
    .from("universities")
    .select("id, slug, is_active")
    .eq("slug", "cmu")
    .maybeSingle();
  if (uniError) {
    console.error(`universities lookup failed: ${uniError.message}`);
    process.exit(1);
  }
  if (!cmu) {
    console.error(
      "No universities row with slug 'cmu'. Apply the CMU activation migration first " +
        "(handoff-cmu-multi-university-activation.md, step 1) - this script never creates it."
    );
    process.exit(1);
  }
  console.log(`Resolved CMU university_id ${cmu.id} (is_active=${cmu.is_active})`);

  // No id sequence on master_housing - allocate above the current max.
  const { data: maxRow, error: maxError } = await supabase
    .from("master_housing")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxError) {
    console.error(`max(id) lookup failed: ${maxError.message}`);
    process.exit(1);
  }
  const nextId = (maxRow?.id ?? 0) + 1;

  const { error: deleteError, count: deleted } = await supabase
    .from("master_housing")
    .delete({ count: "exact" })
    .eq("university_id", cmu.id);
  if (deleteError) {
    console.error(`Delete of existing CMU rows failed: ${deleteError.message}`);
    process.exit(1);
  }
  console.log(`Deleted ${deleted ?? 0} existing CMU rows`);

  const payload = records.map((rec, i) => ({ ...rec, id: nextId + i, university_id: cmu.id }));
  const { error: insertError } = await supabase.from("master_housing").insert(payload);
  if (insertError) {
    console.error(`Insert failed: ${insertError.message}`);
    process.exit(1);
  }
  console.log(`Inserted ${payload.length} CMU rows into ${SUPABASE_URL}`);

  const { data: fixture } = await supabase
    .from("master_housing")
    .select("id, residence_hall, accomodation, capacity, university_id")
    .eq("university_id", cmu.id)
    .eq("residence_hall", "Morewood Gardens")
    .limit(1);
  console.log("Fixture check (Morewood Gardens):", JSON.stringify(fixture?.[0] ?? null));
}

main();
