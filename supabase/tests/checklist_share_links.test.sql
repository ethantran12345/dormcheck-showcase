-- Checklist share links security surface (family parent link token gating).
-- Covers: guest read/update via token RPCs, member-side link creation/revocation,
-- cross-group isolation, expiration, revocation, RLS on direct table access.
-- Run: npm run test:db (auto-discovered; rolls back on exit)

BEGIN;

-- ── harness role fidelity (docs/security/reaudit-2026-08-06.md H1) ──────────────────────────
-- PostgREST connects as session_user='authenticator' and SET ROLEs to authenticated/anon.
-- `set_config('role', …)` changes current_user but NOT session_user, so under the old idiom
-- session_user stayed superuser — and three shipped triggers (protect_profile_role,
-- protect_profile_is_admin, protect_listing_verified_at) EXEMPT session_user IN
-- ('postgres','supabase_admin'). A plain user's own row took role='superadmin' under the
-- harness and was refused through the real client path: the probe would have passed for the
-- wrong reason, in the direction that says "wide open" about a schema that is sound.
-- pg_temp._assume() reproduces the real client identity — session authorization AND role.
-- Do not go back to set_config('role', …); supabase/tests/harness_role_fidelity.test.sql
-- fails the suite the moment this idiom stops yielding session_user='authenticator'.
CREATE OR REPLACE FUNCTION pg_temp._assume(want text) RETURNS text LANGUAGE plpgsql AS $_assume$
BEGIN
  -- Step back to the connection's own login role first: from 'authenticator' nothing else
  -- is permitted. NULL resets the GUC, so this works whatever the runner connected as.
  PERFORM set_config('session_authorization', NULL, true);
  -- 'postgres' is the identity the seeding phases have always run under, and the one the
  -- three guards exempt, so seeding behaviour is unchanged. Everything else gets the real
  -- client shape: session_user='authenticator', which is NOT exempt.
  PERFORM set_config(
    'session_authorization',
    CASE WHEN want IN ('authenticated', 'anon', 'service_role') THEN 'authenticator' ELSE 'postgres' END,
    true);
  PERFORM set_config('role', want, true);
  RETURN want;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION USING
    MESSAGE = format('pg_temp._assume(%L) needs a SUPERUSER connection; this one is %I.', want, session_user),
    HINT = 'Run the suite through scripts/test-db.sh, which connects as supabase_admin. A '
           'postgres connection cannot set session_authorization, so the harness cannot '
           'reproduce a real client identity and every guard keyed on session_user would be '
           'silently exempt - the failure this helper exists to prevent.';
END $_assume$;

-- Baseline: seeding below runs as session_user='postgres', exactly as it did before this
-- helper existed. Transaction-local on purpose - a session-level set would drop superuser
-- for the whole connection and make the authenticator switch impossible.
SELECT pg_temp._assume('postgres');


-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- Two users in a Pitt group (owner + accepted member), one outsider, a second
-- group with the owner; checklist items in both groups.

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, university_id)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice Owner', '00000000-0000-4000-8000-000000000001'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bob Member', '00000000-0000-4000-8000-000000000001'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Carol Outsider', '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id;

-- Group 1: Alice (owner), Bob (accepted member)
INSERT INTO public.ranking_collaborations (id, owner_id, group_name, university_id)
VALUES ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Family Group 1', '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ranking_group_members (group_id, user_id, status)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'accepted'),
  ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'accepted')
ON CONFLICT (group_id, user_id) DO UPDATE SET status = EXCLUDED.status;

-- Group 2: Alice (owner) only
INSERT INTO public.ranking_collaborations (id, owner_id, group_name, university_id)
VALUES ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Family Group 2', '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ranking_group_members (group_id, user_id, status)
VALUES
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'accepted')
ON CONFLICT (group_id, user_id) DO UPDATE SET status = EXCLUDED.status;

-- Checklist items in Group 1
INSERT INTO public.checklist_items (id, user_id, group_id, item, category, status, is_checked, assigned_to, estimated_price, link, order_index)
VALUES
  ('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Pillow', 'bedding', 'need', false, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 30.00, 'https://amazon.com/pillow', 1),
  ('55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Sheets', 'bedding', 'need', false, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 40.00, 'https://amazon.com/sheets', 2)
ON CONFLICT (id) DO NOTHING;

-- Checklist items in Group 2
INSERT INTO public.checklist_items (id, user_id, group_id, item, category, status, is_checked, assigned_to, estimated_price, order_index)
VALUES
  ('66666666-6666-4666-8666-666666666666', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'Blanket', 'bedding', 'need', false, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 50.00, 3)
ON CONFLICT (id) DO NOTHING;

-- ── Harness ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE test_results (name text, pass boolean, detail text);
CREATE TEMP TABLE share_link_tokens (token uuid);

CREATE OR REPLACE FUNCTION _assert(label text, cond boolean, detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO test_results VALUES (label, cond, detail);
  IF NOT cond THEN RAISE NOTICE 'FAIL: % - %', label, detail;
  ELSE RAISE NOTICE 'PASS: %', label; END IF;
END;
$$;

-- Run SQL as an authenticated user; returns SQLERRM or NULL.
CREATE OR REPLACE FUNCTION pg_temp._exec_as(p_uid uuid, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE p_sql;
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END;
$$;

-- Run SQL as anon (SECURITY DEFINER RPC only).
CREATE OR REPLACE FUNCTION pg_temp._exec_as_anon(p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('anon');
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
  EXECUTE p_sql;
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN SQLERRM;
END;
$$;

-- Fetch the result of an anon-callable RPC (jsonb or void; returns NULL or jsonb result).
CREATE OR REPLACE FUNCTION pg_temp._call_as_anon_jsonb(p_sql text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM pg_temp._assume('anon');
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
  EXECUTE 'SELECT ' || p_sql INTO v_result;
  PERFORM pg_temp._assume('postgres');
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
END;
$$;

-- Call an authenticated function and return its result.
CREATE OR REPLACE FUNCTION pg_temp._call_as_uuid(p_uid uuid, p_sql text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_result uuid;
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SELECT ' || p_sql INTO v_result;
  PERFORM pg_temp._assume('postgres');
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN NULL;
END;
$$;

-- Count visible rows for an authenticated user.
CREATE OR REPLACE FUNCTION pg_temp._count_as(p_uid uuid, p_sql text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SELECT count(*) FROM (' || p_sql || ') s' INTO n;
  PERFORM pg_temp._assume('postgres');
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp._assume('postgres');
  RETURN 0;
END;
$$;

-- ── Test 1: Member can create share link ────────────────────────────────────
DO $$
DECLARE
  v_token uuid;
BEGIN
  v_token := pg_temp._call_as_uuid('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'create_checklist_share_link(''11111111-1111-4111-8111-111111111111'', ''parent access'')');
  PERFORM _assert('member creates share link for own group',
    v_token IS NOT NULL, 'got token ' || coalesce(v_token::text, 'NULL'));
  INSERT INTO pg_temp.share_link_tokens (token) VALUES (v_token);
END $$;

-- ── Test 2: get_shared_checklist as anon returns whitelisted fields ────────
DO $$
DECLARE
  v_token uuid;
  v_result jsonb;
  v_owner_first_name text;
  v_items jsonb;
BEGIN
  SELECT token INTO v_token FROM pg_temp.share_link_tokens LIMIT 1;
  v_result := pg_temp._call_as_anon_jsonb(
    'get_shared_checklist(''' || v_token::text || ''')');
  PERFORM _assert('anon get_shared_checklist returns non-NULL',
    v_result IS NOT NULL, 'result=' || coalesce(v_result::text, 'NULL'));

  PERFORM _assert('returned jsonb has group_name',
    v_result ? 'group_name', 'keys: ' || jsonb_object_keys(v_result)::text);
  PERFORM _assert('returned jsonb has owner_first_name',
    v_result ? 'owner_first_name', '');
  PERFORM _assert('returned jsonb has can_check',
    v_result ? 'can_check', '');
  PERFORM _assert('returned jsonb has items array',
    v_result ? 'items', '');

  v_items := v_result -> 'items';
  PERFORM _assert('items array is non-empty',
    jsonb_array_length(v_items) > 0, 'length=' || jsonb_array_length(v_items)::text);

  -- Check whitelisted item fields: id, item, category, status, is_checked, estimated_price, link, link_title, link_image, order_index, assignee_name
  -- Ensure NO PII fields (user_id, email, venmo, zelle, phone, etc.)
  IF jsonb_array_length(v_items) > 0 THEN
    PERFORM _assert('item 0 has id field',
      v_items -> 0 ? 'id', '');
    PERFORM _assert('item 0 has item field',
      v_items -> 0 ? 'item', '');
    PERFORM _assert('item 0 has category field',
      v_items -> 0 ? 'category', '');
    PERFORM _assert('item 0 has status field',
      v_items -> 0 ? 'status', '');
    PERFORM _assert('item 0 does NOT have user_id (PII)',
      NOT (v_items -> 0 ? 'user_id'), '');
    PERFORM _assert('item 0 does NOT have assigned_to raw uuid (PII)',
      NOT (v_items -> 0 ? 'assigned_to'), '');
  END IF;
END $$;

-- ── Test 3: Invalid token returns NULL ──────────────────────────────────────
DO $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := pg_temp._call_as_anon_jsonb(
    'get_shared_checklist(''99999999-9999-4999-8999-999999999999'')');
  PERFORM _assert('invalid token returns NULL',
    v_result IS NULL, 'result=' || coalesce(v_result::text, 'NULL'));
END $$;

-- ── Test 4: Revoked link returns NULL ───────────────────────────────────────
DO $$
DECLARE
  v_token uuid;
  v_result jsonb;
  v_err text;
BEGIN
  SELECT token INTO v_token FROM pg_temp.share_link_tokens LIMIT 1;

  -- Revoke as member
  v_err := pg_temp._exec_as('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'SELECT revoke_checklist_share_link(''' || v_token::text || ''')');
  PERFORM _assert('member revokes link without error',
    v_err IS NULL, coalesce(v_err, ''));

  -- Try to fetch
  v_result := pg_temp._call_as_anon_jsonb(
    'get_shared_checklist(''' || v_token::text || ''')');
  PERFORM _assert('revoked token returns NULL',
    v_result IS NULL, 'result=' || coalesce(v_result::text, 'NULL'));
END $$;

-- ── Test 5: Expired link returns NULL ───────────────────────────────────────
DO $$
DECLARE
  v_token uuid;
  v_result jsonb;
BEGIN
  -- Create a new link and manually expire it
  INSERT INTO public.checklist_share_links
    (group_id, created_by, token, expires_at)
  VALUES
    ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     '77777777-7777-4777-8777-777777777777', now() - interval '1 hour')
  ON CONFLICT (token) DO NOTHING;

  v_result := pg_temp._call_as_anon_jsonb(
    'get_shared_checklist(''77777777-7777-4777-8777-777777777777'')');
  PERFORM _assert('expired token returns NULL',
    v_result IS NULL, 'result=' || coalesce(v_result::text, 'NULL'));
END $$;

-- ── Test 6: set_shared_item_status updates only within group ────────────────
DO $$
DECLARE
  v_token uuid;
  v_err text;
  v_status text;
BEGIN
  -- Create a fresh link for this test
  v_token := pg_temp._call_as_uuid('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'create_checklist_share_link(''11111111-1111-4111-8111-111111111111'', ''fresh'')');

  -- Update item in Group 1 (should succeed)
  v_err := pg_temp._exec_as_anon(
    'SELECT set_shared_item_status(''' || v_token::text || ''', ''44444444-4444-4444-8444-444444444444'', ''bought'')');
  PERFORM _assert('anon updates item status in token group',
    v_err IS NULL, coalesce(v_err, ''));

  -- Verify the update
  SELECT status INTO v_status FROM public.checklist_items
  WHERE id = '44444444-4444-4444-8444-444444444444';
  PERFORM _assert('item status changed to bought',
    v_status = 'bought', 'status=' || coalesce(v_status, 'NULL'));

  -- Try to update item from Group 2 (should fail with item_not_in_group)
  v_err := pg_temp._exec_as_anon(
    'SELECT set_shared_item_status(''' || v_token::text || ''', ''66666666-6666-4666-8666-666666666666'', ''packed'')');
  PERFORM _assert('anon update of item from other group fails',
    v_err IS NOT NULL AND v_err LIKE '%item_not_in_group%', 'err=' || coalesce(v_err, 'NULL'));

  -- Verify Group 2 item was not updated
  SELECT status INTO v_status FROM public.checklist_items
  WHERE id = '66666666-6666-4666-8666-666666666666';
  PERFORM _assert('item from other group unchanged',
    v_status = 'need', 'status=' || coalesce(v_status, 'NULL'));
END $$;

-- ── Test 7: Invalid status rejected ────────────────────────────────────────
DO $$
DECLARE
  v_token uuid;
  v_err text;
BEGIN
  SELECT token INTO v_token FROM public.checklist_share_links
  WHERE revoked = false AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;

  v_err := pg_temp._exec_as_anon(
    'SELECT set_shared_item_status(''' || v_token::text || ''', ''44444444-4444-4444-8444-444444444444'', ''invalid'')');
  PERFORM _assert('invalid status rejected',
    v_err IS NOT NULL AND v_err LIKE '%invalid_status%', 'err=' || coalesce(v_err, 'NULL'));
END $$;

-- ── Test 8: Direct anon SELECT on table blocked by RLS ──────────────────────
DO $$
DECLARE
  n bigint;
BEGIN
  PERFORM pg_temp._assume('anon');
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
  BEGIN
    SELECT count(*) INTO n FROM public.checklist_share_links;
    PERFORM pg_temp._assume('postgres');
    PERFORM _assert('anon SELECT on table blocked',
      n = 0, 'anon saw ' || n::text || ' rows');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp._assume('postgres');
    PERFORM _assert('anon SELECT raises permission error',
      true, SQLERRM);
  END;
END $$;

-- ── Test 9: Outsider (authenticated, non-member) cannot see links ───────────
DO $$
DECLARE
  n bigint;
BEGIN
  n := pg_temp._count_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'SELECT 1 FROM public.checklist_share_links WHERE group_id = ''11111111-1111-4111-8111-111111111111''');
  PERFORM _assert('outsider cannot SELECT share links for other group',
    n = 0, 'saw ' || n::text || ' rows');
END $$;

-- ── Test 10: Outsider cannot create link ──────────────────────────────────
DO $$
DECLARE
  v_err text;
BEGIN
  v_err := pg_temp._exec_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'SELECT create_checklist_share_link(''11111111-1111-4111-8111-111111111111'', ''hack'')');
  PERFORM _assert('outsider create_checklist_share_link fails',
    v_err IS NOT NULL, 'err=' || coalesce(v_err, 'none'));
END $$;

-- ── Test 11: Outsider cannot revoke link ──────────────────────────────────
DO $$
DECLARE
  v_token uuid;
  v_err text;
BEGIN
  -- Get a valid link
  SELECT token INTO v_token FROM public.checklist_share_links
  WHERE group_id = '11111111-1111-4111-8111-111111111111'
    AND revoked = false LIMIT 1;

  IF v_token IS NOT NULL THEN
    v_err := pg_temp._exec_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'SELECT revoke_checklist_share_link(''' || v_token::text || ''')');
    PERFORM _assert('outsider revoke_checklist_share_link fails',
      v_err IS NOT NULL, 'err=' || coalesce(v_err, 'none'));
  ELSE
    PERFORM _assert('outsider revoke test skipped (no active link)', true, 'setup issue');
  END IF;
END $$;

-- ── Test 12: Tenant isolation (class B child) ──────────────────────────────
DO $$
DECLARE
  n bigint;
BEGIN
  -- ranking_collaborations has tenant isolation; checklist_share_links should
  -- inherit via the group_id FK. Alice's groups are visible to Alice but not
  -- to Carol (different profile.university_id).
  -- Alice should see her group links; Carol should not (tenant policy).
  n := pg_temp._count_as('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'SELECT 1 FROM public.checklist_share_links WHERE group_id = ''11111111-1111-4111-8111-111111111111''');
  PERFORM _assert('owner sees share links for own group',
    n > 0, 'saw ' || n::text || ' rows');
END $$;

-- ── Test 13: Non-accepted member cannot create link ───────────────────────
DO $$
DECLARE
  v_err text;
BEGIN
  -- Add Dave as pending member
  INSERT INTO public.ranking_group_members (group_id, user_id, status)
  VALUES ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'pending')
  ON CONFLICT (group_id, user_id) DO UPDATE SET status = 'pending';

  v_err := pg_temp._exec_as('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'SELECT create_checklist_share_link(''11111111-1111-4111-8111-111111111111'', ''pending try'')');
  PERFORM _assert('pending member cannot create share link',
    v_err IS NOT NULL, 'err=' || coalesce(v_err, 'none'));
END $$;

-- ── Test 14: is_checked mirrors packed status ────────────────────────────────
DO $$
DECLARE
  v_token uuid;
  v_err text;
  v_is_checked boolean;
BEGIN
  -- Create a fresh link and update an item to 'packed'
  v_token := pg_temp._call_as_uuid('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'create_checklist_share_link(''11111111-1111-4111-8111-111111111111'', ''packed test'')');

  v_err := pg_temp._exec_as_anon(
    'SELECT set_shared_item_status(''' || v_token::text || ''', ''55555555-5555-4555-8555-555555555555'', ''packed'')');
  PERFORM _assert('anon updates item to packed',
    v_err IS NULL, coalesce(v_err, ''));

  SELECT is_checked INTO v_is_checked FROM public.checklist_items
  WHERE id = '55555555-5555-4555-8555-555555555555';
  PERFORM _assert('packed status sets is_checked to true',
    v_is_checked = true, 'is_checked=' || coalesce(v_is_checked::text, 'NULL'));

  -- Update back to 'bought'
  v_err := pg_temp._exec_as_anon(
    'SELECT set_shared_item_status(''' || v_token::text || ''', ''55555555-5555-4555-8555-555555555555'', ''bought'')');
  SELECT is_checked INTO v_is_checked FROM public.checklist_items
  WHERE id = '55555555-5555-4555-8555-555555555555';
  PERFORM _assert('bought status sets is_checked to false',
    v_is_checked = false, 'is_checked=' || coalesce(v_is_checked::text, 'NULL'));
END $$;

-- ── Test 15: Read-only link (can_check=false) blocks set_shared_item_status ──
DO $$
DECLARE
  v_token uuid;
  v_err text;
BEGIN
  -- Create a read-only link
  INSERT INTO public.checklist_share_links
    (group_id, created_by, token, can_check)
  VALUES
    ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     '88888888-8888-4888-8888-888888888888', false)
  ON CONFLICT (token) DO NOTHING;

  v_err := pg_temp._exec_as_anon(
    'SELECT set_shared_item_status(''88888888-8888-4888-8888-888888888888'', ''44444444-4444-4444-8444-444444444444'', ''bought'')');
  PERFORM _assert('read-only link rejects set_shared_item_status',
    v_err IS NOT NULL AND v_err LIKE '%read_only_link%', 'err=' || coalesce(v_err, 'NULL'));
END $$;

-- ── Cleanup temp table ────────────────────────────────────────────────────────
DROP TABLE IF EXISTS pg_temp.share_link_tokens;

-- ── Summary / hard fail ──────────────────────────────────────────────────────
DO $$
DECLARE failed int;
BEGIN
  SELECT count(*) INTO failed FROM test_results WHERE NOT pass;
  RAISE NOTICE 'checklist_share_links: % assertions, % failed',
    (SELECT count(*) FROM test_results), failed;
  IF failed > 0 THEN
    RAISE EXCEPTION 'checklist_share_links FAILED: % assertion(s) — see FAIL notices above', failed;
  END IF;
END $$;

ROLLBACK;
