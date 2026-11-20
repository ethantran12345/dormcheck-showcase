#!/usr/bin/env node
/**
 * Seed public.buildings from Pitt Capital Asset Management's public building list.
 *
 *   node scripts/seed-buildings.mjs [--env .env.e2e] [--merge /path/to/pitt_buildings.json] [--dry-run]
 *
 * - Fetches https://www.capitalassets.pitt.edu/building-list (server-rendered HTML table:
 *   Name | Abbr | Bldg # | Address | City | Zip), filters City = PITTSBURGH.
 * - Geocodes via the US Census geocoder (public domain; Mapbox geocodes must NOT be
 *   stored per Mapbox ToS).
 * - Optionally merges coordinates from a pre-geocoded pitt_buildings.json (25Live export).
 * - Upserts on abbr with the service-role key. Idempotent; safe to re-run.
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
const MERGE_PATH = flag("--merge");

loadEnv(join(REPO_ROOT, ENV_FILE));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error(`Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env file: ${ENV_FILE})`);
  process.exit(1);
}

const BUILDING_LIST_URL = "https://www.capitalassets.pitt.edu/building-list";
const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseBuildingTable(html) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html))) {
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      cells.push(decodeEntities(cellMatch[1].replace(/<[^>]*>/g, "").trim()));
    }
    if (cells.length >= 6 && cells[1] && cells[0].toUpperCase() !== "BUILDING NAME") {
      rows.push({
        name: cells[0],
        abbr: cells[1].toUpperCase(),
        building_number: cells[2] || null,
        address: cells[3],
        city: cells[4].toUpperCase(),
        zip: cells[5],
      });
    }
  }
  return rows;
}

async function censusGeocode(address, city, zip) {
  const oneline = `${address}, ${city}, PA ${zip}`;
  const url = `${CENSUS_URL}?address=${encodeURIComponent(oneline)}&benchmark=Public_AR_Current&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const match = json?.result?.addressMatches?.[0];
    if (!match) return null;
    return { lat: match.coordinates.y, lng: match.coordinates.x };
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Fetching ${BUILDING_LIST_URL} ...`);
  const res = await fetch(BUILDING_LIST_URL, {
    headers: { "user-agent": "DormCheck building seed (contact: dormcheck.com)" },
  });
  if (!res.ok) {
    console.error(`Building list fetch failed: ${res.status}`);
    process.exit(1);
  }
  const all = parseBuildingTable(await res.text());
  const pittsburgh = all.filter((b) => b.city === "PITTSBURGH");
  console.log(`Parsed ${all.length} rows; ${pittsburgh.length} Pittsburgh-campus buildings.`);
  if (pittsburgh.length === 0) {
    console.error("Parsed zero Pittsburgh rows; page structure may have changed. Aborting.");
    process.exit(1);
  }

  // Pre-geocoded coords from the 25Live export take precedence (already verified).
  const merged = new Map();
  if (MERGE_PATH) {
    const extra = JSON.parse(readFileSync(MERGE_PATH, "utf8"));
    for (const b of extra) merged.set(b.abbr.toUpperCase(), { lat: b.lat, lng: b.lng });
    console.log(`Merged coords for ${merged.size} buildings from ${MERGE_PATH}`);
  }

  let geocoded = 0;
  let missing = 0;
  const out = [];
  for (const b of pittsburgh) {
    let coords = merged.get(b.abbr) ?? null;
    if (!coords) {
      coords = await censusGeocode(b.address, b.city, b.zip);
      await new Promise((r) => setTimeout(r, 150)); // be polite to the Census API
    }
    if (coords) geocoded++;
    else {
      missing++;
      console.warn(`  no geocode: ${b.abbr} ${b.name} (${b.address})`);
    }
    out.push({ ...b, lat: coords?.lat ?? null, lng: coords?.lng ?? null, campus: "Pittsburgh" });
  }
  console.log(`Geocoded ${geocoded}/${pittsburgh.length} (${missing} without coordinates).`);

  if (DRY_RUN) {
    console.log(JSON.stringify(out.slice(0, 5), null, 2));
    console.log(`[dry-run] would upsert ${out.length} buildings`);
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  for (let i = 0; i < out.length; i += 200) {
    const chunk = out.slice(i, i + 200);
    const { error } = await supabase
      .from("buildings")
      .upsert(chunk, { onConflict: "abbr" });
    if (error) {
      console.error(`Upsert failed at chunk ${i}: ${error.message}`);
      process.exit(1);
    }
  }
  console.log(`Upserted ${out.length} buildings into ${SUPABASE_URL}`);

  const { data: cl } = await supabase
    .from("buildings")
    .select("abbr,name,lat,lng")
    .eq("abbr", "CL")
    .single();
  console.log("Fixture check (CL):", JSON.stringify(cl));
}

main();
