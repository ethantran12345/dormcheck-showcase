-- covers: 20260901000003_security_backup_code_mint_and_private_views.sql
-- Probe for 20260901000003_security_backup_code_mint_and_private_views:
--  1. mfa_backup_codes: client INSERT is denied; minting requires aal2;
--     redemption works at aal1, is single-use, sets mfa_reenroll_required,
--     and DOES NOT delete the user's TOTP factors.
--  2. private.roommate_search_posts_contact: tenant predicate (same-uni sees
--     contacts, cross-uni sees zero rows) + base-table visibility (inactive
--     posts hidden from non-owners).
-- Rolled back at the end; safe against prod-shaped data.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/backup_code_mint_and_roommate_contact.test.sql

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
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active)
VALUES ('00000000-0000-4000-8000-000000000002', 'cmu', 'Carnegie Mellon University', 'CMU',
        ARRAY['andrew.cmu.edu','cmu.edu'], true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email)
VALUES
  ('41111111-aaaa-4aaa-8aaa-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Dana (Pitt)
  ('42222222-bbbb-4bbb-8bbb-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL), -- Evan (Pitt, poster)
  ('43333333-cccc-4ccc-8ccc-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL)  -- Fay  (CMU)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, university_id) VALUES
  ('41111111-aaaa-4aaa-8aaa-111111111111', 'BCM Dana Pitt', '00000000-0000-4000-8000-000000000001'),
  ('42222222-bbbb-4bbb-8bbb-222222222222', 'BCM Evan Pitt', '00000000-0000-4000-8000-000000000001'),
  ('43333333-cccc-4ccc-8ccc-333333333333', 'BCM Fay CMU',   '00000000-0000-4000-8000-000000000002')
ON CONFLICT (id) DO UPDATE SET university_id = EXCLUDED.university_id;

-- Evan: active post (snapchat shown) + inactive post.
INSERT INTO public.roommate_search_posts (id, user_id, post_type, content, university_id,
                                          phone_number, instagram, snapchat,
                                          show_phone, show_instagram, show_snapchat, is_active) VALUES
  ('99000041-0000-4000-8000-000000000001', '42222222-bbbb-4bbb-8bbb-222222222222', 'looking-for-roommates', 'bcm active',
   '00000000-0000-4000-8000-000000000001', '412-555-0100', 'evan_ig', 'evan_snap', false, false, true, true),
  ('99000041-0000-4000-8000-000000000002', '42222222-bbbb-4bbb-8bbb-222222222222', 'looking-for-roommates', 'bcm inactive',
   '00000000-0000-4000-8000-000000000001', '412-555-0101', 'evan_ig', 'evan_snap', true, true, true, false);

-- A verified TOTP factor for Dana — must SURVIVE a backup-code redemption.
INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
VALUES ('99000042-0000-4000-8000-000000000001', '41111111-aaaa-4aaa-8aaa-111111111111',
        'probe authenticator', 'totp', 'verified', now(), now());

-- ── Helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp._as_user_aal(uid uuid, p_aal text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('authenticated');
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp._assert(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp._assume('postgres');
  IF cond IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: %', label;
  END IF;
  RAISE NOTICE 'ok: %', label;
END $$;

DO $$
DECLARE
  dana uuid := '41111111-aaaa-4aaa-8aaa-111111111111';
  evan uuid := '42222222-bbbb-4bbb-8bbb-222222222222';
  fay  uuid := '43333333-cccc-4ccc-8ccc-333333333333';
  codes text[];
  ok boolean;
  denied boolean;
  n int;
  ph text; sc text;
BEGIN
  -- 1. Client INSERT path is closed (grant revoked → insufficient_privilege).
  PERFORM pg_temp._as_user_aal(dana, 'aal2');
  BEGIN
    INSERT INTO public.mfa_backup_codes (user_id, code_hash)
    VALUES (dana, repeat('a', 64));
    denied := false;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  PERFORM pg_temp._assert('mint: client INSERT into mfa_backup_codes denied', denied);

  -- 2. Minting at aal1 is refused (regeneration is the attacker operation).
  PERFORM pg_temp._as_user_aal(dana, 'aal1');
  BEGIN
    codes := public.mint_backup_codes();
    denied := false;
  EXCEPTION WHEN OTHERS THEN denied := true;
  END;
  PERFORM pg_temp._assert('mint: refused at aal1', denied);

  -- 3. Minting at aal2 returns 10 well-formed plaintext codes.
  PERFORM pg_temp._as_user_aal(dana, 'aal2');
  codes := public.mint_backup_codes();
  PERFORM pg_temp._assert('mint: 10 codes at aal2', array_length(codes, 1) = 10);
  PERFORM pg_temp._assert('mint: xxxx-xxxx format', codes[1] ~ '^[a-z2-9]{4}-[a-z2-9]{4}$');
  SELECT count(*) INTO n FROM public.mfa_backup_codes WHERE user_id = dana;
  PERFORM pg_temp._assert('mint: 10 hashes stored', n = 10);

  -- 4. Redemption works at aal1 (that is the point of a backup code).
  PERFORM pg_temp._as_user_aal(dana, 'aal1');
  ok := public.use_backup_code(codes[1]);
  PERFORM pg_temp._assert('redeem: valid code accepted at aal1', ok);

  -- 5. Single-use: the same code fails the second time.
  PERFORM pg_temp._as_user_aal(dana, 'aal1');
  ok := public.use_backup_code(codes[1]);
  PERFORM pg_temp._assert('redeem: same code rejected on reuse', NOT ok);

  -- 6. TOTP factors and the remaining codes SURVIVE redemption.
  PERFORM pg_temp._assume('postgres');
  SELECT count(*) INTO n FROM auth.mfa_factors WHERE user_id = dana AND factor_type = 'totp';
  PERFORM pg_temp._assert('redeem: TOTP factor survives', n = 1);
  SELECT count(*) INTO n FROM public.mfa_backup_codes WHERE user_id = dana AND used_at IS NULL;
  PERFORM pg_temp._assert('redeem: 9 unused codes remain', n = 9);
  SELECT count(*) INTO n FROM public.profiles WHERE id = dana AND mfa_reenroll_required = true;
  PERFORM pg_temp._assert('redeem: profile flagged for re-enrollment', n = 1);

  -- 7. Rate limit: attempts 3-5 burn the window, the 6th is refused even
  --    with a valid code. (Attempts so far: 2.)
  PERFORM pg_temp._as_user_aal(dana, 'aal1');
  ok := public.use_backup_code('not-real1');
  ok := public.use_backup_code('not-real2');
  ok := public.use_backup_code('not-real3');
  ok := public.use_backup_code(codes[2]);
  PERFORM pg_temp._assert('redeem: rate limit refuses the 6th attempt in 15 min', NOT ok);

  -- 8. roommate_search_posts_contact: same-uni caller sees the active post's
  --    permitted contact fields.
  PERFORM pg_temp._as_user_aal(dana, 'aal1');
  SELECT phone_number, snapchat INTO ph, sc
    FROM public.roommate_search_posts_contact WHERE id = '99000041-0000-4000-8000-000000000001';
  PERFORM pg_temp._assert('rspc: same-uni sees shown snapchat', sc = 'evan_snap');
  PERFORM pg_temp._assert('rspc: same-uni phone masked (show_phone=false)', ph IS NULL);

  -- 9. Cross-university caller gets zero rows — the fixed predicate.
  PERFORM pg_temp._as_user_aal(fay, 'aal1');
  SELECT count(*) INTO n FROM public.roommate_search_posts_contact
   WHERE id IN ('99000041-0000-4000-8000-000000000001', '99000041-0000-4000-8000-000000000002');
  PERFORM pg_temp._assert('rspc: cross-uni caller sees zero rows', n = 0);

  -- 10. Inactive post hidden from non-owners, visible to its owner.
  PERFORM pg_temp._as_user_aal(dana, 'aal1');
  SELECT count(*) INTO n FROM public.roommate_search_posts_contact
   WHERE id = '99000041-0000-4000-8000-000000000002';
  PERFORM pg_temp._assert('rspc: inactive post hidden from same-uni non-owner', n = 0);
  PERFORM pg_temp._as_user_aal(evan, 'aal1');
  SELECT count(*) INTO n FROM public.roommate_search_posts_contact
   WHERE id = '99000041-0000-4000-8000-000000000002';
  PERFORM pg_temp._assert('rspc: owner still sees own inactive post', n = 1);

  PERFORM pg_temp._assume('postgres');
END $$;

ROLLBACK;
