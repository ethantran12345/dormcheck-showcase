-- Multi-university step 5: generalize the signup email gate. The domain check was already
-- universities-driven (20260707000000); this renames validate_pitt_email() ->
-- validate_university_email(), check_pitt_email_on_signup -> check_university_email_on_signup,
-- and makes the rejection message list the active domains instead of hardcoding @pitt.edu.
-- Rollback: recreate the old function/trigger names from 20260707000000.

CREATE OR REPLACE FUNCTION public.validate_university_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_domain  text;
  v_allowed boolean;
  v_domains text;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(DISTINCT '@' || lower(d), ', ')
  INTO v_domains
  FROM public.universities u, unnest(u.email_domains) AS d
  WHERE u.is_active;

  IF NEW.email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$' THEN
    RAISE EXCEPTION 'Registration is restricted to supported university email addresses (%).', coalesce(v_domains, 'none configured');
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
    RAISE EXCEPTION 'Registration is restricted to supported university email addresses (%).', coalesce(v_domains, 'none configured');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS check_pitt_email_on_signup ON auth.users;
DROP TRIGGER IF EXISTS check_university_email_on_signup ON auth.users;
CREATE TRIGGER check_university_email_on_signup
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.validate_university_email();

DROP FUNCTION IF EXISTS public.validate_pitt_email();
