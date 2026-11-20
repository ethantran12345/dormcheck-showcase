-- Security queue: the two candidates that flipped from "false positive" to
-- confirmed on re-verification (2026-08-02).
--
-- 1. ranking_collaborations DELETE: "Members can delete their group" used
--    get_my_all_group_ids(), whose body deliberately includes PENDING invites
--    ("we REMOVED AND status = 'accepted' so pending invites are included").
--    That is correct for *viewing* a group you were invited to; it is wrong
--    for deleting it. An invitee who never accepted could delete the owner's
--    entire collaboration. Narrowed to accepted members via the existing
--    get_my_accepted_group_ids() helper. Owners keep DELETE through the
--    separate permissive "Owners can view/edit their groups" (FOR ALL) policy,
--    but it is named explicitly here so this policy is correct standing alone.
--
-- 2. seller_ratings UPDATE: the policy had a WITH CHECK, but it constrained
--    only rater_id — never seller_id. A rater could update their own row and
--    move seller_id to a different seller, retargeting a rating (e.g. 1 star)
--    at someone they never transacted with, bypassing the INSERT policy's
--    has_accepted_conversation_between() requirement. Trap: a WITH CHECK that
--    names one column is not a value gate for the others. Frozen with a
--    trigger rather than a policy predicate, because a policy cannot reference
--    OLD — and the trigger keeps working if the policy is later rewritten.

-- ── 1. Ranking group delete: accepted members (or the owner) only ────────────
DROP POLICY IF EXISTS "Members can delete their group" ON public.ranking_collaborations;
CREATE POLICY "Members can delete their group"
  ON public.ranking_collaborations
  FOR DELETE
  TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR id IN (SELECT public.get_my_accepted_group_ids())
  );

-- ── 2. seller_ratings: freeze the rating's target on UPDATE ─────────────────
CREATE OR REPLACE FUNCTION public.protect_seller_rating_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service-role / direct SQL paths bypass RLS by design; don't break them.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Restoring OLD (rather than raising) keeps a benign star/comment edit
  -- working unchanged, and makes retargeting a silent no-op.
  NEW.seller_id := OLD.seller_id;
  NEW.rater_id  := OLD.rater_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_seller_rating_target ON public.seller_ratings;
CREATE TRIGGER protect_seller_rating_target
  BEFORE UPDATE ON public.seller_ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_seller_rating_target();

-- Defense in depth: state the target column in the policy check too, so the
-- intent is visible where a reviewer looks first.
DROP POLICY IF EXISTS rls_seller_ratings_update ON public.seller_ratings;
CREATE POLICY rls_seller_ratings_update
  ON public.seller_ratings
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = rater_id)
  WITH CHECK (
    (SELECT auth.uid()) = rater_id
    AND public.has_accepted_conversation_between(rater_id, seller_id)
  );
