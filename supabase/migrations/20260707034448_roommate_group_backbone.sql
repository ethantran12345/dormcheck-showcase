-- Roommate group backbone: generalize the collaboration-group primitive.
-- Expand-only. A confirmed roommate group is a ranking_collaborations row with
-- group_type = 'roommate'; it backs the checklist collaboration group directly
-- (checklist_items.group_id FK and RLS are type-agnostic).
-- PROD APPLY: via Supabase MCP apply_migration, sequenced AFTER
-- 20260707000000 (universities table), 20260708000000, 20260709000000.

ALTER TABLE public.ranking_collaborations
  ADD COLUMN group_type text NOT NULL DEFAULT 'checklist'
    CHECK (group_type IN ('checklist', 'ranking', 'roommate')),
  ADD COLUMN dorm_name text,
  ADD COLUMN unit_label text,
  ADD COLUMN term text,
  ADD COLUMN university_id uuid REFERENCES public.universities(id)
    DEFAULT '00000000-0000-4000-8000-000000000001';

UPDATE public.ranking_collaborations
SET university_id = '00000000-0000-4000-8000-000000000001'
WHERE university_id IS NULL;

CREATE INDEX idx_ranking_collaborations_group_type
  ON public.ranking_collaborations (group_type);
CREATE INDEX idx_ranking_collaborations_university_id
  ON public.ranking_collaborations (university_id);

-- Extend create_ranking_group with typed-group + roommate scoping params.
-- CREATE OR REPLACE would leave the old (text, uuid[]) signature as a second
-- overload, making existing named-arg PostgREST calls ambiguous ("function is
-- not unique"). Drop it first (same pattern as 20260525032920), then recreate
-- with defaulted trailing params so existing 2-arg callers resolve unchanged.
DROP FUNCTION IF EXISTS public.create_ranking_group(text, uuid[]);

CREATE FUNCTION public.create_ranking_group(
  p_group_name text DEFAULT NULL,
  p_member_ids uuid[] DEFAULT '{}',
  p_group_type text DEFAULT 'checklist',
  p_dorm_name text DEFAULT NULL,
  p_unit_label text DEFAULT NULL,
  p_term text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_group_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_group_type NOT IN ('checklist', 'ranking', 'roommate') THEN
    RAISE EXCEPTION 'Invalid group type';
  END IF;

  INSERT INTO public.ranking_collaborations
    (owner_id, collaborator_id, group_name, status, group_type,
     dorm_name, unit_label, term, university_id)
  VALUES
    (v_uid, NULL, NULLIF(TRIM(p_group_name), ''), 'accepted', p_group_type,
     NULLIF(TRIM(p_dorm_name), ''), NULLIF(TRIM(p_unit_label), ''),
     NULLIF(TRIM(p_term), ''),
     COALESCE((SELECT university_id FROM public.profiles WHERE id = v_uid),
              '00000000-0000-4000-8000-000000000001'))
  RETURNING id INTO v_group_id;

  INSERT INTO public.ranking_group_members (group_id, user_id, status, role)
  SELECT v_group_id, v_uid, 'accepted', 'owner'
  UNION ALL
  SELECT v_group_id, u, 'pending', 'collaborator'
  FROM unnest(p_member_ids) AS u
  WHERE u IS NOT NULL AND u != v_uid
  ON CONFLICT (user_id, group_id) DO NOTHING;

  RETURN v_group_id;
END;
$function$;

-- Grants do not carry over to the new signature.
REVOKE EXECUTE ON FUNCTION public.create_ranking_group(text, uuid[], text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ranking_group(text, uuid[], text, text, text, text)
  TO authenticated, service_role;
