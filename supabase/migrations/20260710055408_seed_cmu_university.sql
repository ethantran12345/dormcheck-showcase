-- Seed Carnegie Mellon University as tenant #2, INACTIVE until tenant isolation is verified
-- (handoff-cmu-multi-university-activation.md step 1). Fixed Pitt-style UUID, mirrored in
-- src/config/universities.ts as CMU_UNIVERSITY_ID.
-- Rollback: DELETE FROM public.universities WHERE slug = 'cmu';

INSERT INTO public.universities (id, slug, name, short_name, email_domains, city, is_active)
VALUES (
  '00000000-0000-4000-8000-000000000002',
  'cmu',
  'Carnegie Mellon University',
  'CMU',
  ARRAY['andrew.cmu.edu', 'cmu.edu'],
  'Pittsburgh, PA',
  false
)
ON CONFLICT (slug) DO NOTHING;
