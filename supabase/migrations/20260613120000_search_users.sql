-- Server-side user search for DM and similar flows. Matches on name or email in profiles
-- but returns only id, full_name, and avatar_url (never email or phone_number).

CREATE OR REPLACE FUNCTION public.search_users(search_query text)
RETURNS TABLE (
  id uuid,
  full_name text,
  avatar_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF search_query IS NULL OR length(trim(search_query)) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    p.avatar_url
  FROM public.profiles p
  WHERE p.id <> auth.uid()
    AND (
      p.full_name ILIKE '%' || trim(search_query) || '%'
      OR p.email ILIKE '%' || trim(search_query) || '%'
    )
  ORDER BY p.full_name NULLS LAST, p.id
  LIMIT 20;
END;
$$;

COMMENT ON FUNCTION public.search_users(text) IS
'Authenticated user search by name or email substring. Returns id, full_name, avatar_url only;
never exposes email or phone. Empty when unauthenticated or query shorter than 2 characters.';

REVOKE EXECUTE ON FUNCTION public.search_users(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.search_users(text)
  TO authenticated;
