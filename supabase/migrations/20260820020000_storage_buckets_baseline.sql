-- Storage buckets under version control (gap found 2026-07-20 by the audit:app crawl).
--
-- PROBLEM: every storage bucket was created by hand in the Supabase dashboard.
-- No migration INSERTed the bucket rows - the migrations only ever defined their
-- RLS policies (see 20260515044633_remote_schema.sql for the storage.objects
-- policies, 20260624010000 for the size/MIME UPDATEs). So a migration-only stack
-- (disaster recovery, staging, a second university tenant) came up with ZERO
-- buckets and every upload died on "Bucket not found". This migration codifies
-- the bucket rows so a fresh stack is reproducible from git alone.
--
-- GROUND TRUTH = prod (project abcdefghijklmnopqrst), read 2026-07-20. Values
-- below mirror prod storage.buckets EXACTLY (public flag, file_size_limit,
-- allowed_mime_types). Do NOT "correct" them here - if a setting looks wrong,
-- change it in prod + re-mirror, don't diverge git from prod.
--
-- SCOPE: only the 9 buckets that no migration creates. listing-verifications is
-- ALREADY versioned (20260712220332_listing_verifications.sql) - not re-added.
-- All storage.objects POLICIES are already versioned too, so none are added here;
-- this migration is bucket rows only.
--
-- DRIFT NOTE (reported to Ethan): ensureBuckets() in scripts/e2e/seed-test-users.mjs
-- listed 11 buckets - two ghosts (dorm-setups never existed in prod;
-- dining-review-photos was torn down in 20260613260000) and it omitted templates.
-- Prod's real count is 10 (9 here + listing-verifications). Code mirrors prod, not
-- ensureBuckets().
--
-- Idempotent: ON CONFLICT (id) DO NOTHING makes this a safe no-op against prod,
-- where all rows already exist.

-- ── Image display buckets: public read, 10 MB cap, image MIME types only ─────
-- (mirrors the size/MIME UPDATE in 20260624010000_security_pass_3_hardening.sql)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('avatars',              'avatars',              true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']),
  ('business-banners',     'business-banners',     true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']),
  ('business-logos',       'business-logos',       true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']),
  ('dorm-photos',          'dorm-photos',          true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']),
  ('marketplace-images',   'marketplace-images',   true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']),
  ('roommate-post-photos', 'roommate-post-photos', true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']),
  ('setup-photos',         'setup-photos',         true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'])
ON CONFLICT (id) DO NOTHING;

-- ── academic-planners: PRIVATE (set in 20260629045101), 15 MB, images + PDF ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('academic-planners', 'academic-planners', false, 15728640,
   ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- ── templates: public read, no size/MIME cap (service-role/dashboard managed;
--    no storage.objects policy references it - public read via getPublicUrl) ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('templates', 'templates', true, NULL, NULL)
ON CONFLICT (id) DO NOTHING;
