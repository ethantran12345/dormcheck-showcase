-- Email suppression list (expand-only). api/events.ts upserts an address here
-- on a Resend hard bounce (email.bounced, type Permanent/Undetermined) or spam
-- complaint (email.complained). Broadcast/marketing sends (notify-school-launch
-- and future) filter recipients against this table before sending; transactional
-- auth mail is NOT filtered (a bounce there is its own signal).
-- Service-role only: RLS enabled with no policies (default-deny), class F.
-- STAGED: apply to LOCAL Supabase first; prod apply via MCP apply_migration
-- BEFORE deploying the webhook/handler code that reads and writes it.

CREATE TABLE IF NOT EXISTS public.email_suppressions (
  email text PRIMARY KEY CHECK (email = lower(email)),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_suppressions FROM anon, authenticated;
