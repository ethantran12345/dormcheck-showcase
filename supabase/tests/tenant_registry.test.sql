-- Tenant-classification registry audit (multi-tenancy enforced-by-default).
-- Every BASE TABLE in `public` must appear in supabase/registry/table-classification.json
-- with the scoping mechanism its class promises actually present in pg catalogs.
-- Run via scripts/test-db.sh (npm run test:db), which injects the registry JSON as the
-- psql variable `registry`:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -v registry="$(cat supabase/registry/table-classification.json)" \
--     -f supabase/tests/tenant_registry.test.sql
--
-- TRANSITIVE-PATTERN DEPENDENCY (do not break): class-B children are safe only because the
-- EXISTS(<parent>) subquery in their policy is itself subject to the parent's RLS. If a parent
-- ever gets RLS disabled, or the tenant filter moves into a SECURITY DEFINER function that
-- bypasses RLS, every child silently opens. The "B-parent RLS enforced" assertion below guards
-- exactly that.

BEGIN;

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);

CREATE OR REPLACE FUNCTION _assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO test_results VALUES (label, cond, detail);
  IF NOT cond THEN
    RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE
    RAISE NOTICE 'PASS: %', label;
  END IF;
END;
$$;

-- ── Load registry ────────────────────────────────────────────────────────────
CREATE TEMP TABLE registry AS
SELECT key AS table_name,
       value->>'class'     AS class,
       value->>'parent'    AS parent,
       -- Optional: name of a SECURITY DEFINER helper that resolves this table's
       -- parent tenant (e.g. profile_university). A class B policy may satisfy
       -- the "references its parent" rule through this helper INSTEAD of naming
       -- the parent table. See the note on the class B policy assertion below.
       value->>'parent_helper' AS parent_helper,
       value->>'mechanism' AS mechanism,
       value->>'reason'    AS reason
FROM jsonb_each((:'registry')::jsonb->'tables');

SELECT _assert('registry loads and is non-trivial',
  (SELECT count(*) FROM registry) >= 50,
  'rows: ' || (SELECT count(*) FROM registry));

-- ── Actual schema ────────────────────────────────────────────────────────────
CREATE TEMP TABLE actual_tables AS
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public' AND c.relkind = 'r';

-- 1. Completeness both directions.
SELECT _assert('every public table is registered',
  NOT EXISTS (SELECT 1 FROM actual_tables a LEFT JOIN registry r USING (table_name) WHERE r.table_name IS NULL),
  'unregistered: ' || coalesce((SELECT string_agg(a.table_name, ', ')
     FROM actual_tables a LEFT JOIN registry r USING (table_name) WHERE r.table_name IS NULL), 'none')
  || ' — add an entry to supabase/registry/table-classification.json (pick a class per docs/multi-university.md)');

SELECT _assert('every registry entry matches an existing table',
  NOT EXISTS (SELECT 1 FROM registry r LEFT JOIN actual_tables a USING (table_name) WHERE a.table_name IS NULL),
  'stale: ' || coalesce((SELECT string_agg(r.table_name, ', ')
     FROM registry r LEFT JOIN actual_tables a USING (table_name) WHERE a.table_name IS NULL), 'none'));

SELECT _assert('every registered class is valid',
  NOT EXISTS (SELECT 1 FROM registry WHERE class NOT IN ('A','B','C','D','E','F')),
  coalesce((SELECT string_agg(table_name || '=' || class, ', ') FROM registry
            WHERE class NOT IN ('A','B','C','D','E','F')), ''));

-- 2. RLS enabled everywhere (default-deny beats an open table; policy-less RLS is fine).
SELECT _assert('RLS is enabled on every public table',
  NOT EXISTS (SELECT 1 FROM actual_tables WHERE NOT rls_enabled),
  coalesce((SELECT string_agg(table_name, ', ') FROM actual_tables WHERE NOT rls_enabled), ''));

-- ── Per-class mechanism assertions ───────────────────────────────────────────

-- A: university_id column + RESTRICTIVE tenant_isolation policy on current_university_id().
SELECT _assert('class A: university_id column present',
  NOT EXISTS (
    SELECT 1 FROM registry r WHERE r.class = 'A' AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = r.table_name AND c.column_name = 'university_id')),
  coalesce((SELECT string_agg(r.table_name, ', ') FROM registry r WHERE r.class = 'A' AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = r.table_name AND c.column_name = 'university_id')), ''));

SELECT _assert('class A: RESTRICTIVE tenant_isolation policy on current_university_id()',
  NOT EXISTS (
    SELECT 1 FROM registry r WHERE r.class = 'A' AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = r.table_name
        AND p.policyname = 'tenant_isolation' AND p.permissive = 'RESTRICTIVE'
        AND p.qual LIKE '%current_university_id()%')),
  coalesce((SELECT string_agg(r.table_name, ', ') FROM registry r WHERE r.class = 'A' AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = r.table_name
        AND p.policyname = 'tenant_isolation' AND p.permissive = 'RESTRICTIVE'
        AND p.qual LIKE '%current_university_id()%')), ''));

-- B: declared parent + RESTRICTIVE tenant_isolation policy referencing that parent.
SELECT _assert('class B: parent declared and registered as scoped (A/B/C)',
  NOT EXISTS (
    SELECT 1 FROM registry r WHERE r.class = 'B' AND (
      r.parent IS NULL OR NOT EXISTS (
        SELECT 1 FROM registry pr WHERE pr.table_name = r.parent AND pr.class IN ('A','B','C')))),
  coalesce((SELECT string_agg(r.table_name, ', ') FROM registry r WHERE r.class = 'B' AND (
      r.parent IS NULL OR NOT EXISTS (
        SELECT 1 FROM registry pr WHERE pr.table_name = r.parent AND pr.class IN ('A','B','C')))), ''));

-- A class B policy may reach its parent EITHER by naming the parent table (the
-- inline-EXISTS shape) OR through a declared SECURITY DEFINER parent_helper.
-- The helper form is not a weaker variant — it is the CORRECT one when the
-- parent is `profiles`: an inline `EXISTS (SELECT 1 FROM profiles ...)` inside a
-- policy is evaluated as the INVOKER, so it inherits profiles' own-row-only RLS
-- and is false for every user except yourself (2026-08-02, seller_ratings).
-- Requiring the parent's NAME in the qual therefore rewarded the broken shape.
-- A helper counts only if it is genuinely SECURITY DEFINER — asserted below.
SELECT _assert('class B: RESTRICTIVE tenant_isolation policy referencing the declared parent (or its parent_helper)',
  NOT EXISTS (
    SELECT 1 FROM registry r WHERE r.class = 'B' AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = r.table_name
        AND p.policyname = 'tenant_isolation' AND p.permissive = 'RESTRICTIVE'
        AND (p.qual LIKE '%' || r.parent || '%'
             OR (r.parent_helper IS NOT NULL AND p.qual LIKE '%' || r.parent_helper || '%')))),
  coalesce((SELECT string_agg(r.table_name, ', ') FROM registry r WHERE r.class = 'B' AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = r.table_name
        AND p.policyname = 'tenant_isolation' AND p.permissive = 'RESTRICTIVE'
        AND (p.qual LIKE '%' || r.parent || '%'
             OR (r.parent_helper IS NOT NULL AND p.qual LIKE '%' || r.parent_helper || '%')))), ''));

-- A declared parent_helper must exist AND be SECURITY DEFINER, or it provides
-- none of the RLS-bypass the exemption above assumes.
SELECT _assert('class B: every declared parent_helper is a SECURITY DEFINER function',
  NOT EXISTS (
    SELECT 1 FROM registry r WHERE r.parent_helper IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
      WHERE n.nspname = 'public' AND pr.proname = r.parent_helper AND pr.prosecdef)),
  coalesce((SELECT string_agg(r.table_name || '→' || r.parent_helper, ', ') FROM registry r
    WHERE r.parent_helper IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
      WHERE n.nspname = 'public' AND pr.proname = r.parent_helper AND pr.prosecdef)), ''));

-- B transitive guard: every declared parent must itself have RLS enforced.
SELECT _assert('class B: every declared parent has RLS enabled (transitive pattern intact)',
  NOT EXISTS (
    SELECT 1 FROM (SELECT DISTINCT parent FROM registry WHERE class = 'B') bp
    LEFT JOIN actual_tables a ON a.table_name = bp.parent
    WHERE a.table_name IS NULL OR NOT a.rls_enabled),
  coalesce((SELECT string_agg(bp.parent, ', ')
    FROM (SELECT DISTINCT parent FROM registry WHERE class = 'B') bp
    LEFT JOIN actual_tables a ON a.table_name = bp.parent
    WHERE a.table_name IS NULL OR NOT a.rls_enabled), ''));

-- C: ownership — at least one policy qual/with_check referencing auth.uid().
SELECT _assert('class C: at least one policy references auth.uid()',
  NOT EXISTS (
    SELECT 1 FROM registry r WHERE r.class = 'C' AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = r.table_name
        AND (p.qual LIKE '%auth.uid()%' OR p.with_check LIKE '%auth.uid()%'))),
  coalesce((SELECT string_agg(r.table_name, ', ') FROM registry r WHERE r.class = 'C' AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = r.table_name
        AND (p.qual LIKE '%auth.uid()%' OR p.with_check LIKE '%auth.uid()%'))), ''));

-- D confined: RESTRICTIVE tenant_confined INSERT policy present.
SELECT _assert('class D (confined): RESTRICTIVE tenant_confined INSERT policy present',
  NOT EXISTS (
    SELECT 1 FROM registry r WHERE r.class = 'D' AND r.mechanism = 'confined' AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = r.table_name
        AND p.policyname = 'tenant_confined' AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'INSERT')),
  coalesce((SELECT string_agg(r.table_name, ', ') FROM registry r
    WHERE r.class = 'D' AND r.mechanism = 'confined' AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = r.table_name
        AND p.policyname = 'tenant_confined' AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'INSERT')), ''));

-- D membership / E / F: exemption must be explicit and justified.
SELECT _assert('class D (membership) / E / F: explicit reason present',
  NOT EXISTS (
    SELECT 1 FROM registry r
    WHERE ((r.class = 'D' AND coalesce(r.mechanism,'') <> 'confined') OR r.class IN ('E','F'))
      AND coalesce(r.reason, '') = ''),
  coalesce((SELECT string_agg(r.table_name, ', ') FROM registry r
    WHERE ((r.class = 'D' AND coalesce(r.mechanism,'') <> 'confined') OR r.class IN ('E','F'))
      AND coalesce(r.reason, '') = ''), ''));

SELECT _assert('class D: mechanism declared (confined|membership)',
  NOT EXISTS (SELECT 1 FROM registry WHERE class = 'D' AND coalesce(mechanism,'') NOT IN ('confined','membership')),
  coalesce((SELECT string_agg(table_name, ', ') FROM registry
            WHERE class = 'D' AND coalesce(mechanism,'') NOT IN ('confined','membership')), ''));

-- Class F, mechanism=superadmin: every PRIVILEGED policy (SELECT/UPDATE/DELETE
-- and any non-reporter INSERT) must gate on is_superadmin() in its USING or
-- WITH CHECK. This is the systemic guard for the 2026-08-01 finding —
-- content_reports/moderation_actions policies gated on profiles.is_admin, which
-- is true for university_admin too, silently exposing every school's reports
-- cross-tenant. The ordinary-user reporter INSERT (auth.uid() = reporter_id) is
-- excluded: filing a report is not a privileged action. A privileged policy
-- that references is_admin but not is_superadmin fails here.
SELECT _assert('class F superadmin tables: privileged policies reference is_superadmin()',
  NOT EXISTS (
    SELECT 1 FROM registry r
    JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = r.table_name
    WHERE r.class = 'F' AND coalesce(r.mechanism,'') = 'superadmin'
      AND p.policyname NOT LIKE '%_insert'
      AND coalesce(p.qual,'') || ' ' || coalesce(p.with_check,'') NOT LIKE '%is_superadmin%'),
  coalesce((SELECT string_agg(r.table_name || '.' || p.policyname, ', ')
    FROM registry r
    JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = r.table_name
    WHERE r.class = 'F' AND coalesce(r.mechanism,'') = 'superadmin'
      AND p.policyname NOT LIKE '%_insert'
      AND coalesce(p.qual,'') || ' ' || coalesce(p.with_check,'') NOT LIKE '%is_superadmin%'), ''));

-- Tenant helper functions the policies depend on must exist.
SELECT _assert('tenant helper functions exist (current_university_id, is_superadmin)',
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname IN ('current_university_id','is_superadmin')) = 2);

-- ── Summary / hard fail ──────────────────────────────────────────────────────
DO $$
DECLARE failed int;
BEGIN
  SELECT count(*) INTO failed FROM test_results WHERE NOT pass;
  RAISE NOTICE 'tenant_registry: % assertions, % failed',
    (SELECT count(*) FROM test_results), failed;
  IF failed > 0 THEN
    RAISE EXCEPTION 'tenant_registry FAILED: % assertion(s) — see FAIL notices above', failed;
  END IF;
END $$;

ROLLBACK;
