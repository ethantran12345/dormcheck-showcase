-- Atomic bulk reorder for checklist_items.
--
-- Reordering used to fire one HTTP UPDATE per row. On a long list over a mobile
-- network that burst of concurrent fetches overran WebKit's connection pool and
-- some rejected with "TypeError: Load failed", surfacing as "Failed to save
-- order". This function collapses the whole reorder into a single round-trip and
-- a single atomic UPDATE statement.
--
-- SECURITY INVOKER (default): the function runs with the caller's privileges, so
-- the existing rls_checklist_items_update policy still gates every row. That
-- preserves the prior per-row behavior exactly - a user updates their own rows,
-- and an accepted group member updates co-members' rows; anything else is
-- silently filtered out of the UPDATE by RLS (never an error, never a write).
--
-- p_updates is a JSON array of { id, order_index, category? }. When category is
-- omitted (pure reorder) the row's existing category is kept; when present
-- (cross-section move) it is applied. WITH CHECK on the update policy still holds
-- because user_id / group_id are untouched.

CREATE OR REPLACE FUNCTION public.reorder_checklist_items(p_updates jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'p_updates must be a JSON array';
  END IF;

  UPDATE public.checklist_items AS ci
  SET
    order_index = u.order_index,
    category = COALESCE(u.category, ci.category)
  FROM jsonb_to_recordset(p_updates) AS u(id uuid, order_index integer, category text)
  WHERE ci.id = u.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Client-callable by signed-in users only.
REVOKE EXECUTE ON FUNCTION public.reorder_checklist_items(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reorder_checklist_items(jsonb) TO authenticated;
