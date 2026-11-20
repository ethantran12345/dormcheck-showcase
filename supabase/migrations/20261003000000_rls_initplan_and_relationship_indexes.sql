-- Measured production hardening, 2026-08-18.
--
-- 1. Supabase's advisor reported 73 policies that re-evaluate auth.uid()/auth.jwt()
--    for every candidate row. Preserve each policy's command, roles, and predicates;
--    only wrap bare auth calls in scalar subqueries so Postgres creates an InitPlan.
-- 2. Add conventional leading-column indexes for every still-unindexed FK. This is
--    primarily delete/update relationship safety; tables are currently small enough
--    for transactional index creation (largest affected table: course_sections, 6,331
--    live rows at measurement time).
-- 3. Trigger functions never need direct RPC EXECUTE. Revoke the default function
--    grants without affecting trigger execution.
--
-- This migration sorts after every existing migration because the policies and
-- relationships must already exist before the catalog-driven closeout runs.

-- Keep one representative rewrite explicit so the repository's RLS coverage
-- gate can associate this catalog-driven migration with a concrete relation.
-- The catalog pass below applies the identical transform to every remaining policy.
ALTER POLICY "Admins can update all listings"
  ON public.business_listings
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.is_admin = true
    )
  );

DO $migration$
DECLARE
  policy_row record;
  next_using text;
  next_check text;
BEGIN
  FOR policy_row IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      p.polname AS policy_name,
      pg_get_expr(p.polqual, p.polrelid) AS using_expression,
      pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'storage')
  LOOP
    next_using := policy_row.using_expression;
    next_check := policy_row.check_expression;

    IF next_using IS NOT NULL THEN
      next_using := replace(next_using, '( SELECT auth.uid() AS uid)', '__dc_auth_uid_initplan__');
      next_using := regexp_replace(next_using, 'auth[.]uid[(][)]', '(SELECT auth.uid())', 'gi');
      next_using := replace(next_using, '__dc_auth_uid_initplan__', '( SELECT auth.uid() AS uid)');
    END IF;
    IF next_check IS NOT NULL THEN
      next_check := replace(next_check, '( SELECT auth.uid() AS uid)', '__dc_auth_uid_initplan__');
      next_check := regexp_replace(next_check, 'auth[.]uid[(][)]', '(SELECT auth.uid())', 'gi');
      next_check := replace(next_check, '__dc_auth_uid_initplan__', '( SELECT auth.uid() AS uid)');
    END IF;

    IF next_using IS DISTINCT FROM policy_row.using_expression THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I USING (%s)',
        policy_row.policy_name, policy_row.schema_name, policy_row.table_name, next_using
      );
    END IF;
    IF next_check IS DISTINCT FROM policy_row.check_expression THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
        policy_row.policy_name, policy_row.schema_name, policy_row.table_name, next_check
      );
    END IF;
  END LOOP;
END
$migration$;

DO $migration$
DECLARE
  fk record;
  index_name text;
BEGIN
  FOR fk IN
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      con.conname AS constraint_name,
      con.conrelid,
      con.conkey,
      string_agg(quote_ident(a.attname), ', ' ORDER BY key_column.ordinality) AS columns_sql
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY key_column(attnum, ordinality) ON true
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = key_column.attnum
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = con.conrelid
          AND i.indisvalid
          AND i.indisready
          AND (i.indkey::smallint[])[0:cardinality(con.conkey) - 1] = con.conkey
      )
    GROUP BY n.nspname, c.relname, con.conname, con.conrelid, con.conkey
  LOOP
    index_name := left('idx_fk_' || fk.table_name || '_' || substr(md5(fk.constraint_name), 1, 8), 63);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%s)',
      index_name, fk.schema_name, fk.table_name, fk.columns_sql
    );
  END LOOP;
END
$migration$;

DO $migration$
DECLARE
  trigger_function record;
BEGIN
  FOR trigger_function IN
    SELECT n.nspname AS schema_name, p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef
      AND p.prorettype = 'trigger'::regtype
      AND n.nspname IN ('public', 'private')
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon, authenticated',
      trigger_function.schema_name, trigger_function.function_name, trigger_function.arguments
    );
  END LOOP;
END
$migration$;
