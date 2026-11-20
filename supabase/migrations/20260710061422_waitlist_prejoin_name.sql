-- Pre-join (zero-signup) branch of get_waitlist_rank now resolves the school
-- name from public.school_directory. Follow-up to 20260722000000_school_directory:
-- a friend opening a shared /waitlist?school=rice.edu link before anyone at that
-- school has joined previously got school_name null (bare domain in the UI).
-- Name resolution only: rank stays null, count stays 0; ranking, counting, and
-- the INSERT-only RLS on university_waitlist are untouched.
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
      -- Directory name wins; crowd-sourced typed name is the fallback.
      -- max() is safe: email_domain is the directory PK, so 1:1 per group.
      coalesce(
        max(sd.university_name),
        mode() WITHIN GROUP (ORDER BY w.school_name)
      ) AS school_name,
      row_number() OVER (
        ORDER BY count(*) DESC, min(w.created_at) ASC
      )::integer AS rank
    FROM public.university_waitlist w
    LEFT JOIN public.school_directory sd ON sd.email_domain = w.email_domain
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
      -- Still resolve the name from the directory so the share-link cold
      -- start shows "Rice University", not "rice.edu".
      jsonb_build_object(
        'domain', v_domain,
        'school_name', (SELECT university_name FROM public.school_directory
                        WHERE email_domain = v_domain),  -- null if unknown domain
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

-- Rollback: re-apply the get_waitlist_rank body from
-- 20260722000000_school_directory.sql (i.e. restore the hardcoded
-- 'school_name', NULL in the NOT EXISTS branch).
