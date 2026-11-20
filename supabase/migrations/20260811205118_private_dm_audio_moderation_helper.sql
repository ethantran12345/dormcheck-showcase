-- Move the DM-audio authorization predicate out of the API-exposed schema.
-- This file deliberately converges both orders:
--   * on a clean replay it runs before the dated source migration, whose final
--     definition is already private; and
--   * on production it replaces the earlier public helper and read policy.
-- RLS expressions enforce EXECUTE as the querying role, so authenticated keeps
-- only the exact private-schema USAGE/EXECUTE needed to evaluate the policy.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.can_moderate_reported_dm_audio(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.content_reports cr
    JOIN public.messages m ON m.report_uuid = cr.content_id
    JOIN public.profiles moderator ON moderator.id = auth.uid()
    WHERE cr.content_type = 'dm_message'
      AND m.metadata ->> 'type' = 'audio'
      AND m.metadata ->> 'path' = p_path
      AND moderator.is_admin = true
      AND (
        public.is_superadmin()
        OR public.profile_university(m.sender_id) = public.current_university_id()
      )
  );
END;
$function$;

REVOKE ALL ON FUNCTION private.can_moderate_reported_dm_audio(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_moderate_reported_dm_audio(text) TO authenticated;

DROP POLICY IF EXISTS "DM participants can read private audio" ON storage.objects;
CREATE POLICY "DM participants can read private audio" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'dm-audio'
    AND (
      EXISTS (
        SELECT 1
        FROM public.conversations c
        WHERE c.id::text = (storage.foldername(name))[1]
          AND (c.participant_1 = auth.uid() OR c.participant_2 = auth.uid())
      )
      OR private.can_moderate_reported_dm_audio(storage.objects.name)
    )
  );

DROP FUNCTION IF EXISTS public.can_moderate_reported_dm_audio(text);
