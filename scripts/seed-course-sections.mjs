#!/usr/bin/env node
/**
 * Seed public.course_sections from a 25Live term export (fall2026_catalog.json).
 *
 *   node scripts/seed-course-sections.mjs /path/to/fall2026_catalog.json [--env .env.e2e] [--dry-run]
 *
 * The catalog file is generated once per term admin-side (25Live event search with
 * Ethan's session; see docs/audits/class-schedule.md). It is NOT checked into git
 * (~4.5 MB, regenerated per term). Upserts on (term, class_number); idempotent.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--env");
const flagVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = args.includes("--dry-run");
const ENV_FILE = flagVal("--env") ?? ".env";
const CATALOG_PATH = positional[0];

if (!CATALOG_PATH) {
  console.error("Usage: node scripts/seed-course-sections.mjs <catalog.json> [--env .env.e2e] [--dry-run]");
  process.exit(1);
}

loadEnv(join(REPO_ROOT, ENV_FILE));
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error(`Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env file: ${ENV_FILE})`);
  process.exit(1);
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

async function main() {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  const term = catalog.term;
  const sections = catalog.sections;
  if (!term || !Array.isArray(sections)) {
    console.error("Catalog file missing term/sections; expected the 25Live export shape.");
    process.exit(1);
  }
  console.log(`Catalog: ${catalog.term_label ?? term} - ${sections.length} section-meetings`);

  const counts = { located: 0, private: 0, online_tba: 0 };
  const seen = new Set();
  const rows = [];
  for (const s of sections) {
    // Dedup on the upsert key: the export can carry recitations sharing a class number.
    const key = `${term}:${s.class_number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[s.location_status] = (counts[s.location_status] ?? 0) + 1;
    rows.push({
      term,
      subject: s.subject,
      catalog_number: s.catalog,
      section: s.section,
      class_number: String(s.class_number),
      component: s.type ?? null,
      title: s.title_full ?? s.title_25live ?? s.title ?? null,
      title_display: s.title_display ?? null,
      days: [...new Set(s.days ?? [])], // 25Live export sometimes doubles the pattern

      start_time: s.start_time || null,
      end_time: s.end_time || null,
      room: s.room && !/^\(private\)$/i.test(s.room.trim()) ? s.room : null,
      building_abbr: s.location_status === "located" ? (s.building_abbr ?? null) : null,
      location_status: s.location_status,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
    });
  }
  console.log(
    `Prepared ${rows.length} unique sections (deduped ${sections.length - rows.length}): ` +
      JSON.stringify(counts),
  );

  if (DRY_RUN) {
    console.log(JSON.stringify(rows.slice(0, 3), null, 2));
    console.log(`[dry-run] would upsert ${rows.length} sections for term ${term}`);
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase
      .from("course_sections")
      .upsert(chunk, { onConflict: "term,class_number" });
    if (error) {
      console.error(`Upsert failed at chunk ${i}: ${error.message}`);
      process.exit(1);
    }
    process.stdout.write(`\r  upserted ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }
  console.log(`\nDone: ${rows.length} sections for term ${term} into ${SUPABASE_URL}`);
}

main();
