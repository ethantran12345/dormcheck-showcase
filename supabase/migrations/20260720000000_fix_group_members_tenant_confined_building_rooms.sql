-- Fix: users cannot join Community (building/floor) rooms — INSERT into group_members
-- fails with "new row violates row-level security policy tenant_confined".
--
-- Root cause: the restrictive `tenant_confined` policy on group_members confines a
-- joining member to the ROOM CREATOR's university:
--     profile_university(user_id) = profile_university(gc.created_by)
-- Community building/floor rooms are system-seeded (ensure_building_chat) with
-- created_by = NULL, so profile_university(NULL) = NULL and the check can never pass,
-- blocking every legitimate Join. User-created group chats have a real created_by and
-- were unaffected.
--
-- Fix: derive the room's tenant from the BUILDING when there is no creator.
-- COALESCE(creator's university, building's university). This preserves cross-university
-- isolation — the building's university_id is authoritative for a building room, and the
-- permissive insert policy already requires user_current_dorm_matches_building (same
-- university) — while admitting the seeded community rooms. User-created group chats keep
-- confining by creator (created_by non-null → COALESCE returns it first).
--
-- Not destructive: this only widens a restrictive policy to admit a legitimate class of
-- inserts; existing confinement behavior for user-created groups is unchanged.

DROP POLICY IF EXISTS tenant_confined ON public.group_members;
CREATE POLICY tenant_confined ON public.group_members
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.profile_university(user_id) = (
      SELECT COALESCE(
               public.profile_university(gc.created_by),
               (SELECT m.university_id
                  FROM public.master_housing m
                 WHERE m.id = gc.building_id)
             )
      FROM public.group_conversations gc
      WHERE gc.id = group_members.group_id
    )
  );
