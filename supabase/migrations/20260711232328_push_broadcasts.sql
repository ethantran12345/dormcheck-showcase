-- Audit trail for manual admin push broadcasts (push handoff, phase 3).
-- Rows are written by api/admin/broadcast.ts (service role) after each send;
-- superadmins can read the history. No client writes.
-- PROD APPLY: via Supabase MCP apply_migration, after 20260729010000.

CREATE TABLE public.push_broadcasts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  audience_type   text NOT NULL CHECK (audience_type IN ('user', 'building', 'everyone')),
  audience_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  title           text NOT NULL,
  body            text NOT NULL,
  route           text,
  sent_count      int NOT NULL DEFAULT 0,
  failed_count    int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_broadcasts_created ON public.push_broadcasts (created_at DESC);

ALTER TABLE public.push_broadcasts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_broadcasts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.push_broadcasts TO authenticated;

CREATE POLICY "Superadmins can view broadcast history"
  ON public.push_broadcasts FOR SELECT
  USING (public.is_superadmin());
