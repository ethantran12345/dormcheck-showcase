-- SEC-6 (roommate posts). Same class of gap the marketplace SEC-6 pass closed
-- (20260621130000 / 20260622000733), never applied to roommate_search_posts.
--
-- roommate_search_posts carries contact columns (phone_number / instagram /
-- snapchat) plus per-field opt-out flags (show_phone / show_instagram /
-- show_snapchat). The flags were honored ONLY in the UI: the SELECT policy is
-- row-level (`is_active OR own`) and `authenticated` held a TABLE-level SELECT
-- grant, so any authenticated user could `select=phone_number,instagram,snapchat`
-- on every active post regardless of the flags and harvest opted-out users' PII.
--
-- Fix mirrors the marketplace pattern: drop the table-level SELECT and re-grant
-- SELECT on only the non-contact columns (so the three contact fields are
-- unreadable from the base table), then expose them through a masked
-- owner-rights view that returns each value only when its show_* flag is true or
-- to the post owner. Writes (INSERT/UPDATE/DELETE) are unaffected.
--
-- Client note: the roommate feed and cards never read the base-table
-- instagram/snapchat/phone_number columns (displayed handles come from the
-- roommate_profiles view join); the dead `instagram, snapchat` references were
-- removed from ROOMMATE_POST_EMBED_SELECT in the same change, so nothing selects
-- the revoked columns after this migration.

REVOKE SELECT ON public.roommate_search_posts FROM authenticated;

GRANT SELECT (
  id, user_id, post_type, content, budget_max, preferred_areas, move_in_semester,
  spots_total, spots_filled, is_active, interest_count, created_at, updated_at,
  address, housing_type, utilities_included, is_furnished, parking_available,
  gender_preference, additional_details, photos, show_instagram, show_snapchat,
  show_phone, room_type, lease_length, pets_allowed, smoking_allowed, laundry,
  bathroom
) ON public.roommate_search_posts TO authenticated;

-- Masked contact view: same owner-rights + show_*-gated shape as
-- marketplace_listings_contact. Returns a contact value only when the poster
-- opted in (show_* = true) or to the poster themselves.
CREATE OR REPLACE VIEW public.roommate_search_posts_contact AS
SELECT
  id,
  CASE WHEN show_phone     OR user_id = auth.uid() THEN phone_number ELSE NULL END AS phone_number,
  CASE WHEN show_instagram OR user_id = auth.uid() THEN instagram    ELSE NULL END AS instagram,
  CASE WHEN show_snapchat  OR user_id = auth.uid() THEN snapchat     ELSE NULL END AS snapchat
FROM public.roommate_search_posts;

ALTER VIEW public.roommate_search_posts_contact OWNER TO postgres;
REVOKE ALL ON public.roommate_search_posts_contact FROM PUBLIC, anon;
GRANT SELECT ON public.roommate_search_posts_contact TO authenticated, service_role;

COMMENT ON VIEW public.roommate_search_posts_contact IS
  'SEC-6 (roommate): show_*-gated masked contact for roommate_search_posts. '
  'Base-table phone_number/instagram/snapchat SELECT is revoked from authenticated; '
  'read contact through this view only. Owner sees own values regardless of flags.';
