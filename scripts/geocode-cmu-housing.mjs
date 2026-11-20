#!/usr/bin/env node
/**
 * Backfill latitude/longitude on the CMU public.master_housing rows (multi-university
 * activation follow-up; see CMU_Housing_Seed_Review.md "Deliberately empty").
 *
 *   node scripts/geocode-cmu-housing.mjs [--env .env] [--dry-run]
 *
 * - Fetches all CMU rows via service role, groups by residence_hall (building-level
 *   fields repeat across a building's room-type rows, so lat/lng is per residence).
 * - Geocodes each residence with the Mapbox geocoding API (VITE_MAPBOX_TOKEN): the
 *   published street `address` where present, else
 *   "<residence_hall>, Carnegie Mellon University, Pittsburgh PA", biased to campus
 *   via proximity.
 * - Sanity gate: a pin further than MAX_KM from the CMU campus center (40.443, -79.943)
 *   is reported and NOT written.
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

const CAMPUS = { lat: 40.443, lng: -79.943 };
const MAX_KM = 2.5; // CMU housing spans campus + Oakland fringe; anything past this is a bad hit.

// Published street addresses for residences whose master_housing `address` is empty
// (CSV captured 9/26; these come from CMU's official residence pages / building directory).
// Mapbox can't resolve CMU building names as POIs, so name-only queries fall back to
// city-level Pittsburgh — every empty-address residence needs an entry here.
const ADDRESS_OVERRIDES = {
  "Boss House": "5126 Margaret Morrison St, Pittsburgh, PA 15213",
  "McGill House": "5128 Margaret Morrison St, Pittsburgh, PA 15213",
  "Donner House": "5115 Margaret Morrison St, Pittsburgh, PA 15213",
  "Hamerschlag House": "5030 Margaret Morrison St, Pittsburgh, PA 15213",
  "Henderson House": "5124 Margaret Morrison St, Pittsburgh, PA 15213",
  "Scobell House": "5120 Margaret Morrison St, Pittsburgh, PA 15213",
  "Stever House": "1030 Morewood Ave, Pittsburgh, PA 15213",
  "Welch House": "5122 Margaret Morrison St, Pittsburgh, PA 15213",
  "Maggie Mo First-Year Houses": "5140 Margaret Morrison St, Pittsburgh, PA 15213",
  "Margaret Morrison Apartments": "5140 Margaret Morrison St, Pittsburgh, PA 15213",
  "Clyde House": "4659 Fifth Ave, Pittsburgh, PA 15213",
  "Fifth & Clyde Residence Hall": "4738 Fifth Ave, Pittsburgh, PA 15213",
  "West Wing": "5125 Margaret Morrison St, Pittsburgh, PA 15213",
  "Resnik House": "5125 Margaret Morrison St, Pittsburgh, PA 15213",
  "Roselawn Houses": "15 Roselawn Terrace, Pittsburgh, PA 15213",
  "Woodlawn Apartments": "5176 Margaret Morrison St, Pittsburgh, PA 15213",
  "Greek Quad": "1055 Morewood Ave, Pittsburgh, PA 15213",
};

loadEnv(join(REPO_ROOT, ENV_FILE));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAPBOX_TOKEN = process.env.VITE_MAPBOX_TOKEN;
if (!SUPABASE_URL || !SERVICE_KEY || !MAPBOX_TOKEN) {
  console.error(
    `Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_MAPBOX_TOKEN (env file: ${ENV_FILE})`
  );
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

function kmFromCampus(lat, lng) {
  const dLat = ((lat - CAMPUS.lat) * Math.PI) / 180;
  const dLng = ((lng - CAMPUS.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((CAMPUS.lat * Math.PI) / 180) *
      Math.cos((lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocode(query) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${MAPBOX_TOKEN}&limit=1&proximity=${CAMPUS.lng},${CAMPUS.lat}&country=us`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox ${res.status} for "${query}"`);
  const body = await res.json();
  const feature = body.features?.[0];
  if (!feature) return null;
  const [lng, lat] = feature.center;
  return { lat, lng, place: feature.place_name };
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: cmu, error: uniError } = await supabase
    .from("universities")
    .select("id, slug")
    .eq("slug", "cmu")
    .maybeSingle();
  if (uniError || !cmu) {
    console.error(`universities lookup failed: ${uniError?.message ?? "no 'cmu' row"}`);
    process.exit(1);
  }

  const { data: rows, error: rowsError } = await supabase
    .from("master_housing")
    .select("id, residence_hall, address, latitude, longitude")
    .eq("university_id", cmu.id)
    .order("id");
  if (rowsError) {
    console.error(`master_housing fetch failed: ${rowsError.message}`);
    process.exit(1);
  }
  console.log(`Fetched ${rows.length} CMU rows (university_id ${cmu.id})`);

  const residences = new Map();
  for (const row of rows) {
    const entry = residences.get(row.residence_hall) ?? { address: row.address, ids: [] };
    entry.ids.push(row.id);
    if (!entry.address && row.address) entry.address = row.address;
    residences.set(row.residence_hall, entry);
  }
  console.log(`${residences.size} distinct residences to geocode`);

  const skipped = [];
  let updatedRows = 0;
  for (const [hall, { address, ids }] of residences) {
    const query = address
      ? `${address}, Pittsburgh, PA`
      : ADDRESS_OVERRIDES[hall] ?? `${hall}, Carnegie Mellon University, Pittsburgh PA`;
    const hit = await geocode(query);
    if (!hit) {
      skipped.push({ hall, query, reason: "no result" });
      console.warn(`SKIP ${hall}: no geocode result for "${query}"`);
      continue;
    }
    const km = kmFromCampus(hit.lat, hit.lng);
    const label = `${hall} -> ${hit.lat.toFixed(6)}, ${hit.lng.toFixed(6)} (${km.toFixed(2)} km) [${hit.place}]`;
    if (km > MAX_KM) {
      skipped.push({ hall, query, reason: `${km.toFixed(2)} km from campus`, hit });
      console.warn(`SKIP ${label} - beyond ${MAX_KM} km sanity radius`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`[dry-run] ${label} (${ids.length} rows)`);
      continue;
    }
    const { error: updateError, count } = await supabase
      .from("master_housing")
      .update({ latitude: hit.lat, longitude: hit.lng }, { count: "exact" })
      .in("id", ids);
    if (updateError) {
      console.error(`Update failed for ${hall}: ${updateError.message}`);
      process.exit(1);
    }
    updatedRows += count ?? 0;
    console.log(`OK   ${label} (${count} rows)`);
  }

  console.log(`\nUpdated ${updatedRows}/${rows.length} rows; skipped ${skipped.length} residences.`);
  if (skipped.length > 0) {
    console.log("Skipped (need manual coordinates):");
    for (const s of skipped) console.log(`  - ${s.hall}: ${s.reason} (query: "${s.query}")`);
    process.exitCode = 2;
  }
}

main();
