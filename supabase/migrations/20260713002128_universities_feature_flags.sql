-- P2 foundations: per-tenant feature toggles, productized from the hardcoded
-- University.phase1Only / featureFlags.ts constants. Expand-only.
--
-- universities.feature_flags holds a sparse jsonb of overrides, camelCase keys
-- mirroring the client FeatureFlags shape plus "phase1Only", e.g.
--   {"phase1Only": false, "showBuildingChats": true}
-- Missing keys fall back to the static config in src/config/universities.ts,
-- so '{}' (the default) changes nothing.

ALTER TABLE public.universities
  ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.universities.feature_flags IS
  'Sparse per-tenant feature-flag overrides (camelCase keys, mirrors client FeatureFlags + phase1Only). Missing keys inherit the static config default.';

-- Reads ride the existing table-level GRANT SELECT to authenticated
-- (20260707000000); table-level grants cover later-added columns.

-- Writes: table-level UPDATE on universities stays revoked (20260707000000),
-- so the only write path is this superadmin-checked RPC, which also audits.
CREATE OR REPLACE FUNCTION public.set_university_feature_flags(
  p_university_id uuid,
  p_flags jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'superadmin required';
  END IF;

  IF p_flags IS NULL OR jsonb_typeof(p_flags) <> 'object' THEN
    RAISE EXCEPTION 'feature_flags must be a json object';
  END IF;

  SELECT feature_flags INTO v_old
  FROM public.universities
  WHERE id = p_university_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown university %', p_university_id;
  END IF;

  UPDATE public.universities
  SET feature_flags = p_flags,
      updated_at = now()
  WHERE id = p_university_id;

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, university_id)
  VALUES (
    auth.uid(),
    'university.feature_flags.update',
    'universities',
    p_university_id,
    p_university_id
  );

  RETURN p_flags;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_university_feature_flags(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_university_feature_flags(uuid, jsonb) TO authenticated;
