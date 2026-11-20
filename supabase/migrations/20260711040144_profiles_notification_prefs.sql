-- Per-category notification preferences on profiles.
-- Shape: { email: {<category>: bool}, push: {<category>: bool} }
-- Missing key = enabled, so the '{}' default means "all on".
-- profiles.email_notifications remains the master email kill-switch
-- (checked first; category keys refine it). Push is NOT gated by the master.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.notification_prefs IS
  'Per-category notification prefs {email:{...},push:{...}}; missing key = enabled. email_notifications remains the master email kill-switch.';

-- Backfill: users who opted out of all email keep that meaning per-category
UPDATE public.profiles
SET notification_prefs = jsonb_build_object('email', jsonb_build_object(
  'messages', false, 'message_requests', false, 'roommate_invites', false,
  'ranking_invites', false, 'housing_groups', false, 'marketplace', false))
WHERE email_notifications = false;
