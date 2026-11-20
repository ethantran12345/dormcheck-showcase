# Sublease Phase 1 — production rollout runbook

> **Status: PREPARED, NOT EXECUTED.** Nothing in this file has been run against
> production. The sessions that wrote it (2026-08-17) did not apply a migration, did not
> run the seed, and did not run `supabase config push`. The 2026-08-17 revision *did*
> read production — read-only `SELECT` over the Management API, to build the gap table
> below — and wrote nothing. Ethan approves and runs this separately.
>
> **Rehearsal pass 2026-08-17 20:2x ET — still nothing written.** Every probe in §0 was
> re-run read-only against `abcdefghijklmnopqrst`, the §2 duplicate pre-check was re-run,
> and the §3 seed was executed **in dry-run mode pointed at the prod env file** (no
> `--write`, no `--allow-remote`). All fourteen probes returned byte-identical results to
> the values recorded below: **the gap has not moved.** No `apply_migration`, no
> INSERT/UPDATE/DELETE, no `supabase config push`, no `dev` → `main` release. Ethan has
> **not** green-lit the rollout; the run order is §7.
>
> **Doc control** — `supabase/migrations/20260906000000_restore_dorm_reviews.sql`,
> `20260907000000_sublease_verified_lister_gate.sql`,
> `20260928000000_sublease_building_registry.sql`,
> `20260929000000_listing_building_tenant_consistency.sql`,
> `20261001000000_revoke_anon_execute_can_post_sublease.sql`,
> `20261002000000_buildings_marketplace_group_scope.sql`,
> `scripts/seed-sublease-buildings.mjs`, `docs/release-gates.md`.
>
> **CANCELLED 2026-08-18 — `20260930000000_gate_sublease_posting_unseeded_tenants.sql`
> is deleted from the repo and removed from this runbook.** It existed to close
> sublease POSTING at any tenant whose building registry was unseeded, because under
> Phase 1 a student there had nothing to pick and therefore could not post. Posting no
> longer depends on the registry at all: an address geocodes at submit and pins, seeded
> or not. Gating a tenant on a list that is now only autocomplete would withhold a
> working feature for a reason that has stopped existing. **Never apply it.**

---

## 0. The production gap — measured, not assumed

**REVISED 2026-08-17. The previous version of this runbook named three migrations and
put the `dev` → `main` release first. Both were wrong.** The gap is **seven** files, two
of them predating this feature entirely, and the ordering was backwards in a way that
would have shipped a frontend against a database that cannot serve it. What follows is
the correction, with the evidence.

### Why the migration ledger cannot answer this

Production holds **205 rows** in `supabase_migrations.schema_migrations` against **211
files** in the repo, and the naive subtraction — "six unapplied" — is wrong three times
over:

1. **Versions are re-stamped.** Migrations reach prod through `apply_migration`, which
   stamps the apply time, not the filename. Prod's `max(version)` is `20260817021239`;
   the file it came from is `20260927000000_service_category_scope_search_path.sql`.
   Version order in prod is *apply* order, and it does not match filename order.
2. **The ledger contains duplicates.** 205 rows carry only **201 distinct names** —
   `dm_poll_votes_index_and_initplan`, `remote_schema`,
   `restore_message_realtime_publication` and `setup_photos_owner_select_for_cleanup`
   each appear twice. Three of those are the double-apply incident this doc already
   warns about under "Before you start". So the row count over-states what is applied.
3. **Names drift from filenames.** Eight ledger names have no matching file, mostly
   renames (`revoke_execute_reaudit_trigger_functions` is the file
   `20260914000000_revoke_reaudit_trigger_function_grants.sql`;
   `add_group_messages_metadata` is `20260818000000_group_messages_metadata.sql`), and
   two — `agent_activity_heartbeat`, `agent_activity_identity` — correspond to no file
   at all.

So the ledger is used below **only to narrow the candidate list**. Every entry is decided
by probing a live object, and the probe is what is recorded.

<!-- docs-drift-ignore: dm_poll_votes_index_and_initplan, remote_schema, restore_message_realtime_publication, setup_photos_owner_select_for_cleanup, revoke_execute_reaudit_trigger_functions, add_group_messages_metadata, agent_activity_heartbeat, agent_activity_identity — these are rows read out of production's supabase_migrations.schema_migrations on 2026-08-17, not repo identifiers. The whole point of the section above is that these names do NOT correspond one-to-one to files: four are duplicate applies, two are renames of files that carry different slugs, and two name no file at all. Resolving them to repo identifiers would delete the evidence. -->


### The gap, with a proving probe per entry

Candidates were the 17 repo slugs with no ledger name match; each was then probed against
`pg_catalog` / live data on prod, 2026-08-17. **Ten probed as applied** (the ledger had
simply renamed them) and are not listed. **Seven are genuinely absent:**

> **Every probe below was re-run read-only on 2026-08-17 (rehearsal pass) and every one
> still holds — same table, same column count, same policy body, same constraint list.**
> The ledger shape is also unchanged: still **205 rows / 201 distinct names**, still
> `max(version) = 20260817021239`. Nothing has been applied to prod since the gap was
> first measured, so the ordering constraints in §1a and §1b are still binding rather
> than historical.

| # | Migration | Live-object probe | Result on prod |
|---|---|---|---|
| 1 | `20260906000000_restore_dorm_reviews` | `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='student_reviews'` | **0** — table absent |
| 1b | *(same file)* | `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_dorm_reviews','get_dorm_review_stats')` | **0 of 2** — both RPCs absent |
| 1c | *(same file)* | `select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.content_reports'::regclass and conname='chk_content_type'` | **8 values, no `student_review`** — exactly what `20260825010000` leaves |
| 2 | `20260907000000_sublease_verified_lister_gate` | `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='can_post_sublease'` | **0** — function absent |
| 2b | *(same file)* | `select pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid='public.marketplace_listings'::regclass and polname='rls_marketplace_listings_insert'` | `(( SELECT auth.uid() AS uid) = user_id)` — **no `can_post_sublease` gate** |
| 3 | `20260928000000_sublease_building_registry` | `select count(*) from information_schema.columns where table_schema='public' and ((table_name='buildings' and column_name in ('kind','is_subleasable')) or (table_name='marketplace_listings' and column_name='building_id'))` | **0 of 3** — all three columns absent |
| 4 | `20260929000000_listing_building_tenant_consistency` | `select count(*) from pg_trigger where not tgisinternal and tgrelid='public.marketplace_listings'::regclass and tgname='trg_validate_listing_building_tenant'` | **0** — trigger absent |
| 6 | `20260806000000_rename_phase1only_to_limitedsurfaces` | `select slug, feature_flags from public.universities` | pitt = `{"phase1Only": false, …}`, **no `limitedSurfaces` key on any of the 3 tenants** — the backfill never ran |
| 7 | `20260820030000_drop_university_resources` | `select count(*) from pg_class … where relname='university_resources'` then `select count(*) from public.university_resources` | **table present, 29 rows** — the DROP never ran |

**Entries 6 and 7 are pre-existing holes in the middle of prod's history, not part of
this feature.** Note what they prove: the gap is *not* "everything after date X".
`20260822010000` and `20260822020000` both probed as **applied**, so `20260820030000`
sits in a hole with applied migrations on either side. Any future reasoning that treats
prod as "the repo up to some cutoff" is wrong.

### Additive or not — may the DB lead the app?

| Migration | Additive? | May the DB lead the deployed app? |
|---|---|---|
| `20260906000000` restore_dorm_reviews | **Yes** — new table, new RPCs, a widened CHECK, no drops | **Yes.** And the *app may not lead the DB* — see §1a. |
| `20260907000000` sublease_verified_lister_gate | **Yes in effect** — it replaces two RLS policies, but `coalesce(is_sublease,false) = false` short-circuits before `can_post_sublease()`, so item posting is untouched; prod holds **0** sublease rows today | **Yes.** |
| `20260928000000` sublease_building_registry | **Yes** — two nullable columns, one nullable FK column, two indexes, one column-level `GRANT SELECT`. No drops, no rewrites, no type changes | **Yes** — an older frontend never selects or writes `building_id`. **But it has a hard prerequisite; see §1b.** |
| `20260929000000` listing_building_tenant_consistency | **Yes** — one new trigger + function | **Yes** — the trigger only rejects a `building_id` whose tenant disagrees, and an older frontend never sets one. |
| `20261001000000` revoke_anon_execute_can_post_sublease | **Yes** — one `REVOKE` from `anon` plus assertions | **Yes.** Prod was already repaired in place on 2026-08-17; this makes a replay reproduce the repair. `authenticated` keeps EXECUTE, so no write path changes. |
| `20261002000000` buildings_marketplace_group_scope | **Yes** — widens one policy's `USING`, corrects one trigger function | **Yes** — it only ALLOWS more (a listing may now reference a building at a group peer). An older frontend never exercises the new arm. |
| `20260806000000` rename_phase1only_to_limitedsurfaces | **Yes** — adds a jsonb key beside the old one, never removes | **Yes.** Currently harmless either way: `sanitizeOverrides` still reads the legacy `phase1Only` key (`src/test/featureFlagOverrides.test.ts` pins this). It becomes required before that fallback is deleted. **Not part of this rollout.** |
| `20260820030000` drop_university_resources | **No — destructive.** `drop table … cascade` against a table holding **29 live rows** | **Not applicable.** No runtime code reads `university_resources` (only `src/integrations/supabase/types.ts` and a test fixture string), so the app is not blocking it — but dropping 29 rows is Ethan's call, needs the `db:preflight` backup check, and is **not part of this rollout.** |

---

## What is being rolled out

Phase 1 of subleases-on-a-map, which is **entirely absent from production**:

| Piece | Where |
|---|---|
| `student_reviews` + dorm-rating RPCs (**prerequisite, not sublease work**) | `20260906000000` |
| `can_post_sublease()` + the verified-lister RLS gate | `20260907000000` |
| `buildings.kind` / `is_subleasable`, `(university_id, name)` UNIQUE, `marketplace_listings.building_id` | `20260928000000` |
| Listing/building tenant-consistency trigger | `20260929000000` |
| `anon` loses EXECUTE on `can_post_sublease()` | `20261001000000` |
| Registry reads at marketplace-group range; the consistency trigger asks the group question | `20261002000000` |
| 40-row Pitt off-campus registry | `scripts/seed-sublease-buildings.mjs` |
| Building picker, browse/post gate split, empty-registry state, dorm ratings card | frontend, on `dev` |

Phase 2 — the map, the `/subleases` route, count-badge markers — is **not** in this
rollout and must not be started from it.

## Before you start

**Prod applies are NOT serialized in this project.** The ledger proves it: four names are
recorded twice, three of them from a single incident where two actors applied the same
migrations five minutes apart. There is no lock, no queue, and no advisory mechanism that
will stop it happening again. **Whoever runs this must be the only session touching prod
for its duration** — confirm no other Claude Code session, no CI job mid-apply, and no
open Supabase Studio SQL editor before step 1.

Also confirm `SUPABASE_ACCESS_TOKEN` is set: steps 3 and 4 of the migration gate need it,
and without it the gate fails rather than passing unverified.

**Apply with `apply_migration`, never `db push`.** `db push` reasons from the ledger, and
§0 is the demonstration that the ledger cannot be reasoned from here.

---

## 1. Apply the two prerequisites — BEFORE the release

```
20260906000000_restore_dorm_reviews.sql
20260907000000_sublease_verified_lister_gate.sql
```

**This step is new, and it is the correction to the previous revision, which put the
release first and never mentioned either file.**

### 1a. `20260906000000` must precede the `dev` → `main` release

`src/hooks/useDormReviews.ts` ships in the frontend on `dev`. It calls
`rpc('get_dorm_review_stats')`, `rpc('get_dorm_reviews')` and reads, upserts and deletes
`from('student_reviews')` — **none of which exist in production** (§0, entries 1/1b). It
is consumed by `DormRatingsCard`, which `OverviewTab.tsx:683` renders **unconditionally**
— no feature flag, no gate. Promote `dev` to `main` first and every dorm-portal Overview
tab in production starts calling three missing objects.

This migration is additive, so the database may lead the app by any amount. The app may
not lead the database at all. **Apply it first.**

### 1b. `20260907000000` is a hard prerequisite of `20260928000000`

`20260928000000` ends in a verification `DO` block (its §4) that raises unless **both**
`rls_marketplace_listings_insert` and `rls_marketplace_listings_update` have a `WITH
CHECK` containing `can_post_sublease`. Production's are:

```
rls_marketplace_listings_insert  →  (( SELECT auth.uid() AS uid) = user_id)
rls_marketplace_listings_update  →  ((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS (…is_admin…)))
```

Neither mentions `can_post_sublease`, because `20260907000000` — which creates that
function and rewrites both policies — has never been applied. **`20260928000000` applied
to production today raises `rls_marketplace_listings_insert no longer gates on
can_post_sublease()` and aborts.** The previous revision's step 2 was unrunnable as
written, and its post-apply probe 4d ("`can_post_sublease()` still gates both halves")
asserted a state production has never been in.

Both files are additive in effect (§0), so applying them ahead of the release is safe in
the only direction that matters.

---

## 2. Apply the two schema migrations

In filename order:

```
20260928000000_sublease_building_registry.sql
20260929000000_listing_building_tenant_consistency.sql
```

Each carries its own verification `DO` block and will fail the apply rather than
half-land:

- `…28` re-asserts that both halves of the sublease RLS gate still call
  `can_post_sublease()` — which is why step 1 is not optional.
- `…29` asserts `trg_set_university_id` sorts before the new trigger (otherwise it would
  read a null `university_id` and reject legitimate posts), and that no existing row
  already violates the invariant.

**Pre-check for the UNIQUE index in `…28`.** It creates
`buildings_university_id_name_key ON public.buildings (university_id, name)`.

> **RE-VERIFIED TWICE ON 2026-08-17 (second time in the rehearsal pass): prod has zero
> duplicate `(university_id, name)` rows across 269 `buildings` rows, so the index applies
> cleanly.** This is a claim about *data*, and data changes. **Re-verify immediately
> before running:**

```sql
SELECT university_id, name, count(*)
FROM public.buildings
GROUP BY 1, 2
HAVING count(*) > 1;
-- must return 0 rows
```

A non-empty result stops the apply: dedupe first, do not drop the index from the
migration.

**Two facts the rehearsal added, both read-only:**

- **All 269 `buildings` rows belong to Pitt** (`…001`); CMU and Carlow have zero. So the
  UNIQUE index is effectively single-tenant today, and §5's reversal trigger ("once CMU
  buildings are seeded") has nothing seeded behind it yet. 232 of the 269 carry
  coordinates; the 40 seeded rows all will.
- **`…29`'s trigger-ordering assertion will hold.** Postgres fires same-timing triggers in
  name order, and prod's live `marketplace_listings` trigger list starts
  `protect_listing_moderation_state, trg_force_insert_pre_moderation, …,
  trg_set_university_id, trg_sync_listing_post_type, …`. `trg_set_university_id` sorts
  before `trg_validate_listing_building_tenant` (`s` < `v`), so the new trigger reads a
  populated `university_id`. This is the assertion that would otherwise abort the apply
  after §1 had already landed.

---

## 3. Seed the 40-row Pitt registry

```bash
# 3a. DRY RUN FIRST — geocodes everything, prints every hit with its distance
#     from campus, writes nothing. This is the review step, not a convenience.
node scripts/seed-sublease-buildings.mjs --env .env

# 3b. only after the table above has been read
node scripts/seed-sublease-buildings.mjs --env .env --write --allow-remote
```

`.env` is the prod-pointing env file in this repo (`VITE_SUPABASE_URL` =
`https://abcdefghijklmnopqrst.supabase.co`) and carries both the **service role** key and
`VITE_MAPBOX_TOKEN`. `--allow-remote` is required because the script refuses to `--write`
to a non-loopback URL without it.

**The dry run against prod is provably write-free, and it does not need
`--allow-remote`.** The guard at `scripts/seed-sublease-buildings.mjs:108` gates only
`--write`; more to the point, `createClient()` is not reached at all without `--write` —
the function returns at the `if (!WRITE)` branch above it. A dry run therefore opens **no
database connection of any kind**, to prod or anywhere else. The `Target : … (REMOTE)`
banner it prints is echoing the env file, not a connection. It only calls Mapbox, 40
times. Do not add a flag to make a dry run "safe for remote"; it already is, and the flag
would blur the one line that is not.

**Rehearsal result, 2026-08-17, dry run pointed at the prod env file:**
**40 rows, 40 accepted, 0 rejected**, farthest 3.54 km (Dalzell Duplexes), then Ophelia
3.44, 6333 Walnut 3.32, Beechwood Duplexes 3.23, Highland Plaza 3.06. Identical to the
local run — which is expected, since geocoding never consults the database. Two pairs sit
within metres of each other by design and are not duplicates: Hudson Oakland (300 Craft)
vs The Oaks (306 Craft), and 414 vs 416 McKee Place.

**What the printed table is for, and what it cannot tell you.** Every one of the 40
resolved to the exact street address in
`scripts/data/sublease-buildings-pitt.json`, in Pittsburgh, in a 15213/15206/15217/15232
ZIP — so the Lancashire failure mode (an unresolvable query falling through to a global
best match) did not occur anywhere in this run, and the 30 km guard was never near firing.
What the table cannot prove is that the *address in the JSON* is the right address for the
*name* beside it — Mapbox will happily confirm a wrong building perfectly. The rows where
name and street do not echo each other are where that check has to be human: Royal York →
3955 Bigelow, Webster Hall → 101 N Dithridge, Camelot → 262 N Dithridge, Sherwood Towers →
230 N Craig, Chalfont → 4742 Centre, One On Centre → 4500 Centre, Cathedral Mansions →
4716 Ellsworth, The Admiral → 5615 Ellsworth, Ophelia → 141 Shady. Each row's `source`
field in the JSON is what backs it; a row without one is unverified.

**Read the geocode table before writing.** A coordinate here becomes a map pin in Phase
2, and a pin asserts location far more strongly than a text line does. Mapbox's
`proximity` is a ranking bias rather than a filter, so an unresolvable query returns the
best *global* match — that is how a CMU listing once geocoded to a village in Lancashire,
England (2026-08-06). The script's `MAX_CAMPUS_DISTANCE_KM = 30` guard catches the gross
cases; the printed distances are what catch the plausible ones.

Expect exactly the rehearsal numbers above. Anything else means the JSON changed or Mapbox
moved a pin, and it is a stop rather than a shrug. The upsert key is
`(university_id, name)` — the index from step 2 — so a re-run updates rather than
duplicates.

### 3c. Growing the registry from what students actually type

The composer no longer forces a pick (2026-08-17, reversing the strict picker the same
day it shipped): a student whose building is missing can type its name, and the listing
goes up **listed but never pinned** — `building_id` null, no latitude, no longitude, no
geocoding. That is the load-bearing half, and it is why the escape hatch does not reopen
the Lancashire failure.

The useful consequence is that **the typed names are a work queue, not just a gap.** A
live sublease with a `building_name` and no `building_id` is a student telling you which
building the registry is missing. Read it with:

```sql
-- Buildings students typed because the registry had no row for them.
-- Ordered by demand, so the next seeding pass starts with the most-asked-for.
SELECT l.building_name,
       count(*)                       AS listings,
       min(l.created_at)::date        AS first_seen,
       max(l.created_at)::date        AS last_seen
FROM public.marketplace_listings l
WHERE l.post_type = 'sublease'
  AND l.building_id IS NULL
  AND coalesce(btrim(l.building_name), '') <> ''
  AND l.university_id = '00000000-0000-4000-8000-000000000001'  -- pitt
GROUP BY l.building_name
ORDER BY listings DESC, last_seen DESC;
```

Deliberately **not** an admin UI, and deliberately not automated. Promoting one of these
rows means adding it to `scripts/data/sublease-buildings-pitt.json` with a `source`, then
re-running §3 — which geocodes it, prints its distance, and puts it through the same human
review every other row got. Auto-creating a registry row from a typed string would let a
student's typo become a map pin, which is precisely the thing the picker exists to prevent.

Note the query does **not** back-fill `building_id` on the old listing, and no future
version of it should: fuzzy-matching a typed string onto a freshly seeded row is a guess,
and migration `20260928000000` already refused that same guess for the pre-registry rows.
The student's next post picks the building properly; the old one stays honestly unmapped.

---

## 4. Release `dev` → `main`

**Steps 1–3 come first.** The cutover is currently pending: `dev` is well ahead of
`origin/main`, and production is running a frontend that has never heard of `building_id`
*or* `student_reviews`.

```bash
npm run release          # dry run — prints every gate's verdict, promotes nothing
npm run release -- --yes # promote
```

`npm run release` runs the full migration gate (`docs/release-gates.md`), which includes
steps 3 and 4 against production. That is the read-only Management API path and is
expected here — this runbook's "do not connect to prod" constraint applied to the
*preparing* sessions, not to the operator running it.

**Read the gate's step-3 output rather than skimming it.** For a migration prod has not
applied, step 3 does not block — it *prints the objects as the apply set*. That is
information, not a pass. If §0's entries 6 and 7 are still open they will appear there,
and neither belongs to this rollout.

---

## 5. `20260930000000` is CANCELLED — do not apply it, it no longer exists

The file is **deleted from the repo** as of 2026-08-18. This section is kept as a
tombstone rather than removed, because a runbook that silently loses a numbered step
reads like a transcription error to the next person following it.

It wrote `showPostSublease: false` for CMU and Carlow, on the reasoning that a tenant
with an unseeded building registry had nothing for a student to pick, so offering the
post button was offering a dead end. That reasoning was sound while the registry was the
only way to say where a sublease was. It is not the model any more: a student types an
address, it geocodes at submit, and the listing pins — with or without a registry row at
their school. The registry survives only as autocomplete inside the composer.

So the migration would now close a feature that works, at two live tenants, to protect
them from a gap that no longer bites. **Never apply it.** Nothing replaces it: CMU and
Carlow inherit the static `SHOW_POST_SUBLEASE` default like every other tenant, and the
browse/post split (`showPostSublease` vs `showBrowseSublease`) stays exactly as the code
already ships it.

> **2026-08-18 — the native clamp now covers POSTING only.** `resolveFeatureFlags` used to
> close both halves on `Capacitor.isNativePlatform()`; it now closes `showPostSublease`
> alone, so a native shell BROWSES subleases (nav row, `/subleases`, feed chip) and composes
> none. Ethan's explicit override of the 2026-08-05 clamp, taken with the build-31 rejection
> and App Store 5.1.1 / 3.1.5 rental scrutiny in front of him. Nothing in this rollout
> changes: the tenant-facing switch is still `showPostSublease` in `universities.feature_flags`,
> `showBrowseSublease` is still unoverridable, and `can_post_sublease()` is still the gate.
> Falsifying condition: a rejection citing rental or housing content restores
> `base.showBrowseSublease = false` in that one function.

---

## 6. Post-apply probes

Run all six. Record the outputs; a silent run is not a pass.

**6a. Security advisors.** `get_advisors(security)` on the prod project, diffed against
`docs/security/advisor-baseline.json` (380 accepted entries). Anything outside the
baseline blocks — fix it, or add its key *with a reason*.

Note this rollout adds **five** functions, not the one the previous revision named:
`public.can_post_sublease(uuid)` (`…07`), `public.validate_listing_building_tenant()`
(`…29`), and `get_dorm_reviews` / `get_dorm_review_stats` /
`student_reviews_set_updated_at` (`…06`). Locally the sublease pair trips neither of the
two rules it plausibly could — both pin `search_path`, the trigger function holds no
`authenticated`/`anon` EXECUTE, and `can_post_sublease` holds EXECUTE for `authenticated`
deliberately because the policies call it as the invoker. Check all five against the
baseline.

**6b. `student_reviews` is live** (proves step 1 landed).

```sql
SELECT to_regclass('public.student_reviews') AS tbl,           -- must be non-null
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('get_dorm_reviews','get_dorm_review_stats')) AS rpcs;  -- 2
```

**6c. 40 rows with coordinates.**

```sql
SELECT count(*) AS total,
       count(*) FILTER (WHERE lat IS NOT NULL AND lng IS NOT NULL) AS with_coords
FROM public.buildings
WHERE university_id = '00000000-0000-4000-8000-000000000001'
  AND is_subleasable;
-- expect total = 40, with_coords = 40
```

**6d. The trigger rejects a mismatched building.** Not by reading the trigger source — by
attempting the write. Pick any CMU building id (or insert a throwaway one) and any Pitt
listing, then:

```sql
UPDATE public.marketplace_listings
   SET building_id = '<a CMU building id>'
 WHERE id = '<a Pitt listing id>';
-- expect: ERROR, SQLSTATE 23514,
--   "building … belongs to university …002, but the listing belongs to university …001"
```

**23514, not 23503.** A foreign-key error would mean the trigger's `SECURITY DEFINER`
lookup came back empty — i.e. it was blinded by `buildings.tenant_isolation` and never
inspected the row — which is the way this probe goes green against a guard that does
nothing.

**6e. `can_post_sublease()` gates both halves.** Note the wording change: the previous
revision said "*still* gates", which presumed a state prod has never been in.

```sql
SELECT polname, pg_get_expr(polwithcheck, polrelid) LIKE '%can_post_sublease%' AS gates
FROM pg_policy
WHERE polrelid = 'public.marketplace_listings'::regclass
  AND polname IN ('rls_marketplace_listings_insert', 'rls_marketplace_listings_update');
-- both rows must be true; before step 1 both are FALSE (verified 2026-08-17)
```

That is the cheap catalog check and `20260928000000` runs the equivalent at apply time.
The *behavioural* proof — an unverified account refused on INSERT and unable to flip an
item into a sublease — is `supabase/tests/sublease_verified_lister_gate.test.sql`, which
runs locally in step 4's gate and cannot be run against prod.

**6f. `anon` cannot execute the lister gate.**

```sql
SELECT grantee,
       has_function_privilege(grantee, 'public.can_post_sublease(uuid)', 'EXECUTE')
  FROM (VALUES ('anon'), ('authenticated')) AS r(grantee);
-- expect: anon → false, authenticated → true
```

The `authenticated` row is half the assertion, not decoration: the INSERT and UPDATE
policies call this function as the invoker, so revoking it there would deny every
marketplace write, not just sublease writes.

**6g. No tenant carries a `showPostSublease` override.**

```sql
SELECT count(*) FROM public.universities WHERE feature_flags ? 'showPostSublease';
-- expect: 0
```

`20260930000000` is cancelled (§5) and nothing else writes this key, so a non-zero count
means someone applied it anyway — CMU and Carlow would be silently unable to post.

**6h. Then, in the deployed app as a CMU account:** post a sublease at an Oakland address
that is NOT in the registry. It must post and pin. Sublease chips must be present in both
the post-type picker and the feed filter row.

---

## 7. The run order, as one list

Every command a later session runs, in order. Sections above hold the reasoning; this is
the sequence, so nobody reconstructs it under time pressure. **Steps 0–3 are read-only and
may be run at any time. Nothing below the gate may be run until Ethan says so.**

```
─── read-only, safe to run now ────────────────────────────────────────────────
 0.  npm run agent:sessions              # confirm you are the only session on prod
     echo "$SUPABASE_ACCESS_TOKEN"       # must be non-empty (gate steps 3+4 need it)
 1.  re-run the §0 probe set             # read-only SELECT, Management API
 2.  re-run the §2 duplicate pre-check   # must return 0 rows
 3.  node scripts/seed-sublease-buildings.mjs --env .env
                                         # dry run; no DB connection; read the table

════ APPROVAL GATE — Ethan green-lights the rollout. Nothing past this line ════
════ runs without it. As of 2026-08-17 the answer is "not yet, dev only."   ════

─── writes to production, in this order and no other ──────────────────────────
 4.  apply_migration  20260906000000_restore_dorm_reviews.sql          # §1a
 5.  apply_migration  20260907000000_sublease_verified_lister_gate.sql # §1b
 6.  apply_migration  20260928000000_sublease_building_registry.sql    # needs 5
 7.  apply_migration  20260929000000_listing_building_tenant_consistency.sql
 8.  apply_migration  20261001000000_revoke_anon_execute_can_post_sublease.sql
 9.  apply_migration  20261002000000_buildings_marketplace_group_scope.sql   # needs 7
10.  node scripts/seed-sublease-buildings.mjs --env .env --write --allow-remote
11.  npm run release                     # dry run — promotes nothing, read step 3's output
12.  npm run release -- --yes            # dev → main; Vercel deploys web from main
13.  run all six §6 probes and record the outputs
14.  one line to docs/CHANGELOG.md, one to docs/DECISIONS.md, refresh this runbook
```

**The three orderings that are not stylistic.** 4 before 12 (the deployed frontend calls
`student_reviews`, §1a). 5 before 6 (`…28`'s verification block raises without
`can_post_sublease`, §1b). 7 before 9 (`…02` replaces the trigger function `…29` creates;
run the other way round, the CREATE OR REPLACE is overwritten by the older body and the
group arm silently disappears). Everything else is convenience.

**The seed is no longer a prerequisite for anything.** Step 10 populates autocomplete and
nothing more — a student at a tenant with an empty registry types their address and pins
exactly the same. Skipping or deferring it degrades a convenience, not the feature.

**Not in this list, deliberately:** `20260930000000` (**cancelled and deleted** — §5),
`20260806000000`, `20260820030000` (§0 entries 6 and 7 — unrelated pre-existing holes, and
the second is a destructive drop over 29 live rows needing `npm run db:preflight`), and
`supabase config push`.

---

## Rollback levers

Reverse order of application. None of them needs the others.

```sql
-- 20261002000000 — narrow the registry back to own-school, and restore the
-- own-school trigger predicate from 20260929000000. Note this re-forbids the
-- product case (a CMU listing on a Pitt-seeded Oakland building), so it is a
-- rollback of last resort, not a tidy-up.
ALTER POLICY tenant_isolation ON public.buildings
  USING ((university_id = public.current_university_id()) OR public.is_superadmin())
  WITH CHECK ((university_id = public.current_university_id()) OR public.is_superadmin());

-- 20261001000000 — there is NO rollback lever, deliberately. Re-granting `anon`
-- EXECUTE on can_post_sublease(uuid) would reopen an unauthenticated read over
-- auth.users. If something downstream breaks, fix the caller.

-- 20260929000000 — drop the tenant-consistency guard
DROP TRIGGER IF EXISTS trg_validate_listing_building_tenant ON public.marketplace_listings;
DROP FUNCTION IF EXISTS public.validate_listing_building_tenant();

-- 20260928000000 — full schema rollback (destructive; drops picked buildings from listings)
ALTER TABLE public.marketplace_listings DROP COLUMN building_id;
DROP INDEX IF EXISTS public.idx_buildings_subleasable;
DROP INDEX IF EXISTS public.buildings_university_id_name_key;
ALTER TABLE public.buildings DROP COLUMN is_subleasable, DROP COLUMN kind;
```

**`20260907000000` has no one-line lever, and that is not an omission.** The policies it
replaces were built by `20260101` (insert) and `20260709044443` (update); reinstate them
from those files. Do **not** simply `DROP POLICY` — that leaves `marketplace_listings`
with no INSERT policy at all and RLS denying every post, which is worse than the gate.

**`20260906000000` has no rollback lever on purpose.** Dropping `student_reviews` would
destroy user-authored ratings, and once step 4 has shipped the deployed frontend requires
it. If it must come out, that is a data-retention decision, not a revert.

Removing the `showPostSublease` key rather than setting it `true` is deliberate: it
returns the tenant to the static default, which is where Pitt already sits. This is also
the reversal to run once CMU buildings are seeded — the gate is temporary, not a product
decision.

**A revert gets documented, not just performed.** If you pull any lever here, record it in
`docs/DECISIONS.md` in the same pass, or the next session re-does the thing you undid.

---

## What this rollout does NOT do

- **It does not close `20260806000000` or `20260820030000`** (§0 entries 6 and 7). They
  are unrelated pre-existing holes. `20260806000000` is additive and currently inert;
  `20260820030000` is a destructive `drop table … cascade` over 29 live rows and needs
  its own decision plus a `db:preflight` backup check. Both are named here so the next
  reader does not
  rediscover them as a surprise mid-release.
- **No `supabase config push`.** Nothing here touches project config.
- **No Phase 2.** No map, no `/subleases` route, no markers.
- **No backfill of `building_name` → `building_id`.** Pre-2026-09 subleases keep their
  free-text building and stay unpinnable, deliberately: fuzzy-matching an old string onto
  a registry row turns a wrong guess into a wrong pin.
- **No CMU/Carlow building registry.** Seeding one is the reversal trigger for step
  `…30`, and is its own piece of work.
