-- covers: 20261007000000_account_deletion_fk_on_delete.sql
--
-- Account deletion survives every user-keyed foreign key
-- (migration 20261007000000_account_deletion_fk_on_delete).
--
-- WHY THIS FILE EXISTS. delete-user-account ends in auth.admin.deleteUser(), a plain
-- DELETE FROM auth.users. Six NO ACTION edges were added after that function hand-cleared
-- the ones it knew about, so the DELETE raised and the account could not be deleted:
-- checklist_share_links.created_by, admin_audit_log.actor_id, admin_invitations.invited_by
-- and .accepted_by (and, in prod only, university_resources.created_by / updated_by). One
-- prod account was already stuck on 2026-09-06. docs/audits/backend-audit-2026-09-06.md
-- BA-04. This probe was RED against the stack before that migration and is GREEN after.
--
-- WHAT IS ASSERTED
--   §0 the catalog pin: every FK into auth.users or profiles from the tables the migration
--      owns has an ON DELETE rule (CASCADE or SET NULL).
--   §1 one user is seeded into each of those tables and deleted from auth.users exactly as
--      GoTrue does it; the DELETE must succeed.
--   §2 what survives: the share link is gone (CASCADE), the audit row and the invitation
--      remain with their actor columns NULL (SET NULL), the profile is gone (existing
--      cascade), the group the share link pointed at is untouched.
--
-- Runs as the seeding identity throughout: GoTrue's admin delete is not an RLS path, and the
-- defect is in constraint shape, not policy. Rolled back at the end.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/account_deletion_fk_graph.test.sql

\set ON_ERROR_STOP on

\set uni_a   '00000000-0000-4000-8000-000000000001'
\set victim  'ad3a0000-0000-4000-8000-0000000000e1'
\set owner   'ad3a0000-0000-4000-8000-0000000000e2'
\set grp     'ad3a0000-0000-4000-8000-00000000c001'
\set link    'ad3a0000-0000-4000-8000-00000000c002'
\set audit   'ad3a0000-0000-4000-8000-00000000c003'
\set inv     'ad3a0000-0000-4000-8000-00000000c004'

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp._try(stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

-- ── fixtures ────────────────────────────────────────────────────────────────────────────
INSERT INTO public.universities (id, slug, name, short_name, email_domains, is_active) VALUES
  (:'uni_a', 'pitt', 'University of Pittsburgh', 'Pitt', ARRAY['pitt.edu'], true)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;

INSERT INTO auth.users (id, instance_id, aud, role, email,
                        confirmation_token, recovery_token, email_change_token_new, email_change) VALUES
  (:'victim'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fk-victim@pitt.edu', '', '', '', ''),
  (:'owner'::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fk-owner@pitt.edu',  '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, university_id, role) VALUES
  (:'victim'::uuid, 'fk-victim@pitt.edu', 'FK Victim', :'uni_a', 'university_admin'),
  (:'owner'::uuid,  'fk-owner@pitt.edu',  'FK Owner',  :'uni_a', 'user')
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, full_name = EXCLUDED.full_name,
      university_id = EXCLUDED.university_id, role = EXCLUDED.role;

-- A group somebody else owns, with a share link the victim minted.
INSERT INTO public.ranking_collaborations (id, owner_id, status, group_name, university_id) VALUES
  (:'grp'::uuid, :'owner'::uuid, 'accepted', 'fk probe group', :'uni_a')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.checklist_share_links (id, group_id, created_by, label) VALUES
  (:'link'::uuid, :'grp'::uuid, :'victim'::uuid, 'fk probe link')
ON CONFLICT (id) DO NOTHING;

-- The victim as an admin-log actor (exactly what claim_pending_admin_invites writes).
INSERT INTO public.admin_audit_log (id, actor_id, action, target_type, target_id, university_id) VALUES
  (:'audit'::uuid, :'victim'::uuid, 'admin.invite_accepted', 'profile', :'victim'::uuid, :'uni_a')
ON CONFLICT (id) DO NOTHING;

-- The victim as both inviter and acceptor of an invitation.
INSERT INTO public.admin_invitations (id, email, role, university_id, invited_by, status, accepted_by) VALUES
  (:'inv'::uuid, 'fk-invitee@pitt.edu', 'university_admin', :'uni_a', :'victim'::uuid, 'accepted', :'victim'::uuid)
ON CONFLICT (id) DO NOTHING;

-- Prod-only table: seed it when present so the probe means the same thing there.
DO $$
BEGIN
  IF to_regclass('public.university_resources') IS NOT NULL THEN
    EXECUTE format(
      'INSERT INTO public.university_resources (university_id, slug, category, title, url, created_by, updated_by) '
      || 'VALUES (%L, %L, %L, %L, %L, %L, %L) ON CONFLICT DO NOTHING',
      '00000000-0000-4000-8000-000000000001', 'fk-probe-resource', 'probe', 'fk probe resource',
      'https://example.com/fk', 'ad3a0000-0000-4000-8000-0000000000e1', 'ad3a0000-0000-4000-8000-0000000000e1');
  END IF;
END $$;

CREATE TEMP TABLE _r (k text PRIMARY KEY, err text, n bigint);

-- ═══ §0 the catalog pin ══════════════════════════════════════════════════════════════
INSERT INTO _r (k, n) SELECT '0', count(*)
FROM pg_constraint
WHERE contype = 'f'
  AND confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
  AND conrelid IN (SELECT oid FROM pg_class
                   WHERE relname IN ('checklist_share_links', 'admin_audit_log',
                                     'admin_invitations', 'university_resources')
                     AND relnamespace = 'public'::regnamespace)
  AND confdeltype NOT IN ('c', 'n');

-- ═══ §1 the delete GoTrue performs ═══════════════════════════════════════════════════
INSERT INTO _r (k, err) VALUES ('1', pg_temp._try(
  format('DELETE FROM auth.users WHERE id = %L', :'victim')));

-- ═══ verdicts ════════════════════════════════════════════════════════════════════════
\echo '--- §0 catalog pin ---'
SELECT CASE WHEN (SELECT n FROM _r WHERE k = '0') = 0 THEN 'PASS'
  ELSE 'FAIL: ' || (SELECT n FROM _r WHERE k = '0') || ' FK edge(s) into auth.users/profiles still NO ACTION' END
  AS every_user_fk_has_an_on_delete_rule;

\echo '--- §1 deletion ---'
SELECT CASE WHEN (SELECT err FROM _r WHERE k = '1') IS NULL THEN 'PASS'
  ELSE 'FAIL: DELETE FROM auth.users refused: ' || (SELECT err FROM _r WHERE k = '1') END
  AS auth_user_delete_succeeds;

\echo '--- §2 what survives ---'
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM auth.users WHERE id = :'victim'::uuid)
             AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = :'victim'::uuid) THEN 'PASS'
  ELSE 'FAIL: the auth.users or profiles row survived' END AS user_and_profile_gone;
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.checklist_share_links WHERE id = :'link'::uuid) THEN 'PASS'
  ELSE 'FAIL: the share link the victim minted survived' END AS share_link_cascaded;
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.ranking_collaborations WHERE id = :'grp'::uuid) THEN 'PASS'
  ELSE 'FAIL: the group the share link pointed at was deleted' END AS group_untouched;
SELECT CASE WHEN (SELECT actor_id IS NULL FROM public.admin_audit_log WHERE id = :'audit'::uuid) THEN 'PASS'
  ELSE 'FAIL: the audit row is gone or still names the deleted actor' END AS audit_row_survives_with_null_actor;
SELECT CASE WHEN (SELECT invited_by IS NULL AND accepted_by IS NULL FROM public.admin_invitations WHERE id = :'inv'::uuid) THEN 'PASS'
  ELSE 'FAIL: the invitation is gone or still names the deleted admin' END AS invitation_survives_with_null_parties;

ROLLBACK;
