-- Allow 'pending' in marketplace_listings.status: seller marks a listing as
-- promised to a buyer (still visible in the feed with a Pending badge) before
-- the handoff completes and it flips to 'sold'. Expand-only CHECK relaxation.
-- STAGED: apply to LOCAL Supabase first; prod apply via MCP apply_migration.
alter table public.marketplace_listings
  drop constraint marketplace_listings_status_check;

alter table public.marketplace_listings
  add constraint marketplace_listings_status_check
  check (status = any (array['available'::text, 'pending'::text, 'sold'::text, 'under_review'::text, 'expired'::text]));
