-- Let an account be deleted when it is referenced by a share link, an admin-audit row, an
-- invitation, or a university resource (BA-04, docs/audits/backend-audit-2026-09-06.md).
--
-- THE DEFECT. supabase/functions/delete-user-account/index.ts hand-clears the NO ACTION
-- foreign keys it knew about (dorm_questions, dorm_answers, setup_comments, student_setups,
-- conversations.initiated_by) and then calls auth.admin.deleteUser(), which is a plain
-- DELETE FROM auth.users. Six NO ACTION edges were added after that function was written and
-- are not handled, so the DELETE raises and the user gets a 500 — the 30-day deletion
-- promise in Privacy.tsx is broken for anyone who ever:
--   · created a checklist share link         checklist_share_links.created_by → auth.users
--   · appeared as an actor in the admin log  admin_audit_log.actor_id        → profiles
--     (claim_pending_admin_invites logs the CLAIMING user as actor, so every admin who
--      accepted an invite is in this set)
--   · sent or accepted an admin invitation   admin_invitations.invited_by / accepted_by
--   · created or edited a university resource university_resources.created_by / updated_by
-- profiles cascades from auth.users, so the profiles-referencing edges fail the cascade,
-- which fails the auth.users DELETE. Measured on prod 2026-09-06: one live account is
-- already undeletable.
--
-- THE FIX lives in the schema, not the function: an ON DELETE rule cannot be forgotten by
-- the next caller the way a hand-written pre-delete can (this migration exists because it
-- was). Two shapes:
--   · checklist_share_links.created_by → ON DELETE CASCADE. A share link is a capability
--     the creator minted; it dies with them. The group it points at is untouched.
--   · the four audit / ownership columns → ON DELETE SET NULL. The trail must outlive the
--     actor — the precedent set by moderation_actions.admin_id and dorm_edits.edited_by
--     ("preserves audit entries even if admin accounts are later deleted", baseline). The two
--     NOT NULL columns among them (admin_audit_log.actor_id, admin_invitations.invited_by)
--     are relaxed for exactly that reason; nothing reads either as non-null — the audit-log
--     RLS predicate `NOT actor_is_superadmin(actor_id)` is true for NULL, and the
--     invitation policies key on university_id and role.
--
-- EACH SWAP IS add-under-a-temp-name → VALIDATE → drop old → RENAME (the repo rule in
-- .claude/rules/supabase-backend.md): if the ADD fails the old constraint is still there,
-- whether or not the runner wrapped this file in a transaction. VALIDATE cannot fail here —
-- the old FK guarantees every referenced row exists — but the shape is kept so the file
-- reads the same as every other constraint swap in the repo.
--
-- university_resources is dropped locally by 20260820030000 but still live in prod (the
-- drop is pending), so its two edges are handled inside a guard that is a no-op wherever
-- the table is absent. Forward-only; every statement is expand-only.
--
-- Probe: supabase/tests/account_deletion_fk_graph.test.sql (red before this file, green
-- after): seeds one user into every table above and deletes them from auth.users exactly
-- as GoTrue does.

BEGIN;

-- checklist_share_links.created_by: the link dies with its creator.
ALTER TABLE public.checklist_share_links
  ADD CONSTRAINT checklist_share_links_created_by_fkey_new
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.checklist_share_links
  VALIDATE CONSTRAINT checklist_share_links_created_by_fkey_new;
ALTER TABLE public.checklist_share_links
  DROP CONSTRAINT checklist_share_links_created_by_fkey;
ALTER TABLE public.checklist_share_links
  RENAME CONSTRAINT checklist_share_links_created_by_fkey_new TO checklist_share_links_created_by_fkey;

-- admin_audit_log.actor_id: the trail outlives the actor.
ALTER TABLE public.admin_audit_log ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE public.admin_audit_log
  ADD CONSTRAINT admin_audit_log_actor_id_fkey_new
  FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.admin_audit_log
  VALIDATE CONSTRAINT admin_audit_log_actor_id_fkey_new;
ALTER TABLE public.admin_audit_log
  DROP CONSTRAINT admin_audit_log_actor_id_fkey;
ALTER TABLE public.admin_audit_log
  RENAME CONSTRAINT admin_audit_log_actor_id_fkey_new TO admin_audit_log_actor_id_fkey;

-- admin_invitations.invited_by / accepted_by: the invitation record outlives both parties.
ALTER TABLE public.admin_invitations ALTER COLUMN invited_by DROP NOT NULL;
ALTER TABLE public.admin_invitations
  ADD CONSTRAINT admin_invitations_invited_by_fkey_new
  FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.admin_invitations
  VALIDATE CONSTRAINT admin_invitations_invited_by_fkey_new;
ALTER TABLE public.admin_invitations
  DROP CONSTRAINT admin_invitations_invited_by_fkey;
ALTER TABLE public.admin_invitations
  RENAME CONSTRAINT admin_invitations_invited_by_fkey_new TO admin_invitations_invited_by_fkey;

ALTER TABLE public.admin_invitations
  ADD CONSTRAINT admin_invitations_accepted_by_fkey_new
  FOREIGN KEY (accepted_by) REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.admin_invitations
  VALIDATE CONSTRAINT admin_invitations_accepted_by_fkey_new;
ALTER TABLE public.admin_invitations
  DROP CONSTRAINT admin_invitations_accepted_by_fkey;
ALTER TABLE public.admin_invitations
  RENAME CONSTRAINT admin_invitations_accepted_by_fkey_new TO admin_invitations_accepted_by_fkey;

-- university_resources.created_by / updated_by: prod only until 20260820030000 lands there.
DO $$
DECLARE
  v_col text;
BEGIN
  IF to_regclass('public.university_resources') IS NULL THEN
    RAISE NOTICE '20261007000000: public.university_resources absent here, skipping its two edges';
    RETURN;
  END IF;
  FOREACH v_col IN ARRAY ARRAY['created_by', 'updated_by'] LOOP
    EXECUTE format('ALTER TABLE public.university_resources ALTER COLUMN %I DROP NOT NULL', v_col);
    EXECUTE format(
      'ALTER TABLE public.university_resources ADD CONSTRAINT university_resources_%s_fkey_new '
      || 'FOREIGN KEY (%I) REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID', v_col, v_col);
    EXECUTE format('ALTER TABLE public.university_resources VALIDATE CONSTRAINT university_resources_%s_fkey_new', v_col);
    EXECUTE format('ALTER TABLE public.university_resources DROP CONSTRAINT IF EXISTS university_resources_%s_fkey', v_col);
    EXECUTE format(
      'ALTER TABLE public.university_resources RENAME CONSTRAINT university_resources_%s_fkey_new TO university_resources_%s_fkey',
      v_col, v_col);
  END LOOP;
END $$;

-- Self-check: no NO ACTION / RESTRICT edge into auth.users or profiles remains on the tables
-- this migration owns, and no temp-named constraint was left behind. (The five edges
-- delete-user-account clears by hand are out of scope here and stay as they are; the probe
-- documents them.)
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(conrelid::regclass::text || '.' || conname, ', ')
    INTO v_bad
  FROM pg_constraint
  WHERE contype = 'f'
    AND confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
    AND conrelid IN (SELECT oid FROM pg_class
                     WHERE relname IN ('checklist_share_links', 'admin_audit_log',
                                       'admin_invitations', 'university_resources')
                       AND relnamespace = 'public'::regnamespace)
    AND (confdeltype NOT IN ('c', 'n') OR conname LIKE '%\_new');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '20261007000000: still NO ACTION/RESTRICT (or temp-named) into auth.users/profiles: %', v_bad;
  END IF;
END $$;

COMMIT;
