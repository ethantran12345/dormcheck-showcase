-- Checklist v2 ("Get Ready" readiness flow) - Phase 1 schema.
-- Two additive, expand-only changes to public.checklist_items:
--   1. Widen the status CHECK to add 'skip' (leave-at-home side-state). The lifecycle
--      stays need -> bought -> packed, with 'skip' as an off-list side-state. 'bought'
--      is surfaced as "Have" in the UI (own it, not yet packed) - no value rename, so
--      no data migration and old clients keep working.
--   2. Add is_night_one: flags the ~6-8 first-night essentials that pin to the top
--      "Night One kit" band. Seeded from a curated name list; user-togglable in the UI.
-- "Shared" ("a roommate is bringing it") is derived at render from assigned_to (added
-- in 20260712100000) - no column here.
-- No RLS/grants change: rls_checklist_items_* already scope to owner + accepted group
-- members, and the owner can read/write these columns automatically.
-- Expand-only. PROD APPLY: via Supabase MCP apply_migration, after 20260731080000.

-- 1. status: allow 'skip' alongside need/bought/packed.
ALTER TABLE public.checklist_items
  DROP CONSTRAINT IF EXISTS checklist_items_status_check;
ALTER TABLE public.checklist_items
  ADD CONSTRAINT checklist_items_status_check
    CHECK (status = ANY (ARRAY['need'::text, 'bought'::text, 'packed'::text, 'skip'::text]));

COMMENT ON COLUMN public.checklist_items.status IS
  'Readiness lifecycle: need -> bought (shown as "Have") -> packed; plus "skip" (leave at home). packed mirrors is_checked.';

-- 2. is_night_one: first-night-essential flag for the Night One kit band.
-- Constant default => metadata-only add on PG11+, no table rewrite.
ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS is_night_one boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.checklist_items.is_night_one IS
  'Checklist v2: true = a first-24-hours essential, pinned to the Night One kit band. Seeded from a curated name list; user-togglable.';

-- Seed: flag existing items whose name matches the curated first-night list.
-- Conservative on purpose (ILIKE keyword set, tunable) - a student can toggle anything
-- else into Night One from the UI. Only touches rows still at the default (false).
UPDATE public.checklist_items
SET is_night_one = true
WHERE is_night_one = false
  AND (
       item ILIKE '%sheet%'
    OR item ILIKE '%bedding%'
    OR item ILIKE '%pillow%'
    OR item ILIKE '%blanket%'
    OR item ILIKE '%comforter%'
    OR item ILIKE '%towel%'
    OR item ILIKE '%toiletr%'
    OR item ILIKE '%toothbrush%'
    OR item ILIKE '%shower shoe%'
    OR item ILIKE '%charger%'
    OR item ILIKE '%medication%'
    OR item ILIKE '%water bottle%'
  );
