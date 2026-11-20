# Migration history divergence — prod vs repo (2026-08-02)

<!-- docs-drift-ignore: agent_activity_heartbeat, agent_activity_identity, harden_original_price_search_path, agent_activity_at_idx, amazon_products_provider_agnostic_columns, add_group_messages_metadata, function_search_path_hardening, marketplace_listings_maintain_original_price — these are PROD migration and object names read out of supabase_migrations.schema_migrations. That several of them resolve to nothing in this repo is not a stale reference; it is the finding this document exists to record. Check 1 flagging them is the guard agreeing with the write-up. -->


**Status: read-only picture. Nothing was repaired.** This documents what diverged and why, so
the repair can be decided deliberately.

## Method

`list_migrations` on project `abcdefghijklmnopqrst` (178 rows in
`supabase_migrations.schema_migrations`) reconciled against the 179 files in
`supabase/migrations/` — matched **by name, not by version stamp**, because the stamp is
exactly what drifted. Where a prod row carried a full filename as its `name`
(`20260710120000_master_housing_data_hygiene`), the leading stamp was normalized off before
comparing. Ambiguous cases were confirmed by reading `statements` out of
`supabase_migrations.schema_migrations` directly.

## The headline

| Bucket | Count | Schema risk |
|---|---:|---|
| Exact match (version **and** name) | 141 | none |
| Applied, but under a **different version stamp** | 30 | none to the schema; breaks the ledger |
| Applied, but under a **different name** | 3 | none |
| In repo, **never applied** to prod | 5 | pending work, expected |
| In prod, file exists only in an unshipped lane | 1 | resolves when that lane ships |
| **In prod, no file has ever existed in git** | **3** | **real — prod is not reproducible from the repo** |

## Why the 30 diverged: `apply_migration` restamps, it does not adopt

This is not a reporting quirk, but it is also not schema drift. Every one of the 30 is
**present and applied in prod with identical content**; only the ledger key differs.

The mechanism is the Supabase MCP `apply_migration` tool. It records `version` as the **wall
clock at the moment of application** and `name` as the descriptive name it was handed. It never
reads the version prefix off the repo filename, because it never sees the file. So a migration
authored as `20260901000003_security_backup_code_mint_and_private_views.sql` and applied at
15:31 UTC on 2026-08-02 lands in prod as version `20260802153102`.

The repo's own convention makes this loud. Filenames are **sequence-encoded, not timestamps** —
the current batch runs from `20260816000000` to `20260901000005`, dates two weeks to a month in
the future. Prod's stamps for those same migrations are the real application times, 2026-07-20
through 2026-08-02. So the drift reads as roughly a month, and always in the same direction:

```
repo 20260816000000 community_phase1                        -> prod 20260720032603
repo 20260901000003 security_backup_code_mint_and_private…  -> prod 20260802153102
repo 20260901000005 security_alert_fanout_and_backup_code…  -> prod 20260802160116
```

Five older ones (`20260719120000`–`20260721000001`) drift by hours rather than weeks — same
mechanism, just authored and applied the same day.

**The consequence that matters:** any tool that keys off `version` — notably `supabase db push`
— sees 30 migrations prod has never run, and will try to run them again. They are largely
idempotent (`if not exists`, `drop … if exists`, `create or replace`), which is why this has
stayed invisible. It is not guaranteed. This is the concrete reason
`.claude/rules/supabase-backend.md` says `apply_migration`, never `db push`: the ban is not
stylistic, it is the only thing standing between this ledger and a replay.

`db:preflight` already models this correctly — it reports these 30 as "unmatched / possibly
MCP-applied" and gates them rather than silently treating them as pending.

## The 3 name-only variants (benign, confirmed by content)

Same version stamp or same content, cosmetically different name:

| Repo file | Prod row |
|---|---|
| `20260712020956_push_broadcasts_university_audience.sql` | `20260712020956` name `20260729030000_broadcast_audience_university` |
| `20260715224350_amazon_products_provider_agnostic.sql` | `20260715224350` name `amazon_products_provider_agnostic_columns` |
| `20260818000000_group_messages_metadata.sql` | `20260720061602` name `add_group_messages_metadata` |

Statements were read from prod for all three and match the repo files. Nothing to do beyond
being aware the name is not a reliable join key either.

## The 5 genuinely pending (expected, not divergence)

```
20260721000000_apply_class_a_tenant_isolation.sql
20260820020000_storage_buckets_baseline.sql
20260820030000_drop_university_resources.sql     <- the batch's only real destructive statement
20260822010000_harden_templates_bucket.sql
20260822020000_wrap_marketplace_alerts_authuid.sql
```

`20260820030000` is the `drop table … cascade` that `db:preflight` correctly gates on a fresh
backup. Three of these five currently live only in the `lane/security-regression` worktree.

## The 3 that actually matter: prod DDL with no file, ever

These exist in prod and **no file for them has ever been committed on any branch**
(`git log --all --diff-filter=AD` returns nothing). They were applied straight through
`apply_migration` with no repo artifact. A clean rebuild from `supabase/migrations/` would not
reproduce prod.

| Prod version | Name | What it did |
|---|---|---|
| `20260719001732` | `agent_activity_heartbeat` | creates `public.agent_activity` (identity PK, `session_label`, `tool`, `detail`, `at`), enables RLS with **no policies** (service-role only), adds `agent_activity_at_idx` |
| `20260719021313` | `agent_activity_identity` | adds `branch`, `agent_name` to `public.agent_activity` |
| `20260720072218` | `harden_original_price_search_path` | `ALTER FUNCTION public.marketplace_listings_maintain_original_price() SET search_path = public` |

Notes:

- The two `agent_activity` ones are **agent tooling infrastructure**, not product schema — the
  table backs the `npm run agent:claim` / heartbeat machinery. Low product risk, but it is a
  real RLS-enabled public table that `types.ts` and every audit doc are blind to.
- `harden_original_price_search_path` is a one-line security hardening that explicitly says it
  is matching `function_search_path_hardening`'s convention. Its sibling migrations are all in
  the repo; this one is not. A rebuild silently drops a `search_path` pin, which is the exact
  class of hole the advisor flags.

A fourth prod-only row, `20260802164953 security_group_dorm_rankings_write_scope`, is **not** in
this category: the file exists as `20260901000006_…` in the unshipped `lane/security-regression`
worktree. It was applied to prod before the lane shipped. It resolves itself when that lane
merges — and it is a clean illustration of how the other three probably happened.

## Root cause, stated plainly

Two independent things compound:

1. **`apply_migration` is the sanctioned path and it does not preserve the repo's version.**
   Every correct, rule-following apply widens the ledger gap. 30 rows is not 30 mistakes; it is
   the tool working as designed against a filename convention it never sees.
2. **Nothing enforces "file committed before apply."** Applying is a live MCP call; committing
   is a separate human/agent step that can be skipped, deferred behind a lane, or forgotten.
   Three times it was forgotten outright, and once (today) it is merely pending a lane ship.

## Asserted mappings — the name-join check, built (2026-09-07)

The "teach a check to join on name" option above shipped in a stricter form than a name join:
**`supabase/registry/prod-ledger-map.json`** holds `repo file → {prodVersion, prodName}` and is written
only by **`npm run ledger:record -- <file> <prodVersion>`**, which refuses any mapping the live ledger
does not confirm (a row with that version must exist AND be named for that file; a file maps to one
row; a row is claimed by one file). `db:preflight` and `gate:migrations` treat a mapped file as
applied **only while prod still holds that version** — the map asserts, the ledger decides, so a
restored backup or a reset branch turns the file pending again rather than silently "applied".
Plain name matching stays presentation-only for exactly the reason given in `nameMatched()`:
`remote_schema` is in prod twice. The first five rows are the 2026-09-07 applies
(`docs/audits/prod-apply-2026-09-07.md` §1); the 30 historical restamps above are not mapped —
each would need the same confirmation, one `ledger:record` call per file, and that is a deliberate
follow-up, not a bulk import. `npm run ledger:record -- --verify` is the recurring check.

## Not done here, deliberately

No repair. For the record, the options this picture opens up — to be decided, not assumed:

- **Backfill the 3 orphans** as repo files whose content is the `statements` already recorded in
  prod, stamped to match prod's version so the ledger and the tree agree.
- **Reconcile the 30 stamps**, either by renaming repo files to prod's stamps or by teaching a
  check to join on name. Renaming 30 files is churn and would scramble the sequence-encoded
  ordering the repo deliberately uses; a name-join check is cheaper.
- **Add a guard** that fails when prod holds a migration name with no corresponding repo file —
  which is the check that would have caught all three orphans within a day.

None of these should happen while `lane/security-regression` is live and holds four of the
relevant files.
