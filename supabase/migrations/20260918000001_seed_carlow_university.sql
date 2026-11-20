-- Seed Carlow University as tenant #3, INACTIVE.
--
-- Carlow sits on Fifth Avenue in Oakland, between Pitt and CMU — the third
-- school in the shared Pittsburgh marketplace group (20260911000000).
--
-- Seeded INACTIVE on purpose, following the CMU precedent: `is_active` is what
-- the school picker, the signup gate and validate_university_email() all read,
-- so flipping it is the single switch that opens the doors. It flips only after
-- (a) the email domains below are confirmed against a real Carlow address and
-- (b) tenant isolation is re-verified in prod with three tenants present.
--
-- EMAIL DOMAINS — READ BEFORE ACTIVATING. Carlow student mailboxes are
-- documented as `username@live.carlow.edu`, with `carlow.edu` used for staff and
-- department addresses. Both are listed here for the same reason CMU carries
-- both `andrew.cmu.edu` and `cmu.edu`: a student turned away at signup is a lost
-- student, while an over-broad domain only admits staff of a school we are
-- deliberately onboarding. This was NOT verified against a live Carlow inbox —
-- confirm with one real address before `is_active` goes true.
--
-- marketplace_group is set here rather than in the group migration so that a
-- database that has not yet run this seed is unaffected by it.
--
-- Rollback: DELETE FROM public.universities WHERE slug = 'carlow';

INSERT INTO public.universities (id, slug, name, short_name, email_domains, city, is_active, marketplace_group)
VALUES (
  '00000000-0000-4000-8000-000000000003',
  'carlow',
  'Carlow University',
  'Carlow',
  ARRAY['live.carlow.edu', 'carlow.edu'],
  'Pittsburgh, PA',
  false,
  'pittsburgh'
)
ON CONFLICT (slug) DO NOTHING;
