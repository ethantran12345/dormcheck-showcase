-- Clear advisor ERROR `security_definer_view_public_seller_rating_stats`.
-- Verbatim body into private (the EXISTS over profiles needs definer rights to
-- read other users' university_id past own-row RLS); public view becomes a
-- security_invoker wrapper. Aggregates only (avg/count, no PII), tenant-scoped
-- via current_university_id() exactly as before. anon behavior unchanged:
-- logged-out queries already fail with 42501 (anon lacks EXECUTE on
-- current_university_id()/is_superadmin()) both before and after.
--
-- Rollback:
--   create or replace view public.seller_rating_stats as <body below>;
--   drop view private.seller_rating_stats;

create view private.seller_rating_stats as
select seller_id,
    round(avg(stars), 1) as avg_stars,
    count(*)::integer as rating_count
from public.seller_ratings sr
where exists (select 1
              from public.profiles sp
              where sp.id = sr.seller_id
                and (sp.university_id = public.current_university_id()
                     or public.is_superadmin()))
group by seller_id;

grant select on private.seller_rating_stats to authenticated, anon;

create or replace view public.seller_rating_stats
with (security_invoker = true) as
select * from private.seller_rating_stats;
