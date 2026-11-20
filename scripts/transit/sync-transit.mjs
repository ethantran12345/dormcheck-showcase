#!/usr/bin/env node
/**
 * Sync campus transit data from WPRDC (Western PA Regional Data Center) official feeds.
 *
 *   node scripts/transit/sync-transit.mjs [--env .env] [--dry-run] [--skip-db]
 *
 * Replaces the old hand-typed Supabase data with a repeatable pipeline:
 *  - PRT Routes (GeoJSON)  -> clipped to campus + curated allowlist ->
 *      public/transit/campus-routes.geojson  (static asset; Mapbox loads it by URL,
 *      CDN-cached and bundled into the Capacitor app so it works offline)
 *      src/lib/transitRoutes.generated.ts    (route -> color/name map for filter chips)
 *  - PRT Stops (GeoJSON)   -> clipped to campus bbox -> upsert into `bus_stops`
 *      (preserving the comma-separated `routes` contract that
 *       deriveAvailableBusRoutes / filterBusStopsBySelectedRoutes depend on)
 *  - POGOH Station Locations -> refresh `pogoh_station`
 *
 * Route geometry deliberately ships as a static file, NOT a `bus_routes` table with
 * JSONB geometry: lines are bulky, only change quarterly (PRT "picks"), and the
 * refresh commits a regenerated file so a deploy happens anyway.
 *
 * TODO(pogoh-gbfs): POGOH also runs a live GBFS feed (station_information) with the
 * same fields plus real-time dock counts - possible later upgrade; WPRDC stays the
 * spec'd source for now.
 *
 * Data source: WPRDC (https://data.wprdc.org), data by Pittsburgh Regional Transit
 * and POGOH, released under their open-data licenses. Idempotent; safe to re-run.
 * Later this becomes a scheduled GitHub Action that regenerates and commits.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import bboxClip from '@turf/bbox-clip';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = args.includes('--dry-run');
const SKIP_DB = args.includes('--skip-db');
const ENV_FILE = flag('--env') ?? '.env';

// --- Sources (WPRDC CKAN, all datastore_active) ------------------------------
const ROUTES_URL =
  'https://data.wprdc.org/dataset/6be8185a-7fc3-48c7-9b8d-716602ea03f0/resource/4c3bf8b1-1bcd-42d6-bc7b-4c45be7da085/download/routes.geojson';
const STOPS_URL =
  'https://data.wprdc.org/dataset/33d5f44b-5315-4374-b3e3-e4246e8ad5c9/resource/d6e6ed6e-9220-4a0e-9796-e72d83ce8e7a/download/stops.geojson';
// POGOH station locations via the CKAN datastore dump (JSON) - same resource as the
// XLSX download, no spreadsheet parser needed.
const POGOH_URL =
  'https://data.wprdc.org/datastore/dump/e90f2fca-dd24-47bc-b2ce-307a3579dab9?format=json';

// --- Campus clipping ----------------------------------------------------------
// Central/South/North Oakland + a Shadyside/Squirrel Hill edge.
const CAMPUS_BBOX = [-80.01, 40.427, -79.935, 40.462]; // [minLon, minLat, maxLon, maxLat]
// Stops: small buffer so edge-of-map stops still show.
const STOP_PAD = 0.003;
// Routes: bigger pad (~0.8 km) so a line exits the map edge instead of looking severed.
const ROUTE_PAD = 0.008;

// Curated student-relevant Oakland routes. The app imports the generated
// src/lib/transitRoutes.generated.ts, which this script writes from this list
// reconciled against the routes actually present in the feed.
const CAMPUS_ROUTES = [
  '28X', '54', '58', '61A', '61B', '61C', '61D',
  '71A', '71B', '71C', '71D', '75', '82', '83', '93', 'P3',
];

// Line colors, keyed by route short-name. Hard constraint: nothing on brand green
// #03C03C / the malachite family (dorm pins), nothing near bus-stop amber #FFB81C
// or POGOH teal #0D9488 - a bus line must never read as another map element.
const ROUTE_COLORS = {
  '28X': '#DC2626',
  '54': '#9333EA',
  '58': '#DB2777',
  '61A': '#1D4ED8',
  '61B': '#0284C7',
  '61C': '#6366F1',
  '61D': '#312E81',
  '71A': '#C2410C',
  '71B': '#B45309',
  '71C': '#7E22CE',
  '71D': '#BE123C',
  '75': '#EA580C',
  '82': '#5B21B6',
  '83': '#9D174D',
  '93': '#4338CA',
  'P3': '#B91C1C',
};
// Deterministic fallback for any future allowlist entry without a hand-picked color.
const FALLBACK_PALETTE = ['#0369A1', '#A21CAF', '#B91C1C', '#6D28D9', '#BE185D', '#C2410C'];

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

async function fetchJson(url, label) {
  const res = await fetch(url, { headers: { 'User-Agent': 'dormcheck-transit-sync' } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} from ${url}`);
  return res.json();
}

const pad = (bbox, p) => [bbox[0] - p, bbox[1] - p, bbox[2] + p, bbox[3] + p];
const inBbox = ([lon, lat], bbox) =>
  lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];

/** Clip a (Multi)LineString feature to a bbox; returns line coordinate arrays (may be empty). */
function clipLine(feature, bbox) {
  const clipped = bboxClip(feature, bbox);
  const g = clipped.geometry;
  if (!g) return [];
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  return lines.filter((coords) => coords.length >= 2);
}

function buildRoutesOutput(routesFc) {
  const bbox = pad(CAMPUS_BBOX, ROUTE_PAD);
  const wanted = new Set(CAMPUS_ROUTES);
  const present = new Set(routesFc.features.map((f) => f.properties?.route_code));
  const missing = CAMPUS_ROUTES.filter((c) => !present.has(c));
  if (missing.length) {
    console.warn(`! Allowlist routes not in feed (dropped): ${missing.join(', ')}`);
  }

  const byRoute = new Map(); // code -> { lines: [], long_name }
  for (const f of routesFc.features) {
    const code = f.properties?.route_code;
    if (!wanted.has(code)) continue;
    const lines = clipLine(f, bbox);
    if (!lines.length) continue;
    const entry = byRoute.get(code) ?? { lines: [], long_name: f.properties?.route_name ?? code };
    entry.lines.push(...lines);
    byRoute.set(code, entry);
  }
  const clippedOut = CAMPUS_ROUTES.filter((c) => present.has(c) && !byRoute.has(c));
  if (clippedOut.length) {
    console.warn(`! Allowlist routes with no geometry inside the campus bbox (dropped): ${clippedOut.join(', ')}`);
  }

  let fallbackIdx = 0;
  const features = CAMPUS_ROUTES.filter((c) => byRoute.has(c)).map((code) => {
    const { lines, long_name } = byRoute.get(code);
    const color = ROUTE_COLORS[code] ?? FALLBACK_PALETTE[fallbackIdx++ % FALLBACK_PALETTE.length];
    return {
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: lines },
      properties: { route: code, color, long_name },
    };
  });
  return { type: 'FeatureCollection', features };
}

function buildStopRows(stopsFc) {
  const bbox = pad(CAMPUS_BBOX, STOP_PAD);
  const rows = [];
  for (const f of stopsFc.features) {
    if (f.geometry?.type !== 'Point' || !inBbox(f.geometry.coordinates, bbox)) continue;
    const p = f.properties ?? {};
    const [lon, lat] = f.geometry.coordinates;
    rows.push({
      objectID: p.OBJECTID,
      stop_id: String(p.stop_id ?? ''),
      stop_code: Number(p.stop_code ?? 0),
      stop_name: String(p.stop_name ?? ''),
      stop_lat: lat,
      stop_lon: lon,
      stop_route: String(p.stop_route ?? ''),
      // Comma-separated routes served - the contract deriveAvailableBusRoutes /
      // filterBusStopsBySelectedRoutes split on.
      routes: String(p.route_code ?? ''),
      route_filter: String(p.route_filter ?? ''),
      route_sort: String(p.route_sort ?? ''),
      mode: String(p.mode ?? ''),
      direction: String(p.direction ?? ''),
      svc_days: String(p.svc_days ?? ''),
    });
  }
  return rows;
}

/** Upsert rows and delete stale ones so re-runs fully mirror the feed. */
async function syncTable(supabase, table, pkCol, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + 500), { onConflict: pkCol });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
  const { data: existing, error: selErr } = await supabase.from(table).select(pkCol);
  if (selErr) throw new Error(`${table} select: ${selErr.message}`);
  const keep = new Set(rows.map((r) => String(r[pkCol])));
  const stale = (existing ?? []).map((r) => r[pkCol]).filter((id) => !keep.has(String(id)));
  for (let i = 0; i < stale.length; i += 500) {
    const { error } = await supabase.from(table).delete().in(pkCol, stale.slice(i, i + 500));
    if (error) throw new Error(`${table} delete: ${error.message}`);
  }
  return stale.length;
}

async function main() {
  loadEnv(join(REPO_ROOT, ENV_FILE));

  console.log('Fetching WPRDC feeds...');
  const [routesFc, stopsFc, pogohDump] = await Promise.all([
    fetchJson(ROUTES_URL, 'PRT routes'),
    fetchJson(STOPS_URL, 'PRT stops'),
    fetchJson(POGOH_URL, 'POGOH stations'),
  ]);

  // --- Routes -> static geojson + generated route map -------------------------
  const routesOut = buildRoutesOutput(routesFc);
  const geojsonPath = join(REPO_ROOT, 'public', 'transit', 'campus-routes.geojson');
  const generatedPath = join(REPO_ROOT, 'src', 'lib', 'transitRoutes.generated.ts');
  const generated =
    `// GENERATED by scripts/transit/sync-transit.mjs - do not edit by hand.\n` +
    `// Curated campus PRT routes with their map line colors (source: WPRDC).\n\n` +
    `export interface CampusRoute {\n  code: string;\n  color: string;\n  longName: string;\n}\n\n` +
    `export const CAMPUS_ROUTES: CampusRoute[] = [\n` +
    routesOut.features
      .map((f) => `  { code: '${f.properties.route}', color: '${f.properties.color}', longName: ${JSON.stringify(f.properties.long_name)} },`)
      .join('\n') +
    `\n];\n\nexport const CAMPUS_ROUTE_COLORS: Record<string, string> = Object.fromEntries(\n  CAMPUS_ROUTES.map((r) => [r.code, r.color]),\n);\n`;

  // --- Stops / POGOH rows ------------------------------------------------------
  const stopRows = buildStopRows(stopsFc);
  const pogohIdx = Object.fromEntries(pogohDump.fields.map((f, i) => [f.id, i]));
  const pogohRows = pogohDump.records
    .map((r) => ({
      Id: r[pogohIdx['Id']],
      Name: r[pogohIdx['Name']],
      'Total Docks': r[pogohIdx['Total Docks']],
      Latitude: r[pogohIdx['Latitude']],
      Longitude: r[pogohIdx['Longitude']],
    }))
    .filter((r) => Number.isFinite(Number(r.Latitude)) && Number.isFinite(Number(r.Longitude)));

  console.log(
    `Prepared: ${routesOut.features.length}/${CAMPUS_ROUTES.length} routes, ` +
      `${stopRows.length} campus bus stops (of ${stopsFc.features.length} systemwide), ` +
      `${pogohRows.length} POGOH stations`,
  );

  if (DRY_RUN) {
    console.log('--dry-run: nothing written.');
    return;
  }

  mkdirSync(dirname(geojsonPath), { recursive: true });
  writeFileSync(geojsonPath, JSON.stringify(routesOut));
  writeFileSync(generatedPath, generated);
  console.log(`Wrote ${geojsonPath}`);
  console.log(`Wrote ${generatedPath}`);

  if (SKIP_DB) {
    console.log('--skip-db: Supabase untouched.');
  } else {
    const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role - never the anon key
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error(`Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env file: ${ENV_FILE})`);
      process.exit(1);
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const staleStops = await syncTable(supabase, 'bus_stops', 'objectID', stopRows);
    console.log(`bus_stops: upserted ${stopRows.length}, removed ${staleStops} stale`);
    const stalePogoh = await syncTable(supabase, 'pogoh_station', 'Id', pogohRows);
    console.log(`pogoh_station: upserted ${pogohRows.length}, removed ${stalePogoh} stale`);
  }

  console.log(
    `\nProvenance: WPRDC (data.wprdc.org) - PRT routes/stops + POGOH station locations, ` +
      `fetched ${new Date().toISOString()}. Data by Pittsburgh Regional Transit / POGOH ` +
      `via the Western PA Regional Data Center open-data portal.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
