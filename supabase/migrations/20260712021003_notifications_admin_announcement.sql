-- Add the 'admin_announcement' in-app notification type so an admin push
-- broadcast also lands in the top-nav bell (students without push still see it).
-- Rows are written by api/admin/broadcast.ts (service role) per recipient;
-- payload carries the admin-composed { title, body, route? }. Expand-only.
-- The inline CHECK from 20260713000000 is unnamed; drop whichever CHECK guards
-- notifications.type, then re-add a canonically-named one including the new type.
-- PROD APPLY: via Supabase MCP apply_migration, after 20260729030000.

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%type%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('roommate_invite_accepted', 'building_new_residents', 'admin_announcement'));
