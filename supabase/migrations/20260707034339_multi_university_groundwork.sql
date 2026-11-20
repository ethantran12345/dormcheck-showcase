-- =====================================================================
-- Multi-university groundwork (additive only; Pitt remains sole tenant).
--
-- Adds public.universities + a seeded Pitt row, nullable university_id
-- FKs backfilled to Pitt on profiles and the 10 campus-scoped root
-- content tables, derives university_id from the signup email domain in
-- handle_new_user(), and generalizes the signup email gate to read
-- universities.email_domains (is_active only).
--
-- Deliberately NOT here (deferred to Phase 3 RBAC / university #2):
--   - RLS USING/WITH CHECK filters on university_id
--   - NOT NULL constraints on university_id
--   - role checks / admin write policies on universities
--   - renaming validate_pitt_email (would require dropping and
--     recreating the auth.users trigger)
-- Behavior is byte-identical for Pitt users after this migration.
-- Mirror invariant: the Pitt UUID below is duplicated in
-- src/config/universities.ts (PITT_UNIVERSITY_ID). Never change it.
-- =====================================================================

-- 1) universities ------------------------------------------------------

CREATE TABLE public.universities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  short_name    text NOT NULL,
  -- exact-match domains, lowercase, no '@' (subdomains do not match)
  email_domains text[] NOT NULL DEFAULT '{}',
  city          text,
  is_active     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.universities IS
  'Tenant registry. Rows are inserted by operators (service role) only; '
  'universities onboard via partnership, never self-serve. is_active gates '
  'signup email domains. Do not deactivate the last active university - '
  'that would block all signups.';

ALTER TABLE public.universities ENABLE ROW LEVEL SECURITY;

-- Strip Supabase default broad grants; signed-in users read, nobody else
-- writes (service_role bypasses RLS; admin management is Phase 3 RBAC).
REVOKE ALL ON TABLE public.universities FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.universities FROM authenticated;
GRANT SELECT ON TABLE public.universities TO authenticated;

CREATE POLICY "Authenticated users can read universities"
  ON public.universities FOR SELECT TO authenticated USING (true);

-- 2) Seed Pitt (fixed UUID mirrored in src/config/universities.ts) -----

INSERT INTO public.universities (id, slug, name, short_name, email_domains, city, is_active)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'pitt',
  'University of Pittsburgh',
  'Pitt',
  ARRAY['pitt.edu'],
  'Pittsburgh, PA',
  true
)
ON CONFLICT (slug) DO NOTHING;

-- 3) profiles.university_id (no default - handle_new_user computes it) -

ALTER TABLE public.profiles
  ADD COLUMN university_id uuid REFERENCES public.universities(id);

UPDATE public.profiles
  SET university_id = '00000000-0000-4000-8000-000000000001'
  WHERE university_id IS NULL;

CREATE INDEX idx_profiles_university_id ON public.profiles (university_id);

-- 4) Campus-scoped root content tables ---------------------------------
-- Single-tenant DEFAULT so rows inserted by clients (which don't send
-- university_id) never drift to NULL. Must be replaced by a
-- profile-derived trigger before university #2 activates.

ALTER TABLE public.master_housing
  ADD COLUMN university_id uuid REFERENCES public.universities(id)
  DEFAULT '00000000-0000-4000-8000-000000000001';
UPDATE public.master_housing
  SET university_id = '00000000-0000-4000-8000-000000000001'
  WHERE university_id IS NULL;
CREATE INDEX idx_master_housing_university_id
  ON public.master_housing (university_id);

ALTER TABLE public.marketplace_listings
  ADD COLUMN university_id uuid REFERENCES public.universities(id)
  DEFAULT '00000000-0000-4000-8000-000000000001';
UPDATE public.marketplace_listings
  SET university_id = '00000000-0000-4000-8000-000000000001'
  WHERE university_id IS NULL;
CREATE INDEX idx_marketplace_listings_university_id
  ON public.marketplace_listings (university_id);
-- marketplace_listings uses an enumerated column-level SELECT grant
-- (SEC-6, 20260622000733) - new columns are unreadable until granted.
GRANT SELECT (university_id) ON public.marketplace_listings TO authenticated;

ALTER TABLE public.business_listings
  ADD COLUMN university_id uuid REFERENCES public.universities(id)
  DEFAULT '00000000-0000-4000-8000-000000000001';
UPDATE public.business_listings
  SET university_id = '00000000-0000-4000-8000-000000000001'
  WHERE university_id IS NULL;
CREATE INDEX idx_business_listings_university_id
  ON public.business_listings (university_id);

ALTER TABLE public.roommate_search_posts
  ADD COLUMN university_id uuid REFERENCES public.universities(id)
  DEFAULT '00000000-0000-4000-8000-000000000001';
UPDATE public.roommate_search_posts
  SET university_id = '00000000-0000-4000-8000-000000000001'
  WHERE university_id IS NULL;
CREATE INDEX idx_roommate_search_posts_university_id
  ON public.roommate_search_posts (university_id);

ALTER TABLE public.dorm_questions
  ADD COLUMN university_id uuid REFERENCES public.universities(id)
  DEFAULT '00000000-0000-4000-8000-000000000001';
UPDATE public.dorm_questions
  SET university_id = '00000000-0000-4000-8000-000000000001'
  WHERE university_id IS NULL;
CREATE INDEX idx_dorm_questions_university_id
  ON public.dorm_questions (university_id);

ALTER TABLE public.student_setups
  ADD COLUMN university_id uuid REFERENCES public.universities(id)
  DEFAULT '00000000-0000-4000-8000-000000000001';
UPDATE public.student_setups
  SET university_id = '00000000-0000-4000-8000-000000000001'
  WHERE university_id IS NULL;
CREATE INDEX idx_student_setups_university_id
  ON public.student_setups (university_id);

ALTER TABLE public.building_chat_links
  ADD COLUMN university_id uuid REFERENCES public.universities(id)
  DEFAULT '00000000-0000-4000-8000-000000000001';
UPDATE public.building_chat_links
  SET university_id = '00000000-0000-4000-8000-000000000001'
  WHERE university_id IS NULL;
CREATE INDEX idx_building_chat_links_university_id
  ON public.building_chat_links (university_id);

ALTER TABLE public.explore_picks
  ADD COLUMN university_id uuid REFERENCES public.universities(id)
  DEFAULT '00000000-0000-4000-8000-000000000001';
UPDATE public.explore_picks
  SET university_id = '00000000-0000-4000-8000-000000000001'
  WHERE university_id IS NULL;
CREATE INDEX idx_explore_picks_university_id
  ON public.explore_picks (university_id);

-- Class-schedule catalog tables (landed with feat/class-navigator, after
-- the multi-university handoff was written) - campus content by the same
-- criterion as the tables above.
ALTER TABLE public.buildings
  ADD COLUMN university_id uuid REFERENCES public.universities(id)
  DEFAULT '00000000-0000-4000-8000-000000000001';
UPDATE public.buildings
  SET university_id = '00000000-0000-4000-8000-000000000001'
  WHERE university_id IS NULL;
CREATE INDEX idx_buildings_university_id
  ON public.buildings (university_id);

ALTER TABLE public.course_sections
  ADD COLUMN university_id uuid REFERENCES public.universities(id)
  DEFAULT '00000000-0000-4000-8000-000000000001';
UPDATE public.course_sections
  SET university_id = '00000000-0000-4000-8000-000000000001'
  WHERE university_id IS NULL;
CREATE INDEX idx_course_sections_university_id
  ON public.course_sections (university_id);

-- 5) handle_new_user(): derive university_id from the email domain -----
-- SELECT INTO leaves v_university_id NULL when the domain matches no
-- active university (or email is NULL) - profile creation never raises,
-- so signup can never break here.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_university_id uuid;
BEGIN
  SELECT u.id INTO v_university_id
  FROM public.universities u
  WHERE u.is_active
    AND EXISTS (
      SELECT 1 FROM unnest(u.email_domains) AS d
      WHERE lower(d) = lower(split_part(new.email, '@', 2))
    )
  LIMIT 1;

  INSERT INTO public.profiles (id, full_name, email, has_completed_onboarding, university_id)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    false,
    v_university_id
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- Re-assert hardening from 20260525032920 (CREATE OR REPLACE keeps the
-- ACL, but keep the intent explicit and idempotent).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 6) Email gate: generalized to universities.email_domains --------------
-- Function name kept (renaming requires drop/recreate of the auth.users
-- trigger check_pitt_email_on_signup - deferred to university #2).
-- Accepted set is identical to the old regex
-- '^[A-Za-z0-9._%+-]+@pitt\.edu$' while pitt.edu is the only active
-- domain: same local-part charset, exact lowercase domain equality
-- (subdomains like student.pitt.edu stay rejected). NULL emails pass,
-- as before. Rejection message stays the exact current string while
-- Pitt is the only active tenant; make it dynamic when #2 lands.

CREATE OR REPLACE FUNCTION public.validate_pitt_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_domain  text;
  v_allowed boolean;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$' THEN
    RAISE EXCEPTION 'Registration is restricted to University of Pittsburgh (@pitt.edu) email addresses only.';
  END IF;

  v_domain := lower(split_part(NEW.email, '@', 2));

  SELECT EXISTS (
    SELECT 1
    FROM public.universities u
    WHERE u.is_active
      AND EXISTS (
        SELECT 1 FROM unnest(u.email_domains) AS d
        WHERE lower(d) = v_domain
      )
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Registration is restricted to University of Pittsburgh (@pitt.edu) email addresses only.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_pitt_email() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.validate_pitt_email() IS
  'Legacy name; validates the signup email domain against '
  'universities.email_domains (is_active rows only). Rename to '
  'validate_university_email deferred until university #2 - it requires '
  'dropping and recreating the check_pitt_email_on_signup trigger on auth.users.';
