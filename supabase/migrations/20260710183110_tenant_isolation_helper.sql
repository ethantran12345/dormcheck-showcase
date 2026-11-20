-- Tenant hardening 1/3: reusable scoping helper.
-- apply_tenant_isolation(<table>) creates the standard class-A RESTRICTIVE tenant policy
-- (exact shape of 20260723020000) so scoping a new university-scoped root is one call in a
-- migration instead of hand-rolled SQL. Class B/C/D patterns stay as documented snippets in
-- docs/multi-university.md ("Adding a table? Pick a tenant class").
-- Rollback: DROP FUNCTION public.apply_tenant_isolation(regclass);

CREATE OR REPLACE FUNCTION public.apply_tenant_isolation(p_table regclass)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = p_table AND attname = 'university_id' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'apply_tenant_isolation: % has no university_id column — this helper is for class-A roots only; use the class B/C/D snippets in docs/multi-university.md', p_table;
  END IF;

  EXECUTE format(
    'DROP POLICY IF EXISTS tenant_isolation ON %s;
     CREATE POLICY tenant_isolation ON %s
       AS RESTRICTIVE FOR ALL TO authenticated
       USING (university_id = public.current_university_id() OR public.is_superadmin())
       WITH CHECK (university_id = public.current_university_id() OR public.is_superadmin());',
    p_table, p_table
  );
END;
$$;

COMMENT ON FUNCTION public.apply_tenant_isolation(regclass) IS
  'Migration-time tool: adds the standard class-A RESTRICTIVE tenant_isolation policy '
  '(university_id = current_university_id() OR is_superadmin()) to a root table. '
  'Requires a university_id column. Never callable by app roles. '
  'Register the table as class A in supabase/registry/table-classification.json.';

REVOKE EXECUTE ON FUNCTION public.apply_tenant_isolation(regclass) FROM public, anon, authenticated;
