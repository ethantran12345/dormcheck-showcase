-- SEC-6: enforce the marketplace seller-contact opt-out at the database layer.
--
-- Problem: marketplace_listings is SELECT-able by every authenticated user
-- (USING (true)), and the client read phone_number / instagram_handle /
-- snapchat_handle directly off the base table. The show_phone/show_instagram/
-- show_snapchat opt-outs were therefore only enforced in the UI - any logged-in
-- user could read a seller's contact info via the API even with the flag off.
--
-- Fix: revoke direct column access to the three contact fields from the
-- anon/authenticated PostgREST roles, and expose them ONLY through an
-- owner-rights view that returns each value only when its show_* flag is true
-- (or to the listing's owner). Mirrors the public_profiles precedent.

-- 1. Remove direct column access to the contact fields. Every other column of
--    marketplace_listings stays readable, so existing list/detail queries keep
--    working once they stop selecting these three columns (the client was
--    repointed to the view below in the same change).
REVOKE SELECT (phone_number, instagram_handle, snapchat_handle)
  ON public.marketplace_listings FROM anon, authenticated;

-- 2. Owner-rights view that masks each contact field by its opt-in flag. Runs
--    with the view owner's (postgres) privileges so it can read the now-revoked
--    base columns; auth.uid() still resolves to the calling user, so the listing
--    owner always sees their own values (needed to prefill the edit form).
DROP VIEW IF EXISTS public.marketplace_listings_contact;

CREATE VIEW public.marketplace_listings_contact AS
SELECT
  id,
  CASE WHEN show_phone     OR user_id = auth.uid() THEN phone_number     ELSE NULL END AS phone_number,
  CASE WHEN show_instagram OR user_id = auth.uid() THEN instagram_handle ELSE NULL END AS instagram_handle,
  CASE WHEN show_snapchat  OR user_id = auth.uid() THEN snapchat_handle  ELSE NULL END AS snapchat_handle
FROM public.marketplace_listings;

ALTER VIEW public.marketplace_listings_contact OWNER TO postgres;

REVOKE ALL ON public.marketplace_listings_contact FROM PUBLIC, anon;
GRANT SELECT ON public.marketplace_listings_contact TO authenticated;
GRANT SELECT ON public.marketplace_listings_contact TO service_role;

COMMENT ON VIEW public.marketplace_listings_contact IS
  'Intentional owner-rights (non-security_invoker) view. Returns a listing''s '
  'phone_number/instagram_handle/snapchat_handle only when the matching '
  'show_* flag is true, or to the listing owner (auth.uid()). Direct column '
  'SELECT on these three fields is revoked from anon/authenticated on the base '
  'table, so this view is the only read path; do not recreate with '
  'security_invoker. See SEC-6 in AUDIT_REPORT.md.';
