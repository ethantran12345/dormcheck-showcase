-- Teardown Phase 2: dining domain + legacy orphan tables/views/RPC.
-- Idempotent (IF EXISTS) for local Docker (no dining-review-photos bucket) and prod.

-- a. Drop dining-review-photos storage policies (from 20260515044633_remote_schema.sql).
DROP POLICY IF EXISTS "Public can view dining review photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete dining review photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update dining review photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload dining review photos" ON storage.objects;

-- b. Remove bucket contents and bucket (no-op locally if bucket absent).
-- Requires storage.allow_delete_query session flag (storage.protect_delete trigger).
DO $$
BEGIN
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.objects WHERE bucket_id = 'dining-review-photos';
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'prefixes'
  ) THEN
    DELETE FROM storage.prefixes WHERE bucket_id = 'dining-review-photos';
  END IF;
  DELETE FROM storage.buckets WHERE id = 'dining-review-photos';
END $$;

-- c. Dining tables: children first, then parents.
DROP TABLE IF EXISTS dining_reviews CASCADE;
DROP TABLE IF EXISTS dining_upvotes CASCADE;
DROP TABLE IF EXISTS off_campus_dining_reviews CASCADE;
DROP TABLE IF EXISTS dining_spots CASCADE;
DROP TABLE IF EXISTS off_campus_dining_spots CASCADE;

-- d. Legacy save tables (no src/ consumers).
DROP TABLE IF EXISTS favorite_listings CASCADE;
DROP TABLE IF EXISTS saved_roommate_posts CASCADE;
DROP TABLE IF EXISTS saved_roommates CASCADE;
DROP SEQUENCE IF EXISTS saved_roommates_id_seq;

-- e. Orphan view and RPC.
DROP VIEW IF EXISTS master_housing_map;
DROP FUNCTION IF EXISTS get_dorm_review_stats();
