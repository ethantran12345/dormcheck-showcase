-- Parent / family checklist share links (handoff-checklist-parent-share-link).
-- Expand-only. A student shares their group move-in checklist with a non-user
-- (a parent) via an unguessable token link: the guest reads the list and checks
-- off items through anon-callable SECURITY DEFINER RPCs. Deliberately separate
-- from ranking_collaborations.invite_code - a family token must never grant
-- group membership, create an auth user, or expose PII/money data.
-- Registry: class B, parent ranking_collaborations (table-classification.json).
-- PROD APPLY: via Supabase MCP apply_migration, after 20260729040000.

CREATE TABLE public.checklist_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.ranking_collaborations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  label text,
  can_check boolean NOT NULL DEFAULT true,
  revoked boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_checklist_share_links_group_id
  ON public.checklist_share_links (group_id);

ALTER TABLE public.checklist_share_links ENABLE ROW LEVEL SECURITY;
-- Guests never touch this table directly; they go through the token RPCs below.
REVOKE ALL ON TABLE public.checklist_share_links FROM PUBLIC, anon;

-- Accepted group members manage their group's links (mirror of the
-- checklist_items accepted-membership pattern).
CREATE POLICY rls_checklist_share_links_select ON public.checklist_share_links
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ranking_group_members rgm
    WHERE rgm.group_id = checklist_share_links.group_id
      AND rgm.user_id = (SELECT auth.uid())
      AND rgm.status = 'accepted'
  ));

CREATE POLICY rls_checklist_share_links_insert ON public.checklist_share_links
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.ranking_group_members rgm
      WHERE rgm.group_id = checklist_share_links.group_id
        AND rgm.user_id = (SELECT auth.uid())
        AND rgm.status = 'accepted'
    )
  );

CREATE POLICY rls_checklist_share_links_update ON public.checklist_share_links
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ranking_group_members rgm
    WHERE rgm.group_id = checklist_share_links.group_id
      AND rgm.user_id = (SELECT auth.uid())
      AND rgm.status = 'accepted'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ranking_group_members rgm
    WHERE rgm.group_id = checklist_share_links.group_id
      AND rgm.user_id = (SELECT auth.uid())
      AND rgm.status = 'accepted'
  ));

-- Tenant isolation (class B): row visible only when the parent group is
-- visible under ranking_collaborations' own tenant policy.
CREATE POLICY tenant_isolation ON public.checklist_share_links
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ranking_collaborations c
    WHERE c.id = checklist_share_links.group_id
  ));

-- Guest read: group name, owner first name, and buy-relevant item fields only.
-- Never returns user ids, emails, venmo/zelle, or split/balance data.
-- Invalid, revoked, or expired token -> NULL (callers show one inactive state).
CREATE FUNCTION public.get_shared_checklist(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_link public.checklist_share_links%ROWTYPE;
  v_group_name text;
  v_owner_first_name text;
BEGIN
  SELECT * INTO v_link
  FROM public.checklist_share_links
  WHERE token = p_token
    AND revoked = false
    AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT c.group_name, split_part(coalesce(op.full_name, ''), ' ', 1)
  INTO v_group_name, v_owner_first_name
  FROM public.ranking_collaborations c
  LEFT JOIN public.profiles op ON op.id = c.owner_id
  WHERE c.id = v_link.group_id;

  RETURN jsonb_build_object(
    'group_name', v_group_name,
    'owner_first_name', nullif(v_owner_first_name, ''),
    'can_check', v_link.can_check,
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ci.id,
        'item', ci.item,
        'category', ci.category,
        'status', ci.status,
        'is_checked', ci.is_checked,
        'estimated_price', ci.estimated_price,
        'link', ci.link,
        'link_title', ci.link_title,
        'link_image', ci.link_image,
        'order_index', ci.order_index,
        'assignee_name', ap.full_name
      ) ORDER BY ci.category, ci.order_index, ci.created_at)
      FROM public.checklist_items ci
      LEFT JOIN public.profiles ap ON ap.id = ci.assigned_to
      WHERE ci.group_id = v_link.group_id
    ), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.get_shared_checklist(uuid) IS
  'Token-scoped guest read of one group checklist (parent share link). Anon-callable by design; returns no PII or payment data.';

-- Guest check-off: flip one item''s status within the token''s group only.
CREATE FUNCTION public.set_shared_item_status(p_token uuid, p_item_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_link public.checklist_share_links%ROWTYPE;
BEGIN
  IF p_status NOT IN ('need', 'bought', 'packed') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  SELECT * INTO v_link
  FROM public.checklist_share_links
  WHERE token = p_token
    AND revoked = false
    AND (expires_at IS NULL OR expires_at > now());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;
  IF NOT v_link.can_check THEN
    RAISE EXCEPTION 'read_only_link';
  END IF;

  -- is_checked mirrors 'packed', matching the app's status semantics.
  UPDATE public.checklist_items
  SET status = p_status,
      is_checked = (p_status = 'packed')
  WHERE id = p_item_id
    AND group_id = v_link.group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_in_group';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_shared_item_status(uuid, uuid, text) IS
  'Token-scoped guest status update on one group checklist item (parent share link). Anon-callable by design.';

-- Member-side management. RLS on checklist_share_links enforces accepted
-- membership; SECURITY INVOKER so the policies apply to the caller.
CREATE FUNCTION public.create_checklist_share_link(p_group_id uuid, p_label text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_token uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  INSERT INTO public.checklist_share_links (group_id, created_by, label)
  VALUES (p_group_id, auth.uid(), nullif(btrim(coalesce(p_label, '')), ''))
  RETURNING token INTO v_token;
  RETURN v_token;
END;
$$;

CREATE FUNCTION public.revoke_checklist_share_link(p_token uuid)
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  UPDATE public.checklist_share_links
  SET revoked = true
  WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_shared_checklist(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_shared_item_status(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_checklist_share_link(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_checklist_share_link(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shared_checklist(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_shared_item_status(uuid, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_checklist_share_link(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_checklist_share_link(uuid) TO authenticated, service_role;
