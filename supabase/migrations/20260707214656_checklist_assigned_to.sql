-- Single-assignee ownership for shared checklist items (move-in arc handoff 2, decision 2c).
-- Expand-only: checklist_item_claims stays untouched; group-mode UI moves to assigned_to,
-- which rides the existing checklist_items realtime channel for whole-group live visibility.
-- No RLS changes: rls_checklist_items_select/update already grant accepted group members
-- read/write of group rows, which covers claiming/assigning.

ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS assigned_to uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_checklist_items_assigned_to
  ON public.checklist_items (assigned_to) WHERE assigned_to IS NOT NULL;

-- One-time backfill: carry ownership over from checklist_item_claims where it is
-- unambiguous (exactly one claim). Multi-claim items stay NULL - the single-assignee
-- model can't represent them; members re-assign in the UI.
UPDATE public.checklist_items ci
SET assigned_to = c.user_id
FROM (
  SELECT item_id, min(user_id::text)::uuid AS user_id
  FROM public.checklist_item_claims
  GROUP BY item_id
  HAVING count(*) = 1
) c
WHERE ci.id = c.item_id AND ci.assigned_to IS NULL;
