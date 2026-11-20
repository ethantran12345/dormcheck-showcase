-- Allow 'under_review' in marketplace_listings.status (moderation auto-hide trigger sets it;
-- baseline CHECK only allowed available|sold, so the trigger would have failed).
alter table public.marketplace_listings
  drop constraint marketplace_listings_status_check;
alter table public.marketplace_listings
  add constraint marketplace_listings_status_check
  check (status = any (array['available'::text, 'sold'::text, 'under_review'::text]));
