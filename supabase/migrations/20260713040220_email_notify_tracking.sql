-- Dedupe timestamps for two new transactional emails (expand-only):
--   1. university_waitlist.launch_notified_at - set by api/notify-school-launch.ts
--      when the "your school just launched" email is sent, so a re-run of the
--      batch never re-emails the same signup.
--   2. marketplace_listings.under_review_notified_at - set by the daily
--      listing-freshness cron (auto-hidden listings) or api/notify-listing-status.ts
--      (admin moderation) when the seller has been emailed about the current
--      review cycle. Cleared on restore so a future re-hide can notify again.
-- STAGED: apply to LOCAL Supabase first; prod apply via MCP apply_migration
-- BEFORE deploying the handlers that write these columns.

ALTER TABLE public.university_waitlist
  ADD COLUMN IF NOT EXISTS launch_notified_at timestamptz;

ALTER TABLE public.marketplace_listings
  ADD COLUMN IF NOT EXISTS under_review_notified_at timestamptz;
