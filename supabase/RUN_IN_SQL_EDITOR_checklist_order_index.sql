-- =============================================================================
-- Copy-paste this into Supabase Dashboard → SQL Editor → New query → Run
-- Adds order_index to checklist_items and orders Group List by it.
-- =============================================================================

-- 1. Add column
ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS order_index integer DEFAULT 0;

COMMENT ON COLUMN public.checklist_items.order_index IS 'Display order: sections by min(order_index); items within section by order_index ascending.';

-- 2. Backfill (preserves existing order: use position if present, else created_at)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'checklist_items' AND column_name = 'position'
  ) THEN
    UPDATE public.checklist_items SET order_index = COALESCE(position, 0);
  ELSE
    WITH ordered AS (
      SELECT id,
             row_number() OVER (
               PARTITION BY user_id, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid)
               ORDER BY created_at ASC NULLS LAST, id
             ) - 1 AS rn
      FROM public.checklist_items
    )
    UPDATE public.checklist_items ci SET order_index = ordered.rn FROM ordered WHERE ci.id = ordered.id;
  END IF;
END $$;

-- 3. Group List: order by order_index so roommates see the same layout
CREATE OR REPLACE FUNCTION public.get_group_checklist(query_group_id uuid)
RETURNS SETOF public.checklist_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ranking_group_members
    WHERE group_id = query_group_id AND user_id = v_uid AND status = 'accepted'
  ) THEN RETURN; END IF;

  RETURN QUERY
  SELECT ci.*
  FROM public.checklist_items ci
  WHERE ci.group_id = query_group_id
    AND ci.user_id IN (
      SELECT rgm.user_id FROM public.ranking_group_members rgm
      WHERE rgm.group_id = query_group_id AND rgm.status = 'accepted'
    )
  ORDER BY ci.order_index ASC NULLS LAST, ci.created_at ASC NULLS LAST, ci.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_group_checklist(uuid) TO authenticated;
