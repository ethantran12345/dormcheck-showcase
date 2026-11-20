-- P2 foundations: term-scoped membership groundwork. Schema only - nothing
-- reads this yet; future enrollment/move-in features FK into it instead of
-- free-text terms (ranking_collaborations.term stays as-is for now).

CREATE TABLE public.academic_terms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL REFERENCES public.universities(id) ON DELETE CASCADE,
  -- e.g. 'Fall 2026'
  name          text NOT NULL,
  -- stable machine key, e.g. 'fall-2026'
  code          text NOT NULL,
  starts_at     date NOT NULL,
  ends_at       date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (university_id, code),
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_academic_terms_university_dates
  ON public.academic_terms (university_id, starts_at);

ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.academic_terms FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.academic_terms TO authenticated;

CREATE POLICY "Authenticated users can read academic terms"
  ON public.academic_terms FOR SELECT TO authenticated
  USING (true);
-- Writes: superadmin console / service role only (no INSERT/UPDATE grant).

-- Registry class A (root content table with university_id): RESTRICTIVE
-- cross-tenant guard, same one-call pattern as university_resources.
SELECT public.apply_tenant_isolation('public.academic_terms');

-- Helpers future features call instead of re-deriving date math.
CREATE OR REPLACE FUNCTION public.current_term(p_university_id uuid)
RETURNS public.academic_terms
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT t FROM public.academic_terms t
  WHERE t.university_id = p_university_id
    AND current_date BETWEEN t.starts_at AND t.ends_at
  ORDER BY t.starts_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.next_term(p_university_id uuid)
RETURNS public.academic_terms
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT t FROM public.academic_terms t
  WHERE t.university_id = p_university_id
    AND t.starts_at > current_date
  ORDER BY t.starts_at ASC
  LIMIT 1;
$$;

-- Seed the first cycle for both live tenants (dates = published academic
-- calendars, term span approximated to semester boundaries).
INSERT INTO public.academic_terms (university_id, name, code, starts_at, ends_at) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Fall 2026',   'fall-2026',   '2026-08-24', '2026-12-19'),
  ('00000000-0000-4000-8000-000000000001', 'Spring 2027', 'spring-2027', '2027-01-06', '2027-05-01'),
  ('00000000-0000-4000-8000-000000000002', 'Fall 2026',   'fall-2026',   '2026-08-24', '2026-12-20'),
  ('00000000-0000-4000-8000-000000000002', 'Spring 2027', 'spring-2027', '2027-01-11', '2027-05-15')
ON CONFLICT (university_id, code) DO NOTHING;
