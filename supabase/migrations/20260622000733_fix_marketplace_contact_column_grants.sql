-- SEC-6 correction. The column-level REVOKE in 20260621130000 was a no-op:
-- `authenticated` holds a TABLE-level SELECT grant, and Postgres column REVOKE
-- cannot subtract columns from a table-wide grant - so phone_number /
-- instagram_handle / snapchat_handle were still directly selectable by any
-- authenticated user, bypassing the show_* opt-out.
--
-- Fix: drop the table-level SELECT and re-grant SELECT on only the non-contact
-- columns, so the three contact fields are unreadable from the base table and
-- the masked marketplace_listings_contact view is the only read path. Writes
-- (INSERT/UPDATE/DELETE) are unaffected; client inserts/updates do not RETURNING
-- the contact columns.

REVOKE SELECT ON public.marketplace_listings FROM authenticated;

GRANT SELECT (
  id, user_id, title, description, price, category, image_url, created_at,
  is_sublease, sublease_start, sublease_end, building_name, image_urls, condition,
  meetup_location, show_instagram, show_snapchat, utilities, is_furnished,
  has_parking, house_rules, included_utilities, additional_rules, parking, status,
  gender_preference, latitude, longitude, show_phone, price_negotiable, payment_methods
) ON public.marketplace_listings TO authenticated;
