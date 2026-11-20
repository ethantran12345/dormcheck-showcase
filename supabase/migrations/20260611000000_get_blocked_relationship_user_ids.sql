-- RPC: return every user id in a block relationship with the caller (either direction).
-- RLS on blocked_users only exposes rows where blocker_id = auth.uid(), so callers
-- cannot otherwise learn who blocked them.

CREATE OR REPLACE FUNCTION public.get_blocked_relationship_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT
    CASE
      WHEN b.blocker_id = auth.uid() THEN b.blocked_id
      ELSE b.blocker_id
    END
  FROM public.blocked_users b
  WHERE auth.uid() IS NOT NULL
    AND (b.blocker_id = auth.uid() OR b.blocked_id = auth.uid());
$$;

COMMENT ON FUNCTION public.get_blocked_relationship_user_ids() IS
'Returns distinct user ids in a block relationship with auth.uid() in either direction
(blocker or blocked). Empty set when not authenticated.';

REVOKE EXECUTE ON FUNCTION public.get_blocked_relationship_user_ids()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_blocked_relationship_user_ids()
  TO authenticated;
