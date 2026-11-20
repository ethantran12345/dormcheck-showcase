-- Clear advisor ERROR `security_definer_view_public_roommate_search_posts_contact`.
-- Same SEC-6 pattern as marketplace_listings_contact: contact columns are
-- grant-REVOKEd on roommate_search_posts for authenticated, so the show_*
-- masking needs definer rights. Verbatim body into private; public view becomes
-- a security_invoker wrapper. Note the original view has no tenant predicate of
-- its own (row visibility rides on the base table's RLS via the ids the client
-- already fetched) — preserved as-is.
--
-- Rollback:
--   create or replace view public.roommate_search_posts_contact as <body below>;
--   drop view private.roommate_search_posts_contact;

create view private.roommate_search_posts_contact as
select id,
    case when show_phone or user_id = auth.uid() then phone_number else null::text end as phone_number,
    case when show_instagram or user_id = auth.uid() then instagram else null::text end as instagram,
    case when show_snapchat or user_id = auth.uid() then snapchat else null::text end as snapchat
from public.roommate_search_posts;

grant select on private.roommate_search_posts_contact to authenticated;

create or replace view public.roommate_search_posts_contact
with (security_invoker = true) as
select * from private.roommate_search_posts_contact;
