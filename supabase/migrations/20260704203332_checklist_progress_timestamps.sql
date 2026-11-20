-- Phase 0 funnel instrumentation: persist personal-checklist milestones so
-- activation metrics are queryable server-side (previously client-computed +
-- localStorage only). Expand-only; both columns nullable, no backfill.
-- Written once via a conditional null-guard update from useChecklist.ts;
-- completion is a funnel milestone and is never un-set.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS checklist_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS checklist_completed_at timestamptz;

COMMENT ON COLUMN public.profiles.checklist_started_at IS
  'First time the user added an item to their personal checklist (funnel milestone, set once).';
COMMENT ON COLUMN public.profiles.checklist_completed_at IS
  'First time the user''s personal checklist reached 100% packed (funnel milestone, set once).';
