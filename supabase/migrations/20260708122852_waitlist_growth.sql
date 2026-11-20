-- =====================================================================
-- Waitlist growth loop: school-rank aggregates RPC + admin outreach
-- lead capture.
--
-- 1) get_waitlist_rank(p_domain): anon-callable SECURITY DEFINER RPC
--    returning ONLY per-school aggregates from university_waitlist
--    (counts + rank + a nearby prev/self/next trio). Never returns
--    emails or any row-level data. university_waitlist RLS stays
--    INSERT-only; this function is the sole read path for clients.
--
-- 2) university_admin_leads: housing-office / student-gov contacts a
--    waitlisted student chooses to loop in. B2B contact data provided
--    by a student - anon + authenticated may INSERT only; no
--    SELECT/UPDATE/DELETE (default-deny; service_role is the only
--    reader - this feeds the partnership pipeline, nothing else).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Rank aggregates RPC
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_waitlist_rank(p_domain text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_domain text := lower(trim(p_domain));
  v_result jsonb;
BEGIN
  -- Reject garbage early.
  IF v_domain IS NULL
     OR v_domain !~ '^[a-z0-9.-]{1,255}\.[a-z]{2,}$' THEN
    RETURN jsonb_build_object('domain', p_domain, 'error', 'invalid_domain');
  END IF;

  -- Ranked per-domain aggregates, excluding already-active universities.
  -- Ties break by earliest signup so ranks are stable and deterministic.
  WITH ranked AS (
    SELECT
      w.email_domain AS domain,
      count(*)::integer AS signup_count,
      mode() WITHIN GROUP (ORDER BY w.school_name) AS school_name,
      row_number() OVER (
        ORDER BY count(*) DESC, min(w.created_at) ASC
      )::integer AS rank
    FROM public.university_waitlist w
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.universities u, unnest(u.email_domains) AS d
      WHERE u.is_active AND lower(d) = w.email_domain
    )
    GROUP BY w.email_domain
  ),
  totals AS (SELECT count(*)::integer AS total_schools FROM ranked),
  self AS (SELECT * FROM ranked WHERE domain = v_domain)
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM self) THEN
      -- Domain not on the list yet (friend landing pre-join, or typo).
      jsonb_build_object(
        'domain', v_domain,
        'school_name', NULL,
        'rank', NULL,
        'count', 0,
        'total_schools', (SELECT total_schools FROM totals),
        'nearby', '[]'::jsonb
      )
    ELSE
      (SELECT jsonb_build_object(
        'domain', s.domain,
        'school_name', s.school_name,
        'rank', s.rank,
        'count', s.signup_count,
        'total_schools', (SELECT total_schools FROM totals),
        'nearby', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'domain', r.domain,
            'school_name', r.school_name,
            'rank', r.rank,
            'count', r.signup_count
          ) ORDER BY r.rank), '[]'::jsonb)
          FROM ranked r
          WHERE r.rank BETWEEN s.rank - 1 AND s.rank + 1
        )
      ) FROM self s)
  END INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_waitlist_rank(text) IS
  'Waitlist aggregates for one school domain: rank (by signup count, '
  'ties by earliest signup), count, total schools, and a prev/self/next '
  'nearby trio. School-level aggregates only - never returns emails or '
  'row-level data. Anon-callable read path for /waitlist; the table '
  'itself stays INSERT-only.';

REVOKE EXECUTE ON FUNCTION public.get_waitlist_rank(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_waitlist_rank(text) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) Admin / student-gov lead capture
-- ---------------------------------------------------------------------
CREATE TABLE public.university_admin_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- derived by trg_normalize_admin_lead (never trust the client).
  school_domain     text NOT NULL DEFAULT '',
  admin_name        text NOT NULL,
  admin_role        text,
  admin_email       text NOT NULL,
  -- the waitlisted student who looped this contact in (nullable - the
  -- visitor may not have shared their own email on the page).
  referred_by_email text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_admin_lead_email_format
    CHECK (admin_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT chk_admin_lead_referrer_format
    CHECK (referred_by_email IS NULL
           OR referred_by_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT chk_admin_lead_name_len CHECK (char_length(admin_name) BETWEEN 1 AND 200),
  CONSTRAINT chk_admin_lead_role_len CHECK (admin_role IS NULL OR char_length(admin_role) <= 200)
);

COMMENT ON TABLE public.university_admin_leads IS
  'Housing-office / student-government contacts submitted by waitlisted '
  'students advocating for DormCheck at their school. anon + '
  'authenticated may INSERT only; no SELECT/UPDATE/DELETE '
  '(default-deny). Read by service role only - partnership pipeline.';

-- BEFORE INSERT: normalize emails, derive school_domain from the
-- referring student''s email when present, else from admin email.
CREATE FUNCTION public.normalize_admin_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.admin_email := lower(trim(NEW.admin_email));
  IF NEW.referred_by_email IS NOT NULL THEN
    NEW.referred_by_email := nullif(lower(trim(NEW.referred_by_email)), '');
  END IF;
  NEW.school_domain := lower(trim(NEW.school_domain));
  IF NEW.school_domain = '' THEN
    NEW.school_domain := split_part(
      coalesce(NEW.referred_by_email, NEW.admin_email), '@', 2);
  END IF;
  NEW.admin_name := trim(NEW.admin_name);
  IF NEW.admin_role IS NOT NULL THEN
    NEW.admin_role := nullif(trim(NEW.admin_role), '');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.normalize_admin_lead()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_normalize_admin_lead
  BEFORE INSERT ON public.university_admin_leads
  FOR EACH ROW EXECUTE FUNCTION public.normalize_admin_lead();

-- RLS: INSERT-only for anon + authenticated; everything else default-deny.
ALTER TABLE public.university_admin_leads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.university_admin_leads FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.university_admin_leads TO anon, authenticated;
GRANT ALL ON TABLE public.university_admin_leads TO service_role;

CREATE POLICY "Anyone may submit an admin lead (anon)"
  ON public.university_admin_leads FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anyone may submit an admin lead (authenticated)"
  ON public.university_admin_leads FOR INSERT TO authenticated WITH CHECK (true);

-- Ops convenience for the pipeline (service-role reads).
CREATE INDEX idx_admin_leads_school_domain
  ON public.university_admin_leads (school_domain, created_at DESC);
