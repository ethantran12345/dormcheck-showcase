-- Extend the manual push-broadcast audience set with 'university' — send to all
-- students at one school (profiles.university_id). Expand-only: widen the CHECK.
-- The inline CHECK from 20260729020000 is unnamed; drop whichever CHECK guards
-- audience_type (name is deterministic locally but be robust to prod divergence),
-- then re-add a canonically-named one including 'university'.
-- PROD APPLY: via Supabase MCP apply_migration, after 20260729020000.

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.push_broadcasts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%audience_type%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.push_broadcasts DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.push_broadcasts
  ADD CONSTRAINT push_broadcasts_audience_type_check
  CHECK (audience_type IN ('user', 'building', 'everyone', 'university'));
