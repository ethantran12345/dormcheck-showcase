-- Mechanism prep for clearing 3 of the 5 `security_definer_view` advisor
-- ERRORs (lint 0010) without changing any user-visible behavior:
-- seller_rating_stats, marketplace_listings_contact, roommate_search_posts_contact.
-- (public_profiles and roommate_profiles stay definer for now: they are
-- PostgREST embed targets, and PostgREST only resolves view-of-view embed
-- lineage through views in API-exposed schemas — the wrapper mechanism breaks
-- their embeds. See the prod runbook in docs/tasks/ for the end-state plan.)
--
-- The lint flags definer-style views only in API-exposed schemas
-- (pgrst.db_schemas, i.e. `public`). Each converted view's body moves verbatim
-- into this non-exposed `private` schema (still definer-style: it holds the
-- deliberate cross-user / column-masking access logic, same trust model as the
-- accepted definer-RPC WARN class), and the public view becomes a thin
-- `security_invoker = true` wrapper over it. PostgREST never exposes `private`
-- (not in db_schemas), so the definer surface is no longer directly
-- API-reachable; the public wrappers keep their existing grants, names, and
-- columns.
--
-- Rollback: drop the private views (each view migration notes its own rollback)
-- then `drop schema private;`.

create schema if not exists private;

revoke all on schema private from public;
-- USAGE (not CREATE) so the invoker wrappers in `public` can traverse into the
-- schema on behalf of the querying role. anon is included to mirror the
-- existing grant posture on the anon-SELECTable public views (logged-out
-- behavior is unchanged either way — see the per-view migration notes).
grant usage on schema private to authenticated, anon;
