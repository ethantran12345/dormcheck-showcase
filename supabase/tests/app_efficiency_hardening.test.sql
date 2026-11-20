-- covers: 20261003000000_rls_initplan_and_relationship_indexes.sql
-- Structural assertions here pin the optimization and grant changes. The full
-- wired suite supplies the attack-denied and legitimate-path behavior checks for
-- every rewritten policy in both forward and reverse probe order, including the
-- representative public.business_listings policy named explicitly by the migration.
BEGIN;

DO $test$
DECLARE
  bare_auth_policies integer;
  unindexed_fks integer;
  exposed_trigger_functions integer;
BEGIN
  SELECT count(*) INTO bare_auth_policies
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'storage')
    AND (
      regexp_replace(
        replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), '( SELECT auth.uid() AS uid)', '__protected__'),
        'auth[.]uid[(][)]', '(SELECT auth.uid())', 'gi'
      ) IS DISTINCT FROM replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), '( SELECT auth.uid() AS uid)', '__protected__')
      OR regexp_replace(
        replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), '( SELECT auth.uid() AS uid)', '__protected__'),
        'auth[.]uid[(][)]', '(SELECT auth.uid())', 'gi'
      ) IS DISTINCT FROM replace(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), '( SELECT auth.uid() AS uid)', '__protected__')
    );
  IF bare_auth_policies <> 0 THEN
    RAISE EXCEPTION '% policies still evaluate auth.uid() per row', bare_auth_policies;
  END IF;

  SELECT count(*) INTO unindexed_fks
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE con.contype = 'f'
    AND n.nspname = 'public'
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = con.conrelid
        AND i.indisvalid AND i.indisready
        AND (i.indkey::smallint[])[0:cardinality(con.conkey) - 1] = con.conkey
    );
  IF unindexed_fks <> 0 THEN
    RAISE EXCEPTION '% public foreign keys still lack a leading-column index', unindexed_fks;
  END IF;

  SELECT count(*) INTO exposed_trigger_functions
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef
    AND p.prorettype = 'trigger'::regtype
    AND n.nspname IN ('public', 'private')
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );
  IF exposed_trigger_functions <> 0 THEN
    RAISE EXCEPTION '% security-definer trigger functions remain RPC-callable', exposed_trigger_functions;
  END IF;
END
$test$;

ROLLBACK;
