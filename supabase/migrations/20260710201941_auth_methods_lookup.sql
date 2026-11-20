-- get_auth_methods_for_email: names the sign-in methods available for an email
-- so the auth page can hide the password field for OAuth-only accounts and push
-- them to their provider. SERVICE-ROLE ONLY (never anon/authenticated) - the only
-- caller is the rate-limited /api/auth-methods Vercel endpoint, which gates it with
-- an email-format check + per-IP rate limit. This is a deliberate, controlled
-- reversal of the "never look up an email's providers" note in lastAuthMethod.ts:
-- the enumeration surface is confined to that one throttled endpoint.
CREATE OR REPLACE FUNCTION public.get_auth_methods_for_email(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user auth.users;
BEGIN
  SELECT * INTO v_user FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('exists', false, 'has_password', false, 'providers', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'exists', true,
    'has_password', (v_user.encrypted_password IS NOT NULL AND length(v_user.encrypted_password) > 0),
    'providers', coalesce(
      (SELECT jsonb_agg(DISTINCT i.provider ORDER BY i.provider)
       FROM auth.identities i WHERE i.user_id = v_user.id),
      '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_auth_methods_for_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_methods_for_email(text) TO service_role;

-- Rollback:
--   DROP FUNCTION public.get_auth_methods_for_email(text);
