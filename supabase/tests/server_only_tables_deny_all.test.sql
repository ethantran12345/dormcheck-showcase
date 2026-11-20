-- covers: 20260712220421_report_escalation_and_admin_email_log.sql
-- covers: 20260524223000_account_deletion.sql
-- covers: 20260621120000_api_rate_limits.sql
-- covers: 20260710054120_school_directory.sql
-- covers: 20260710192338_schools_reference_directory.sql
-- covers: 20260711232316_movein_push_log.sql
-- covers: 20260713040929_email_suppressions.sql
-- covers: 20260714025933_scheduled_templated_broadcasts.sql
--
-- Grandfathered debt paid (2026-08-16 audit, docs/security/rls-grandfathered-audit.md).
-- Seven migrations in the baseline share one shape and had no coverage at all: they create a
-- SERVER-ONLY table, run `ALTER TABLE … ENABLE ROW LEVEL SECURITY`, and deliberately create
-- NO policy. RLS-enabled-with-zero-policies is a deny-all: only a BYPASSRLS role (service_role,
-- and SECURITY DEFINER paths) can reach a row. That is a real, load-bearing security property
-- and it is one line away from being lost — adding any policy to any of these tables opens it.
--
-- WHY THIS IS NOT BOOKKEEPING. Two of these tables hold student PII:
--   · deleted_accounts    — the audit trail of who deleted their account, and
--   · email_suppressions  — raw email addresses and why they were suppressed.
-- And `deleted_accounts` is the sharp one: the migration left `anon` and `authenticated`
-- holding INSERT/SELECT/UPDATE/DELETE **grants** on it (measured, §3). The ONLY thing standing
-- between a signed-out visitor and that table is the empty policy set. A single well-meant
-- "let users see their own deletion record" policy would publish the lot.
--
-- WHY BOTH DIRECTIONS, and why the positive control is the important half. "authenticated
-- reads 0 rows" passes just as happily against an EMPTY TABLE, a renamed table, or a drifted
-- seed. So every table here is seeded with exactly one row first, and §2 proves a BYPASSRLS
-- reader still sees that row. Zero-for-clients is only meaningful next to one-for-the-server.
--
-- The structural pin in §4 (RLS on AND zero policies) is what makes this file fail the moment
-- someone adds a policy, rather than quietly re-testing a table that is no longer deny-all.
--
-- Rolled back at the end.
-- Run: bash scripts/test-db.sh   (or psql … -f supabase/tests/server_only_tables_deny_all.test.sql)

BEGIN;

-- ── harness role fidelity (docs/security/reaudit-2026-08-06.md H1) ──────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._assume(want text) RETURNS text LANGUAGE plpgsql AS $_assume$
BEGIN
  PERFORM set_config('session_authorization', NULL, true);
  PERFORM set_config(
    'session_authorization',
    CASE WHEN want IN ('authenticated', 'anon', 'service_role') THEN 'authenticator' ELSE 'postgres' END,
    true);
  PERFORM set_config('role', want, true);
  RETURN want;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION USING
    MESSAGE = format('pg_temp._assume(%L) needs a SUPERUSER connection; this one is %I.', want, session_user),
    HINT = 'Run the suite through scripts/test-db.sh, which connects as supabase_admin.';
END $_assume$;

SELECT pg_temp._assume('postgres');

-- movein_push_log.user_id carries an FK to auth.users, so the seed needs a real account.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('5e000000-0000-4000-8000-00000000d001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE test_results (name text, pass boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('postgres');
  INSERT INTO test_results VALUES (label, cond, detail);
  IF NOT cond THEN RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE RAISE NOTICE 'PASS: %', label; END IF;
END;
$$;

-- The seven server-only tables, each with the seed that proves the row exists.
CREATE TEMP TABLE server_only(ord int, tbl text, seed text, probe_where text);
-- ord, not alphabetical: school_domains carries an FK to schools, so schools must seed first.
INSERT INTO server_only VALUES
  (1, 'deleted_accounts',
   $s$INSERT INTO public.deleted_accounts (auth_user_id) VALUES ('5e000000-0000-4000-8000-00000000d001')$s$,
   $w$auth_user_id = '5e000000-0000-4000-8000-00000000d001'$w$),
  (2, 'api_rate_limits',
   $s$INSERT INTO public.api_rate_limits (bucket_key) VALUES ('probe:server-only')$s$,
   $w$bucket_key = 'probe:server-only'$w$),
  (3, 'school_directory',
   $s$INSERT INTO public.school_directory (email_domain, university_name) VALUES ('probe-only.test', 'Probe University')$s$,
   $w$email_domain = 'probe-only.test'$w$),
  (4, 'schools',
   $s$INSERT INTO public.schools (id, ipeds_unitid, name) VALUES ('5e000000-0000-4000-8000-00000000d002', 999001, 'Probe School')$s$,
   $w$ipeds_unitid = 999001$w$),
  (5, 'school_domains',
   $s$INSERT INTO public.school_domains (domain, school_id) VALUES ('probe-only.test', '5e000000-0000-4000-8000-00000000d002')$s$,
   $w$domain = 'probe-only.test'$w$),
  (6, 'movein_push_log',
   $s$INSERT INTO public.movein_push_log (user_id, milestone) VALUES ('5e000000-0000-4000-8000-00000000d001', 7)$s$,
   $w$user_id = '5e000000-0000-4000-8000-00000000d001'$w$),
  (7, 'email_suppressions',
   $s$INSERT INTO public.email_suppressions (email, reason) VALUES ('probe-only@probe-only.test', 'bounce')$s$,
   $w$email = 'probe-only@probe-only.test'$w$),
  (8, 'broadcast_templates',
   $s$INSERT INTO public.broadcast_templates (name, title, body) VALUES ('probe-only', 'Probe', 'Probe body')$s$,
   $w$name = 'probe-only'$w$),
  -- admin_email_log is the same shape from a NON-grandfathered migration
  -- (20260712220421). It was reached here because the hardened coverage gate rejected that
  -- migration's old declaration as off subject: the probe that cited it never named either
  -- relation whose RLS it changes.
  (9, 'admin_email_log',
   $s$INSERT INTO public.admin_email_log (admin_id, kind) VALUES ('5e000000-0000-4000-8000-00000000d001', 'report_nudge')$s$,
   $w$admin_id = '5e000000-0000-4000-8000-00000000d001'$w$);

-- Reports what a role actually experiences: 'denied' when the statement never reaches RLS
-- (no GRANT), otherwise the row count RLS let through. Both are acceptable outcomes for a
-- deny-all table; what is NOT acceptable is a positive row count.
CREATE OR REPLACE FUNCTION pg_temp._read_as(role_name text, tbl text, pred text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM pg_temp._assume(role_name);
  EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', tbl, pred) INTO n;
  PERFORM pg_temp._assume('postgres');
  RETURN 'rows:' || n;
EXCEPTION WHEN insufficient_privilege THEN
  PERFORM pg_temp._assume('postgres');
  RETURN 'denied';
WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN 'error:' || SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION pg_temp._exec_as(role_name text, stmt text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume(role_name);
  EXECUTE stmt;
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END $$;

DO $$
DECLARE
  r record;
  outcome text;
  err text;
  n int;
BEGIN
  -- ═══ §1 seed as the server, one row per table ══════════════════════════════════════════
  PERFORM pg_temp._assume('postgres');
  FOR r IN SELECT * FROM server_only ORDER BY ord LOOP
    EXECUTE r.seed;
  END LOOP;

  FOR r IN SELECT * FROM server_only ORDER BY ord LOOP
    -- ═══ §2 POSITIVE CONTROL: the server path still reaches the row ═════════════════════
    -- Without this, every negative below would pass against an empty or renamed table.
    PERFORM pg_temp._assume('postgres');
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', r.tbl, r.probe_where) INTO n;
    PERFORM pg_temp._assert(format('%s: the server (BYPASSRLS) reads the seeded row', r.tbl),
      n = 1, n::text);

    -- ═══ §3 NEGATIVE: no client role reaches it, signed in or out ═══════════════════════
    outcome := pg_temp._read_as('authenticated', r.tbl, r.probe_where);
    PERFORM pg_temp._assert(format('%s: authenticated reaches no row (deny-all)', r.tbl),
      outcome IN ('denied', 'rows:0'), outcome);

    outcome := pg_temp._read_as('anon', r.tbl, r.probe_where);
    PERFORM pg_temp._assert(format('%s: anon reaches no row (deny-all)', r.tbl),
      outcome IN ('denied', 'rows:0'), outcome);

    -- Writes too: a deny-all table with no policy accepts no client INSERT. `deleted_accounts`
    -- is why this is asserted rather than assumed — it grants anon full DML (§5).
    err := pg_temp._exec_as('authenticated', r.seed);
    PERFORM pg_temp._assert(format('%s: authenticated INSERT is refused', r.tbl),
      err IS NOT NULL, coalesce(err, 'INSERT SUCCEEDED'));

    err := pg_temp._exec_as('anon', r.seed);
    PERFORM pg_temp._assert(format('%s: anon INSERT is refused', r.tbl),
      err IS NOT NULL, coalesce(err, 'INSERT SUCCEEDED'));

    -- ═══ §4 STRUCTURAL PIN: still RLS-on with zero policies ═════════════════════════════
    -- The behavioural assertions above stop meaning "deny-all" the moment a policy appears;
    -- this makes that event fail the suite instead of silently re-scoping the test.
    PERFORM pg_temp._assume('postgres');
    SELECT count(*) INTO n FROM pg_class c
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = r.tbl AND c.relrowsecurity;
    PERFORM pg_temp._assert(format('%s: row level security is still enabled', r.tbl), n = 1, n::text);

    SELECT count(*) INTO n FROM pg_policy
     WHERE polrelid = format('public.%I', r.tbl)::regclass;
    PERFORM pg_temp._assert(
      format('%s: still has ZERO policies — adding one opens a server-only table', r.tbl),
      n = 0, n::text);
  END LOOP;

  -- ═══ §5 the sharp edge, pinned explicitly ══════════════════════════════════════════════
  -- 20260524223000 left anon and authenticated holding full DML GRANTS on deleted_accounts.
  -- The empty policy set is the entire defence. Asserted as the CURRENT state so that if the
  -- grants are ever tightened this assertion goes red and someone reads this paragraph — and
  -- so the risk is recorded rather than implied. Finding SO-1 in the audit.
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'deleted_accounts'
     AND grantee IN ('anon', 'authenticated') AND privilege_type = 'SELECT';
  PERFORM pg_temp._assert(
    'HAZARD SO-1: deleted_accounts still grants SELECT to anon AND authenticated — only the empty policy set denies them',
    n = 2, n::text);

  PERFORM pg_temp._assume('postgres');
END $$;

DO $$
DECLARE fails int;
BEGIN
  SELECT count(*) INTO fails FROM test_results WHERE NOT pass;
  IF fails > 0 THEN
    RAISE EXCEPTION '% assertion(s) failed in server_only_tables_deny_all', fails;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM test_results);
END $$;

ROLLBACK;
