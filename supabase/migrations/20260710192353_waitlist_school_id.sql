-- university_waitlist.school_id: tag each waitlist row with the directory school
-- resolved from the email domain, turning the waitlist into a per-school demand
-- map. Populated ONLY by the service-role join endpoint (api/join-waitlist.ts),
-- which re-resolves from the email domain server-side - client input is never
-- trusted. RLS (INSERT-only for app roles, service-role read) and the
-- set_waitlist_email_domain trigger are untouched.

ALTER TABLE public.university_waitlist
  ADD COLUMN school_id uuid REFERENCES public.schools(id);

CREATE INDEX idx_university_waitlist_school_id
  ON public.university_waitlist (school_id)
  WHERE school_id IS NOT NULL;

COMMENT ON COLUMN public.university_waitlist.school_id IS
  'Directory school resolved from email_domain at capture (schools.id); NULL when '
  'unresolved. Set server-side by /api/join-waitlist only.';

-- Rollback:
--   DROP INDEX public.idx_university_waitlist_school_id;
--   ALTER TABLE public.university_waitlist DROP COLUMN school_id;
