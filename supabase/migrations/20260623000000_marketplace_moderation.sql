-- Marketplace moderation
--
-- (1) Reject prohibited content at the DB level so the prohibited-item list
--     can't be bypassed by posting directly through the API (the client check in
--     src/lib/prohibitedContent.ts is only the friendly first pass).
-- (2) Auto-hide a listing once enough DISTINCT users report it: its status flips
--     to 'under_review', which the feed already excludes (it only shows
--     status = 'available'). Admins still see it in /admin/reports and can
--     delete it or dismiss the reports (which restores it - see app code).
--
-- Keep the prohibited pattern here in sync with src/lib/prohibitedContent.ts.

-- (1) Prohibited-content guard ------------------------------------------------
create or replace function public.reject_prohibited_listing()
returns trigger
language plpgsql
as $$
begin
  if (coalesce(new.title, '') || ' ' || coalesce(new.description, '')) ~*
     '\m(guns?|firearms?|pistols?|handguns?|rifles?|shotguns?|ammo|ammunition|silencers?|cocaine|heroin|meth|methamphetamine|fentanyl|lsd|mdma|ecstasy|ketamine|shrooms|psilocybin|adderall|xanax|percocet|oxycodone|oxycontin|escorts?|nudes|onlyfans)\M'
  then
    raise exception 'This listing mentions a prohibited item or content and cannot be posted.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_prohibited_listing on public.marketplace_listings;
create trigger trg_reject_prohibited_listing
  before insert or update of title, description on public.marketplace_listings
  for each row execute function public.reject_prohibited_listing();

-- (2) Auto-hide after N distinct reporters ------------------------------------
create or replace function public.auto_hide_reported_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reporters int;
  threshold constant int := 3;
begin
  if new.content_type <> 'marketplace_listing' then
    return new;
  end if;

  select count(distinct reporter_id) into reporters
  from public.content_reports
  where content_type = 'marketplace_listing'
    and content_id = new.content_id;

  if reporters >= threshold then
    update public.marketplace_listings
      set status = 'under_review'
      where id = new.content_id::uuid
        and status = 'available';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_auto_hide_reported_listing on public.content_reports;
create trigger trg_auto_hide_reported_listing
  after insert on public.content_reports
  for each row execute function public.auto_hide_reported_listing();
