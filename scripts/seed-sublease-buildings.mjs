#!/usr/bin/env node
/**
 * Seed the off-campus half of public.buildings — the apartment buildings a Pitt
 * student actually subleases — so the sublease composer's building picker has
 * something to pick.
 *
 *   node scripts/seed-sublease-buildings.mjs              # geocode + PRINT only
 *   node scripts/seed-sublease-buildings.mjs --write      # ...and upsert
 *   node scripts/seed-sublease-buildings.mjs --env .env.e2e --write
 *
 * Source list: scripts/data/sublease-buildings-pitt.json (checked in, with a
 * `source` on every row). Rows land as kind='off_campus', is_subleasable=true,
 * university_id = Pitt.
 *
 * ── Why --write is opt-in ────────────────────────────────────────────────────
 * The dry run is the review step, not a convenience. A coordinate here becomes a
 * map pin, and a pin asserts location more strongly than a text line does, so a
 * bad coordinate caught once at this desk is a bad coordinate never shipped.
 * The default run geocodes everything, prints every hit with its distance from
 * campus, and writes nothing.
 *
 * ── Why the geocoder is re-implemented here ──────────────────────────────────
 * src/lib/geocode.ts is the ONE forward geocoder in the app and this file
 * deliberately does not import it: it reads `import.meta.env.VITE_MAPBOX_TOKEN`,
 * which is Vite/browser-only and `undefined` under Node — the import would not
 * fail loudly, it would silently geocode nothing. What IS reused is the part
 * that matters: the same campus `proximity` bias and the same
 * MAX_CAMPUS_DISTANCE_KM guard, kept numerically identical below. Mapbox's
 * `proximity` is a ranking bias, not a filter, so an unresolvable query returns
 * the best GLOBAL match instead of nothing — that is how a CMU listing once
 * geocoded to a village in Lancashire, England (2026-08-06).
 *
 * ── abbr convention ──────────────────────────────────────────────────────────
 * `buildings.abbr` is NOT NULL and GLOBALLY UNIQUE (buildings_abbr_key), and the
 * 269 existing rows use Pitt's own facilities codes (AIK, ALLGY, BAKSQ…). An
 * off-campus row must therefore mint one that cannot collide with those:
 *
 *     abbr = 'OC-' + first 10 alphanumeric chars of the street line, uppercased
 *     "3333 Forbes Ave, Pittsburgh, PA 15213"  ->  OC-3333FORBES
 *     "300 Craft Ave, Pittsburgh, PA 15213"    ->  OC-300CRAFTA
 *
 * Derived from the ADDRESS rather than the name on purpose. The address is the
 * one field that is unique per building and stable across a rename, so re-running
 * this script after editing a name, or after inserting a row in the middle of the
 * JSON, produces the same abbr for the same building — which is what makes the
 * upsert idempotent instead of duplicating. The `OC-` prefix is what guarantees
 * no collision with a Pitt facilities code (none contain a hyphen).
 *
 * Two rows sharing a street line would collide; that is a data error, so the
 * script refuses to run rather than silently disambiguating.
 *
 * Upsert key is (university_id, name) — the unique index added in
 * supabase/migrations/20260928000000_sublease_building_registry.sql.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const WRITE = args.includes('--write');
const ALLOW_REMOTE = args.includes('--allow-remote');
const ENV_FILE = flagValue('--env') ?? '.env.e2e';
const DATA_FILE = flagValue('--data') ?? 'scripts/data/sublease-buildings-pitt.json';

/** Pitt campusCenter from src/config/universities.ts, Mapbox order [lng, lat]. */
const CAMPUS = { lat: 40.443, lng: -79.956 };
/** Identical to MAX_CAMPUS_DISTANCE_KM in src/lib/geocode.ts. Keep them equal. */
const MAX_CAMPUS_DISTANCE_KM = 30;
/** Mirrors PITT_UNIVERSITY_ID in src/config/universities.ts. */
const PITT_UNIVERSITY_ID = '00000000-0000-4000-8000-000000000001';

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

// The chosen env file wins; `.env` fills the gaps. Local Supabase credentials
// live in .env.e2e, which carries no Mapbox token — without this second pass the
// script would have a database and no geocoder.
loadEnv(join(REPO_ROOT, ENV_FILE));
loadEnv(join(REPO_ROOT, '.env'));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAPBOX_TOKEN = process.env.VITE_MAPBOX_TOKEN ?? process.env.MAPBOX_TOKEN;

if (!SUPABASE_URL || !SERVICE_KEY || !MAPBOX_TOKEN) {
  console.error(
    `Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_MAPBOX_TOKEN ` +
      `(read from ${ENV_FILE}, then .env)`,
  );
  process.exit(1);
}

const IS_LOCAL = /127\.0\.0\.1|localhost/.test(SUPABASE_URL);
if (WRITE && !IS_LOCAL && !ALLOW_REMOTE) {
  console.error(
    `Refusing to --write to ${SUPABASE_URL}: that is not a local stack.\n` +
      `Prod apply is a separate approved step. Pass --allow-remote if you really mean it.`,
  );
  process.exit(1);
}

/** Great-circle km. Same formula as distanceKm() in src/lib/geocode.ts. */
function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 'OC-' + first 10 alphanumerics of the street line. See the header. */
function abbrFor(address) {
  const street = address.split(',')[0] ?? address;
  const token = street.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  if (!token) throw new Error(`Cannot derive an abbr from address "${address}"`);
  return `OC-${token}`;
}

/** City / zip parsed back out of the address line so the columns are populated. */
function cityZipFor(address) {
  const zip = address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? null;
  const parts = address.split(',').map((s) => s.trim());
  const city = parts.length >= 2 ? parts[1] : null;
  return { city: city || null, zip };
}

async function mapboxForward(query) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${MAPBOX_TOKEN}&limit=1&country=us` +
    `&proximity=${CAMPUS.lng},${CAMPUS.lat}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox ${res.status} for "${query}"`);
  const body = await res.json();
  const feature = body.features?.[0];
  const center = feature?.center;
  if (!Array.isArray(center) || center.length < 2) return null;
  return { lat: center[1], lng: center[0], label: feature.place_name ?? query };
}

async function main() {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, DATA_FILE), 'utf8'));
  const rows = raw.buildings ?? [];
  if (rows.length === 0) {
    console.error(`${DATA_FILE} lists no buildings.`);
    process.exit(1);
  }

  // Fail loudly on a duplicate abbr rather than inventing a suffix: a silent
  // disambiguation is how two records for one building get created.
  const byAbbr = new Map();
  for (const b of rows) {
    const abbr = abbrFor(b.address);
    if (byAbbr.has(abbr)) {
      console.error(
        `Duplicate abbr ${abbr}: "${byAbbr.get(abbr)}" and "${b.name}" share a street line. Fix ${DATA_FILE}.`,
      );
      process.exit(1);
    }
    byAbbr.set(abbr, b.name);
  }
  const byName = new Set();
  for (const b of rows) {
    const key = b.name.trim().toLowerCase();
    if (byName.has(key)) {
      console.error(`Duplicate name "${b.name}" in ${DATA_FILE} — the upsert key is (university_id, name).`);
      process.exit(1);
    }
    byName.add(key);
  }

  console.log(`Target : ${SUPABASE_URL}${IS_LOCAL ? ' (local)' : ' (REMOTE)'}`);
  console.log(`Source : ${DATA_FILE} — ${rows.length} buildings`);
  console.log(`Mode   : ${WRITE ? 'WRITE' : 'dry run (no --write; nothing will be inserted)'}`);
  console.log(`Guard  : proximity ${CAMPUS.lat},${CAMPUS.lng} · reject beyond ${MAX_CAMPUS_DISTANCE_KM} km\n`);

  const accepted = [];
  const rejected = [];

  for (const b of rows) {
    const hit = await mapboxForward(b.address);
    if (!hit) {
      rejected.push({ ...b, reason: 'no geocode result' });
      console.log(`MISS   ${b.name}\n         query "${b.address}" resolved to nothing`);
      continue;
    }
    const km = distanceKm(hit, CAMPUS);
    const line =
      `${b.name}\n         ${hit.lat.toFixed(6)}, ${hit.lng.toFixed(6)}  ` +
      `(${km.toFixed(2)} km from campus)\n         mapbox: ${hit.label}`;
    if (km > MAX_CAMPUS_DISTANCE_KM) {
      rejected.push({ ...b, reason: `${km.toFixed(2)} km from campus`, hit });
      console.log(`REJECT ${line}`);
      continue;
    }
    accepted.push({ ...b, hit, km, abbr: abbrFor(b.address) });
    console.log(`OK     ${line}`);
  }

  // Farthest last, so the rows most worth a second look are the ones still on
  // screen when the run ends.
  const review = [...accepted].sort((a, b) => a.km - b.km).slice(-5);
  console.log(`\nFarthest accepted (review these first):`);
  for (const r of review) console.log(`  ${r.km.toFixed(2)} km  ${r.name} — ${r.hit.label}`);

  console.log(`\nGeocoded ${rows.length}: ${accepted.length} accepted, ${rejected.length} rejected.`);
  if (rejected.length > 0) {
    console.log('Rejected:');
    for (const r of rejected) console.log(`  - ${r.name} (${r.address}): ${r.reason}`);
  }

  if (!WRITE) {
    console.log(`\nNothing written. Re-run with --write once the coordinates above look right.`);
    return;
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const payload = accepted.map((b) => {
    const { city, zip } = cityZipFor(b.address);
    return {
      name: b.name,
      abbr: b.abbr,
      address: b.address,
      city,
      zip,
      lat: b.hit.lat,
      lng: b.hit.lng,
      kind: 'off_campus',
      is_subleasable: true,
      university_id: PITT_UNIVERSITY_ID,
      campus: 'Pittsburgh',
    };
  });

  const { data, error } = await db
    .from('buildings')
    .upsert(payload, { onConflict: 'university_id,name' })
    .select('id, name, abbr');

  if (error) {
    console.error(`\nUpsert failed: ${error.message}`);
    if (error.details) console.error(error.details);
    process.exit(1);
  }

  console.log(`\nWrote ${data?.length ?? 0} rows to public.buildings (kind='off_campus', is_subleasable=true).`);
  if (rejected.length > 0) process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
