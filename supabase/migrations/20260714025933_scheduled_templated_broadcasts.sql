-- Feature: scheduled + templated operator broadcasts (superadmin-only additions).
-- Expand-only. Builds on push_broadcasts + the shipped 'university' audience.
-- Sender stays operator (superadmin); university_admin immediate-send is untouched
-- and is NOT extended to scheduling/templates.
-- PROD APPLY: local Docker test -> apply_migration to remote -> commit.

-- ---------------------------------------------------------------------------
-- 1. Reusable announcement templates. Superadmin-only; all CRUD goes through
--    api/admin/broadcast-templates.ts (service role + server-side superadmin
--    check), so the table is RLS default-deny (service-role only) - matching the
--    admin_email_log / email_suppressions pattern.
-- ---------------------------------------------------------------------------
CREATE TABLE public.broadcast_templates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  title                  text NOT NULL,
  body                   text NOT NULL,
  category               text NOT NULL DEFAULT 'announcements',
  default_audience_type  text CHECK (default_audience_type IS NULL
                            OR default_audience_type IN ('user', 'building', 'university', 'everyone')),
  default_audience_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.broadcast_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.broadcast_templates FROM PUBLIC, anon, authenticated;
-- No policies: default-deny. The service-role client bypasses RLS; the endpoint
-- enforces superadmin. (Mirrors admin_email_log / email_suppressions.)

-- ---------------------------------------------------------------------------
-- 2. Scheduling on push_broadcasts. A future-dated send writes a 'scheduled'
--    row (dispatched later by the cron); an immediate send stays 'sent'.
-- ---------------------------------------------------------------------------
ALTER TABLE public.push_broadcasts
  ADD COLUMN scheduled_for timestamptz,
  ADD COLUMN status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'scheduled', 'canceled'));

-- Cron claim query hits only due, still-scheduled rows.
CREATE INDEX idx_push_broadcasts_due
  ON public.push_broadcasts (scheduled_for)
  WHERE status = 'scheduled';
