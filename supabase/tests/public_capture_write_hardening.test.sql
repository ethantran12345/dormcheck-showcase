-- covers: 20260828000000_contract_public_capture_writes.sql
-- covers: 20260707034409_university_waitlist.sql
-- covers: 20260708122852_waitlist_growth.sql
-- Contract guard: public prospect-capture tables must be server-write-only.
-- This protects the migration from silently re-introducing bot-writable
-- PostgREST paths while preserving the service-role server endpoints.

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['university_waitlist', 'university_admin_leads']
  LOOP
    IF has_table_privilege('anon', format('public.%I', v_table), 'INSERT') THEN
      RAISE EXCEPTION 'anon retains INSERT on public.%', v_table;
    END IF;
    IF has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT') THEN
      RAISE EXCEPTION 'authenticated retains INSERT on public.%', v_table;
    END IF;
    IF NOT has_table_privilege('service_role', format('public.%I', v_table), 'INSERT') THEN
      RAISE EXCEPTION 'service_role lost INSERT on public.%', v_table;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND cmd = 'INSERT'
        AND roles && ARRAY['anon', 'authenticated']::name[]
    ) THEN
      RAISE EXCEPTION 'public INSERT policy remains on public.%', v_table;
    END IF;
  END LOOP;
END
$$;

SELECT 'PASS: public capture tables deny direct anon/authenticated INSERT while service_role retains endpoint access' AS result;
