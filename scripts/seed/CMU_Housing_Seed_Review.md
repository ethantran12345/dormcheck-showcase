# CMU Housing Seed — Review Sheet (v2, Pitt-parity)

**Updated:** 2026-07-10 · For: DormCheck multi-university activation (CMU, behind `is_active = false`)
**Companion:** `cmu_master_housing_seed.csv` (65 rows) → `public.master_housing`

## What changed from v1

v1 was 25 rows (one per residence). v2 is **65 rows, one per (residence × room type)** — the same
structure Pitt uses (confirmed against the live DB: Pitt's 18 on-campus halls are ~68 rows, each a
single room type + single semester rate, with building-level fields repeated across the building's
rows). Every column Pitt populates on ~100% of rows is now filled for CMU, sourced from CMU's
official residence detail pages (fetched 2026-07-10) plus the official rates PDF.

## Structure (matches Pitt exactly)

- One row per room type. `accomodation` = the room type (e.g. "Semi-Suite - Double"), `rate_per_term`
  = that type's **semester** rate as a plain number ("6,458.00"), matching Pitt's format.
- Building-level fields (`address`, `capacity`, `floors`, `details`, `inroom_amenities`,
  `building_amenities`, `image_url`, `community_type`, etc.) repeat across a building's rows — same as Pitt.
- `housing_type` uses Pitt's two exact values: `On-Campus Housing` (dorm-style) and
  `Leased Apartments, Apartment Style Housing` (the apartment/studio communities).

## Column coverage vs Pitt (Pitt's fill rate in parens)

Filled on all 65 rows: `residence_hall`, `accomodation`, `rate_per_term`, `rent_period`, `terms`,
`meal_plan_options`, `housing_type`, `mailing_address`, `mailing_services`, `capacity`,
`who_lives_here`, `community_type`, `details`, `inroom_amenities`, `building_amenities`,
`wifi_and_cable`, `heat_and_air_conditioning`, `window_coverings`, `laundry`.
Filled where CMU publishes it: `floors` (18/26 residences), `image_url` (24/26),
`floorplan` (most), `building_llc` (house communities / themed housing where they exist).

Now complete (backfilled 2026-07-10):
- `address` — **26/26 residences.** 9 came from the detail pages; the other 17 street addresses were
  researched from CMU's official housing pages (baked into `scripts/geocode-cmu-housing.mjs`
  `ADDRESS_OVERRIDES`) and are now in the CSV `address` column too.
- `latitude` / `longitude` — **RESOLVED, 65/65 rows.** Geocoded from the addresses via Mapbox (every
  pin 0.15–0.66 km from campus center, past a 2.5 km sanity gate) and backfilled into the CSV. Because
  the CSV now carries the coordinates and `seed-cmu-housing.mjs` coerces lat/lng as numeric, a reseed
  no longer drops the pins — no geocoder re-run needed after a reseed. `geocode-cmu-housing.mjs` stays
  useful for any newly added residence.

Deliberately empty (matching how Pitt treats them):
- `resident_director` — CMU's "House Fellow"; names aren't on the public pages (Pitt only fills 62/142).
- `important_dates` + all `move_in_*` — Pitt's move-in schedule is pilot-specific; CMU has its own move-in
  ops. Left empty until CMU move-in data exists (Pitt leaves move_in_time/entrance/cart/date empty too).

## Corrections baked in (from the official pages — v1 had these wrong)

- **Residence on Fifth** and **Clyde House** are **first-year** apartment-style housing, not upperclass.
- **Fifth & Clyde Residence Hall** is **upperclass** (v1 said mixed).
- **Margaret Morrison** is two different things, now split into two residences: **Maggie Mo First-Year
  Houses** (first-year, semi-suite + double-as-triple) and **Margaret Morrison Apartments** (upperclass
  apartment doubles). The rates PDF lumped them; the official pages separate them. The room-type→residence
  split here is an inference from combining the two — sanity-check bed counts at activation.
- **Spirit House** is **excluded** — CMU has it offline for 2025-26 and 2026-27.
- **Greek Quad** kept in, per your call.

## Provenance

Rates / room types / bed counts: **CMU official 2026-2027 Housing Rates PDF**. Building details, floors,
amenities, images, floor plans, community/gender setup, addresses: **CMU official residence detail pages**
(one per residence, fetched 2026-07-10). Qualitative color cross-checked against the student CMU dorms
guide (unofficial). `details` paragraphs are written in the same informative voice as Pitt's rows.
`mailing_address` uses CMU's central student mailing format (5032 Forbes Ave, SMC box) — CMU routes mail
centrally, not per-building, so this is uniform.

## REQUIRED loader tweak before running v2 (small)

`scripts/seed-cmu-housing.mjs` was verified against v1, which only had one boolean column. v2 adds three
more DB-boolean columns and populates the `bigint` `floors` column, so update two constants:

```js
const BOOLEAN_COLUMNS = ["heat_and_air_conditioning", "meal_plan_options", "wifi_and_cable", "window_coverings"];
const INTEGER_COLUMNS = ["floors"]; // and coerce these to parseInt in coerce()
```
The CSV already guarantees `floors` is integer-or-empty and every boolean is `TRUE`/`FALSE`/empty, so this
is the only change. Re-run the dry-run to confirm the 34-column insert set, then the live run.

## Load path (unchanged)

`node scripts/seed-cmu-housing.mjs --dry-run` then live. Loader drops the 4 helper columns
(`university_slug`, `source_page`, `data_provenance`, `needs_enrichment`), resolves `cmu` → its UUID, sets
`university_id` explicitly, and delete-then-inserts all CMU rows. Still gated on the activation migrations
(CMU `universities` row + DEFAULT drop) landing first.
