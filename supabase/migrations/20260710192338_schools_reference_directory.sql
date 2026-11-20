-- schools + school_domains: US institution reference directory (class F, platform-global).
-- Richer successor to the flat school_directory lookup: identity comes from College
-- Scorecard/IPEDS (unitid, city, state, ownership, enrollment) and a school can have
-- many email domains. Seeded by scripts/seed-school-directory.mjs (service role).
--
-- HARD RULE: this directory NAMES schools; it never authorizes sign-in. The signup
-- gate stays universities.email_domains + validate_pitt_email (exact match, active
-- tenants only). matched_university_id is the one bridge to the tenant registry and
-- is set by operators only when a school becomes a live tenant.

CREATE TABLE public.schools (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ipeds_unitid          integer NOT NULL UNIQUE,
  name                  text NOT NULL,
  city                  text,
  state                 text,
  ownership             text,          -- 'public' | 'private_nonprofit' | 'private_forprofit'
  enrollment            integer,       -- latest undergrad size (UGDS); NULL when unreported
  matched_university_id uuid REFERENCES public.universities(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.schools IS
  'US institution reference directory (College Scorecard/IPEDS spine). Platform-global '
  'reference data - never tenant-scoped, never authorizes sign-in. matched_university_id '
  'links to the tenant registry only once a school is onboarded as a live tenant.';

CREATE INDEX idx_schools_matched_university_id
  ON public.schools (matched_university_id)
  WHERE matched_university_id IS NOT NULL;

CREATE TABLE public.school_domains (
  domain     text PRIMARY KEY,
  school_id  uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_school_domain_normalized
    CHECK (domain = lower(domain) AND domain NOT LIKE '%@%' AND domain ~ '^[a-z0-9.-]{1,255}\.[a-z]{2,}$')
);

COMMENT ON TABLE public.school_domains IS
  'Email domains per directory school (lowercase, registrable, no @). Many domains may '
  'map to one school. Read only through resolve_school_by_domain(); no client SELECT.';

CREATE INDEX idx_school_domains_school_id ON public.school_domains (school_id);

-- Locked down like school_directory: no client access at all. The narrow
-- SECURITY DEFINER RPC below is the only pre-login read surface, so clients
-- cannot enumerate the table.
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_domains ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schools FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.school_domains FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.schools TO service_role;
GRANT ALL ON public.school_domains TO service_role;

-- resolve_school_by_domain: names the school behind an email domain for the
-- auth page's waitlist branch. Progressive-subdomain-strip (student.osu.edu ->
-- osu.edu) is a deliberate divergence from the exact-match gate invariant
-- (docs/multi-university.md §2) - allowed here ONLY because this path never
-- authorizes sign-in; the gate itself stays exact-match.
CREATE OR REPLACE FUNCTION public.resolve_school_by_domain(p_domain text)
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
    RETURN NULL;
  END IF;

  -- Exact match first, then strip the leftmost label down to 2 labels.
  LOOP
    SELECT jsonb_build_object(
             'school_id', s.id,
             'name', s.name,
             'ipeds_unitid', s.ipeds_unitid,
             'matched_university_id', s.matched_university_id,
             'matched_university_active', coalesce(u.is_active, false)
           )
      INTO v_result
      FROM public.school_domains sd
      JOIN public.schools s ON s.id = sd.school_id
      LEFT JOIN public.universities u ON u.id = s.matched_university_id
     WHERE sd.domain = v_domain;

    IF v_result IS NOT NULL THEN
      RETURN v_result;
    END IF;

    EXIT WHEN array_length(string_to_array(v_domain, '.'), 1) <= 2;
    v_domain := substring(v_domain FROM position('.' IN v_domain) + 1);
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_school_by_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_school_by_domain(text) TO anon, authenticated, service_role;

-- Rollback:
--   DROP FUNCTION public.resolve_school_by_domain(text);
--   DROP TABLE public.school_domains;
--   DROP TABLE public.schools;
