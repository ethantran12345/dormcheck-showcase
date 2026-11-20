-- Member invite status is per-row on ranking_group_members only.
-- ranking_collaborations.status must not cascade onto members (consent bug:
-- owners flipped to pending on invite; mass-accept of all members on one accept).

DROP TRIGGER IF EXISTS sync_member_status_trigger ON public.ranking_collaborations;

DROP FUNCTION IF EXISTS public.sync_group_status();

-- Repair owner rows corrupted when collab status was set to pending after invites.
UPDATE public.ranking_group_members
SET status = 'accepted'
WHERE role = 'owner'
  AND status IS DISTINCT FROM 'accepted';

-- Collab-level pending only fed the removed trigger; member rows hold invite state.
UPDATE public.ranking_collaborations
SET status = 'accepted'
WHERE status = 'pending';
