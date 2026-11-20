-- Gated settlement-context RPC for group checklist balances.
-- Returns accepted members (with payment handles) and full group ledger rows
-- visible only to accepted ranking_group_members.

CREATE OR REPLACE FUNCTION public.get_group_checklist_settlement_context(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
  v_member_ids uuid[];
  v_result jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.check_group_access(p_group_id) THEN
    RAISE EXCEPTION 'Not authorized for this group';
  END IF;

  SELECT coalesce(array_agg(rgm.user_id ORDER BY rgm.user_id), ARRAY[]::uuid[])
  INTO v_member_ids
  FROM public.ranking_group_members rgm
  WHERE rgm.group_id = p_group_id
    AND rgm.status = 'accepted';

  SELECT jsonb_build_object(
    'members',
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'member_id', rgm.id,
            'user_id', rgm.user_id,
            'role', rgm.role,
            'full_name', p.full_name,
            'avatar_url', p.avatar_url,
            'venmo_username', p.venmo_username,
            'zelle_info', p.zelle_info
          )
          ORDER BY rgm.user_id
        )
        FROM public.ranking_group_members rgm
        JOIN public.profiles p ON p.id = rgm.user_id
        WHERE rgm.group_id = p_group_id
          AND rgm.status = 'accepted'
      ),
      '[]'::jsonb
    ),
    'payment_history',
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ph.id,
            'group_id', ph.group_id,
            'payer_id', ph.payer_id,
            'receiver_id', ph.receiver_id,
            'amount', ph.amount,
            'method', ph.method,
            'status', ph.status,
            'note', ph.note,
            'created_at', ph.created_at
          )
          ORDER BY ph.created_at DESC
        )
        FROM public.payment_history ph
        WHERE ph.group_id = p_group_id
          AND ph.payer_id = ANY (v_member_ids)
          AND ph.receiver_id = ANY (v_member_ids)
      ),
      '[]'::jsonb
    ),
    'legacy_payments',
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', cp.id,
            'group_id', cp.group_id,
            'payer_id', cp.payer_id,
            'payee_id', cp.payee_id,
            'amount', cp.amount,
            'paid_at', cp.paid_at,
            'created_at', cp.created_at
          )
          ORDER BY cp.created_at DESC
        )
        FROM public.checklist_payments cp
        WHERE cp.group_id = p_group_id
          AND cp.payer_id = ANY (v_member_ids)
          AND cp.payee_id = ANY (v_member_ids)
      ),
      '[]'::jsonb
    ),
    'payment_acks',
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'group_id', cpa.group_id,
            'debtor_id', cpa.debtor_id,
            'creditor_id', cpa.creditor_id,
            'sent_at', cpa.sent_at
          )
          ORDER BY cpa.sent_at DESC
        )
        FROM public.checklist_payment_acks cpa
        WHERE cpa.group_id = p_group_id
          AND cpa.debtor_id = ANY (v_member_ids)
          AND cpa.creditor_id = ANY (v_member_ids)
      ),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_group_checklist_settlement_context(uuid) IS
'Returns group checklist settlement context for accepted members only.
JSON contract:
{
  "members": [{ "member_id", "user_id", "role", "full_name", "avatar_url", "venmo_username", "zelle_info" }],
  "payment_history": [{ "id", "group_id", "payer_id", "receiver_id", "amount", "method", "status", "note", "created_at" }],
  "legacy_payments": [{ "id", "group_id", "payer_id", "payee_id", "amount", "paid_at", "created_at" }],
  "payment_acks": [{ "group_id", "debtor_id", "creditor_id", "sent_at" }]
}
Caller must be an accepted ranking_group_members row for p_group_id.';

REVOKE EXECUTE ON FUNCTION public.get_group_checklist_settlement_context(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_group_checklist_settlement_context(uuid)
  TO authenticated;
