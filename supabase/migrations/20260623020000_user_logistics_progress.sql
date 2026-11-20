-- Cross-device sync for the move-in / move-out logistics checklists.
--
-- These checklists are generic guidance steps (no per-item rows), so we store
-- the set of completed step ids per user per list as a text[]. One row per
-- (user_id, list_key) - e.g. ('<uid>', 'moveout', '{mo-key,mo-photos}').
--
-- The client (useLogisticsProgress) keeps a localStorage cache and works fine
-- whether or not this table exists yet, so deploy order doesn't matter - once
-- this lands, checks start syncing across the user's devices.

CREATE TABLE IF NOT EXISTS public.user_logistics_progress (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  list_key text NOT NULL,
  done_ids text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, list_key)
);

ALTER TABLE public.user_logistics_progress ENABLE ROW LEVEL SECURITY;

-- Own-row only across the board (a user reads/writes only their own progress).
CREATE POLICY "rls_user_logistics_progress_select"
  ON public.user_logistics_progress FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "rls_user_logistics_progress_insert"
  ON public.user_logistics_progress FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "rls_user_logistics_progress_update"
  ON public.user_logistics_progress FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "rls_user_logistics_progress_delete"
  ON public.user_logistics_progress FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON public.user_logistics_progress FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_logistics_progress TO authenticated;
