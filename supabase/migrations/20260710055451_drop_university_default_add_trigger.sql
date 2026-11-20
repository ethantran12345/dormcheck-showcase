-- Multi-university step 2: remove the single-tenant Pitt DEFAULT on university_id from all 11
-- content roots and replace it with a profile-derived BEFORE INSERT trigger. Explicit values
-- (seed scripts, service-role writers) pass through untouched; anonymous inserts with no value
-- are rejected rather than silently tagged Pitt.
-- Rollback: DROP TRIGGER trg_set_university_id ON <each table>;
--           DROP FUNCTION public.set_university_id_from_profile();
--           ALTER TABLE <each> ALTER COLUMN university_id SET DEFAULT '00000000-0000-4000-8000-000000000001';

ALTER TABLE public.building_chat_links    ALTER COLUMN university_id DROP DEFAULT;
ALTER TABLE public.buildings              ALTER COLUMN university_id DROP DEFAULT;
ALTER TABLE public.business_listings      ALTER COLUMN university_id DROP DEFAULT;
ALTER TABLE public.course_sections        ALTER COLUMN university_id DROP DEFAULT;
ALTER TABLE public.dorm_questions         ALTER COLUMN university_id DROP DEFAULT;
ALTER TABLE public.explore_picks          ALTER COLUMN university_id DROP DEFAULT;
ALTER TABLE public.marketplace_listings   ALTER COLUMN university_id DROP DEFAULT;
ALTER TABLE public.master_housing         ALTER COLUMN university_id DROP DEFAULT;
ALTER TABLE public.ranking_collaborations ALTER COLUMN university_id DROP DEFAULT;
ALTER TABLE public.roommate_search_posts  ALTER COLUMN university_id DROP DEFAULT;
ALTER TABLE public.student_setups         ALTER COLUMN university_id DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.set_university_id_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.university_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NOT NULL THEN
    SELECT p.university_id INTO NEW.university_id
    FROM public.profiles p
    WHERE p.id = auth.uid();
  END IF;
  IF NEW.university_id IS NULL THEN
    RAISE EXCEPTION 'university_id is required on % and could not be derived from the inserting user''s profile', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'building_chat_links','buildings','business_listings','course_sections',
    'dorm_questions','explore_picks','marketplace_listings','master_housing',
    'ranking_collaborations','roommate_search_posts','student_setups'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_set_university_id ON public.%I;
       CREATE TRIGGER trg_set_university_id BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.set_university_id_from_profile();',
      t, t
    );
  END LOOP;
END $$;
