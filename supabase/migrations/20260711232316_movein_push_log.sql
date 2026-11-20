-- Idempotency log for the move-in countdown cron (push handoff, phase 2b).
-- One row per (user, milestone) so a same-day cron re-run can never
-- double-send. Service-role only: RLS enabled with no client policies.
-- PROD APPLY: via Supabase MCP apply_migration, after 20260729000000.

CREATE TABLE public.movein_push_log (
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  milestone int  NOT NULL,
  sent_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, milestone)
);

ALTER TABLE public.movein_push_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.movein_push_log FROM PUBLIC, anon, authenticated;
