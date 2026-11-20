-- Pitt VRSA hardening - moderation-action audit log (#9)
-- Triage: git show ec16fc14:docs/audits/pitt-vrsa-triage.md (removed 2026-08-06)
--
-- STAGED: apply to LOCAL Supabase first; do NOT apply to prod without Ethan's OK.
--
-- Trust & safety is an explicit Pitt concern. ReportsPage dismiss/delete actions
-- currently write nothing durable. This adds an append-only audit table mirroring
-- the existing dorm_edits precedent: admin-only INSERT/SELECT, no UPDATE/DELETE,
-- actor preserved (ON DELETE SET NULL) so the trail outlives the admin account.

CREATE TABLE IF NOT EXISTS public.moderation_actions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  admin_id uuid,
  action text NOT NULL,
  content_type text NOT NULL,
  content_id uuid NOT NULL,
  report_id uuid,
  reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT moderation_actions_pkey PRIMARY KEY (id),
  CONSTRAINT moderation_actions_admin_id_fkey
    FOREIGN KEY (admin_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT moderation_actions_action_check
    CHECK (action IN ('dismiss_report', 'delete_content', 'restore_listing')),
  CONSTRAINT moderation_actions_content_type_check
    CHECK (content_type IN ('student_review', 'marketplace_listing', 'roommate_post', 'building_chat_link', 'user')),
  CONSTRAINT moderation_actions_reason_len CHECK (reason IS NULL OR char_length(reason) <= 500)
);

CREATE INDEX IF NOT EXISTS moderation_actions_created_at_idx
  ON public.moderation_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS moderation_actions_admin_id_created_at_idx
  ON public.moderation_actions (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS moderation_actions_content_idx
  ON public.moderation_actions (content_type, content_id, created_at DESC);

ALTER TABLE public.moderation_actions ENABLE ROW LEVEL SECURITY;

-- Append-only: INSERT + SELECT for admins only; no UPDATE/DELETE policy exists.
CREATE POLICY admins_insert_moderation_actions
  ON public.moderation_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    admin_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  );

CREATE POLICY admins_read_moderation_actions
  ON public.moderation_actions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.is_admin = true
    )
  );
