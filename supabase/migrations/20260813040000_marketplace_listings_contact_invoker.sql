-- Clear advisor ERROR `security_definer_view_public_marketplace_listings_contact`.
-- The show_* conditional column masking needs definer rights (contact columns
-- are grant-REVOKEd on marketplace_listings for authenticated — SEC-6). Verbatim
-- body into private; public view becomes a security_invoker wrapper. Owner
-- always sees own contact; others only when show_* is true; tenant scope and
-- superadmin branch unchanged. anon behavior unchanged:
-- logged-out queries already fail with 42501 (anon lacks EXECUTE on
-- current_university_id()) both before and after.
--
-- Rollback:
--   create or replace view public.marketplace_listings_contact as <body below>;
--   drop view private.marketplace_listings_contact;

create view private.marketplace_listings_contact as
select id,
    case when show_phone or user_id = auth.uid() then phone_number else null::text end as phone_number,
    case when show_instagram or user_id = auth.uid() then instagram_handle else null::text end as instagram_handle,
    case when show_snapchat or user_id = auth.uid() then snapchat_handle else null::text end as snapchat_handle
from public.marketplace_listings
where university_id = public.current_university_id()
  or user_id = auth.uid()
  or public.is_superadmin();

grant select on private.marketplace_listings_contact to authenticated, anon;

create or replace view public.marketplace_listings_contact
with (security_invoker = true) as
select * from private.marketplace_listings_contact;
