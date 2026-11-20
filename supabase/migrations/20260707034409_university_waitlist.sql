-- =====================================================================
-- University waitlist (public email capture).
--
-- Students whose university is not yet active (any non-active email
-- domain, including consumer domains) are routed client-side to a
-- waitlist card instead of a signup dead-end. This table backs that
-- capture. The hard signup gate (validate_pitt_email() trigger on
-- auth.users) is untouched - this is demand capture, not a signup path.
--
-- Security posture: anon + authenticated may INSERT only. No SELECT /
-- UPDATE / DELETE for either role (default-deny; service_role bypasses
-- RLS and is the only reader, for ops). Abuse control is the
-- lower(email) unique dedup + email-format CHECK; no server-side rate
-- limit (accepted tradeoff - this is a low-value write surface).
-- =====================================================================

CREATE TABLE public.university_waitlist (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  -- derived by trg_set_waitlist_email_domain (never trust the client).
  -- DEFAULT '' is never persisted - the BEFORE INSERT trigger always
  -- overwrites it - but it keeps the generated Insert type optional so
  -- clients don't have to pass a server-derived column.
  email_domain  text NOT NULL DEFAULT '',
  -- optional free text ("which school are you at") - covers consumer domains
  school_name   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_waitlist_email_format
    CHECK (email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Case-insensitive dedup: one row per email regardless of casing.
CREATE UNIQUE INDEX uniq_university_waitlist_email_lower
  ON public.university_waitlist (lower(email));

COMMENT ON TABLE public.university_waitlist IS
  'Public email capture for students whose university is not yet active. '
  'anon + authenticated may INSERT only; no SELECT/UPDATE/DELETE '
  '(default-deny). Read by service role (ops) only. Scrub for a new '
  'domain before activating that university (see docs/multi-university.md §6).';

-- BEFORE INSERT: normalize email to lowercase, derive email_domain from
-- it, and collapse a blank school_name to NULL. SECURITY DEFINER +
-- pinned search_path, matching the hardening convention in
-- 20260525032920 / 20260621120000.
CREATE FUNCTION public.set_waitlist_email_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  NEW.email_domain := split_part(NEW.email, '@', 2);
  IF NEW.school_name IS NOT NULL THEN
    NEW.school_name := nullif(trim(NEW.school_name), '');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_waitlist_email_domain()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_set_waitlist_email_domain
  BEFORE INSERT ON public.university_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.set_waitlist_email_domain();

-- RLS: INSERT-only for anon + authenticated; everything else default-deny.
ALTER TABLE public.university_waitlist ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.university_waitlist FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.university_waitlist TO anon, authenticated;
GRANT ALL ON TABLE public.university_waitlist TO service_role;

CREATE POLICY "Anyone may join the waitlist (anon)"
  ON public.university_waitlist FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anyone may join the waitlist (authenticated)"
  ON public.university_waitlist FOR INSERT TO authenticated WITH CHECK (true);
