-- Settings R7: Quiet hours (push-only Do Not Disturb).
--   profiles gains a per-user quiet-hours window that suppresses PUSH only.
--   Email is never affected by this (that gating stays profiles.email_notifications
--   + notification_prefs). Suppression is evaluated SERVER-SIDE in the send-push
--   edge function: push is dispatched from the server, so "is it currently quiet
--   for this user" must be computed in the recipient's own local time - hence the
--   IANA timezone column. The window is half-open [start, end) in local wall-clock
--   and may wrap midnight (e.g. 22:00 -> 08:00). The edge function fails OPEN on any
--   malformed/missing value, so quiet hours can never silently break delivery.
-- Expand-only. PROD APPLY: via Supabase MCP apply_migration, after 20260731070000.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_start    text,
  ADD COLUMN IF NOT EXISTS quiet_hours_end      text,
  ADD COLUMN IF NOT EXISTS quiet_hours_timezone text;

COMMENT ON COLUMN public.profiles.quiet_hours_enabled IS
  'Settings R7: when true, suppress PUSH during [quiet_hours_start, quiet_hours_end) in the '
  'user''s local time. Email is unaffected. Evaluated in the send-push edge function.';
COMMENT ON COLUMN public.profiles.quiet_hours_start IS
  'Settings R7: quiet-hours window start, local wall-clock "HH:MM" (24h).';
COMMENT ON COLUMN public.profiles.quiet_hours_end IS
  'Settings R7: quiet-hours window end, local wall-clock "HH:MM" (24h). May be < start (wraps midnight).';
COMMENT ON COLUMN public.profiles.quiet_hours_timezone IS
  'Settings R7: IANA timezone (e.g. America/New_York) used to evaluate the window server-side.';

-- Format guards: HH:MM 24h, or NULL. Belt-and-suspenders (the UI only writes valid
-- times from <input type="time"> and the edge function fails open on bad data).
-- NOT VALID: skip the existing-row scan/lock on prod - freshly added columns are all
-- NULL so there is nothing to validate; new writes are still enforced.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_quiet_hours_start_format
    CHECK (quiet_hours_start IS NULL OR quiet_hours_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') NOT VALID;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_quiet_hours_end_format
    CHECK (quiet_hours_end IS NULL OR quiet_hours_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') NOT VALID;

-- No grants/RLS changes: public.profiles already grants SELECT/UPDATE to authenticated
-- at the table level, and its UPDATE policy is row-scoped (id = auth.uid()), so the
-- owner can read and write these new columns automatically.
