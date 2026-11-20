-- Deep-review follow-up: move admin scorecard aggregation into Postgres and
-- support the measured listing/waitlist query predicates with narrow indexes.
-- All exposed functions are service-role-only; Edge code remains responsible
-- for JWT verification and admin/university authorization.

CREATE OR REPLACE FUNCTION public.get_admin_metrics(p_university_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH
  bounds AS (
    SELECT
      now() AS current_time,
      now() - interval '7 days' AS week_ago,
      now() - interval '14 days' AS two_weeks_ago,
      now() - interval '56 days' AS series_start
  ),
  scoped_profiles AS MATERIALIZED (
    SELECT p.id, p.email, p.graduation_year, p.current_dorm, p.created_at
    FROM public.profiles p
    WHERE p_university_id IS NULL OR p.university_id = p_university_id
  ),
  scoped_events AS MATERIALIZED (
    SELECT e.user_id, e.event_name, e.created_at
    FROM public.analytics_events e
    JOIN scoped_profiles p ON p.id = e.user_id
  ),
  event_rollup AS (
    SELECT
      count(DISTINCT e.user_id) FILTER (WHERE e.created_at >= b.week_ago)::integer AS active_this_week,
      count(DISTINCT e.user_id) FILTER (
        WHERE e.created_at >= b.two_weeks_ago AND e.created_at < b.week_ago
      )::integer AS active_prior_week,
      count(*) FILTER (
        WHERE e.event_name IN (
          'listing_created', 'message_sent', 'onboarding_completed',
          'checklist_started', 'checklist_completed', 'handoff_completed'
        ) AND e.created_at >= b.week_ago
      )::integer AS core_actions_this_week,
      count(*) FILTER (
        WHERE e.event_name IN (
          'listing_created', 'message_sent', 'onboarding_completed',
          'checklist_started', 'checklist_completed', 'handoff_completed'
        ) AND e.created_at >= b.two_weeks_ago AND e.created_at < b.week_ago
      )::integer AS core_actions_prior_week,
      count(DISTINCT e.user_id) FILTER (
        WHERE e.event_name IN (
          'listing_created', 'message_sent', 'onboarding_completed',
          'checklist_started', 'checklist_completed', 'handoff_completed'
        )
      )::integer AS activated_ever
    FROM scoped_events e
    CROSS JOIN bounds b
  ),
  returning_users AS (
    SELECT count(*)::integer AS value
    FROM (
      SELECT e.user_id
      FROM scoped_events e
      CROSS JOIN bounds b
      GROUP BY e.user_id
      HAVING bool_or(e.created_at >= b.week_ago)
         AND bool_or(e.created_at < b.week_ago)
    ) active_then_returning
  ),
  profile_rollup AS (
    SELECT
      count(*)::integer AS total_users,
      count(*) FILTER (WHERE p.created_at >= b.week_ago)::integer AS signups_this_week,
      count(*) FILTER (
        WHERE p.created_at >= b.two_weeks_ago AND p.created_at < b.week_ago
      )::integer AS signups_prior_week
    FROM scoped_profiles p
    CROSS JOIN bounds b
  ),
  current_core_actions AS (
    SELECT e.user_id, count(*)::integer AS action_count
    FROM scoped_events e
    CROSS JOIN bounds b
    WHERE e.created_at >= b.week_ago
      AND e.event_name IN (
        'listing_created', 'message_sent', 'onboarding_completed',
        'checklist_started', 'checklist_completed', 'handoff_completed'
      )
    GROUP BY e.user_id
  ),
  dorm_values AS (
    SELECT
      coalesce(nullif(trim(p.current_dorm), ''), 'No dorm set') AS dorm,
      count(*)::integer AS users,
      coalesce(sum(a.action_count), 0)::integer AS actions_this_week
    FROM scoped_profiles p
    LEFT JOIN current_core_actions a ON a.user_id = p.id
    GROUP BY 1
  ),
  dorms AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'dorm', d.dorm,
      'users', d.users,
      'actionsThisWeek', d.actions_this_week
    ) ORDER BY (d.dorm = 'No dorm set'), d.users DESC, d.dorm), '[]'::jsonb) AS value
    FROM (
      SELECT * FROM dorm_values
      ORDER BY (dorm = 'No dorm set'), users DESC, dorm
      LIMIT 15
    ) d
  ),
  signup_buckets AS (
    SELECT
      b.series_start + (g.bucket * interval '7 days') AS week_start,
      count(p.id)::integer AS signup_count
    FROM bounds b
    CROSS JOIN generate_series(0, 7) AS g(bucket)
    LEFT JOIN scoped_profiles p
      ON p.created_at >= b.series_start + (g.bucket * interval '7 days')
     AND p.created_at < least(b.current_time, b.series_start + ((g.bucket + 1) * interval '7 days'))
    GROUP BY b.series_start, g.bucket
  ),
  signup_series AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'weekStart', s.week_start,
      'count', s.signup_count
    ) ORDER BY s.week_start), '[]'::jsonb) AS value
    FROM signup_buckets s
  ),
  stuck_profiles AS (
    SELECT p.id, p.email, p.created_at
    FROM scoped_profiles p
    CROSS JOIN bounds b
    WHERE p.created_at <= b.week_ago
      AND NOT EXISTS (
        SELECT 1
        FROM scoped_events e
        WHERE e.user_id = p.id
          AND e.event_name IN (
            'listing_created', 'message_sent', 'onboarding_completed',
            'checklist_started', 'checklist_completed', 'handoff_completed'
          )
      )
  ),
  stuck_sample AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'email', s.email,
      'created_at', s.created_at
    ) ORDER BY s.created_at DESC), '[]'::jsonb) AS value
    FROM (
      SELECT * FROM stuck_profiles ORDER BY created_at DESC LIMIT 10
    ) s
  ),
  recent_signups AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'email', r.email,
      'class_year', r.graduation_year,
      'dorm_name', nullif(trim(r.current_dorm), ''),
      'created_at', r.created_at
    ) ORDER BY r.created_at DESC), '[]'::jsonb) AS value
    FROM (
      SELECT * FROM scoped_profiles ORDER BY created_at DESC LIMIT 20
    ) r
  ),
  listing_rollup AS (
    SELECT
      count(*) FILTER (WHERE ml.status <> 'sold')::integer AS active_listings,
      count(*) FILTER (WHERE ml.created_at >= b.week_ago)::integer AS listings_created_this_week,
      count(*) FILTER (
        WHERE ml.created_at >= b.two_weeks_ago AND ml.created_at < b.week_ago
      )::integer AS listings_created_prior_week
    FROM public.marketplace_listings ml
    CROSS JOIN bounds b
    WHERE p_university_id IS NULL OR ml.university_id = p_university_id
  )
  SELECT jsonb_build_object(
    'total_users', pr.total_users,
    'active_last_7_days', coalesce(er.active_this_week, 0),
    'active_listings', lr.active_listings,
    'signups_this_week', pr.signups_this_week,
    'signups_prior_week', pr.signups_prior_week,
    'active_prior_week', coalesce(er.active_prior_week, 0),
    'core_actions_this_week', coalesce(er.core_actions_this_week, 0),
    'core_actions_prior_week', coalesce(er.core_actions_prior_week, 0),
    'listings_created_this_week', lr.listings_created_this_week,
    'listings_created_prior_week', lr.listings_created_prior_week,
    'activated_ever', coalesce(er.activated_ever, 0),
    'returning', ru.value,
    'dorms', d.value,
    'signups_by_week', ss.value,
    'stuck_count', (SELECT count(*)::integer FROM stuck_profiles),
    'stuck_users', st.value,
    'recent_signups', rs.value
  )
  FROM profile_rollup pr
  CROSS JOIN event_rollup er
  CROSS JOIN returning_users ru
  CROSS JOIN dorms d
  CROSS JOIN signup_series ss
  CROSS JOIN stuck_sample st
  CROSS JOIN recent_signups rs
  CROSS JOIN listing_rollup lr;
$$;

REVOKE ALL ON FUNCTION public.get_admin_metrics(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_metrics(uuid) TO service_role;

-- Measured local EXPLAIN plans used sequential scans for both of these
-- predicates. The partial listing indexes only cover active listings that can
-- enter the freshness cron, and the waitlist index supports domain grouping and
-- its stable earliest-signup rank tiebreak.
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_available_confirmation
  ON public.marketplace_listings (last_confirmed_at)
  WHERE status = 'available';
CREATE INDEX IF NOT EXISTS idx_marketplace_listings_available_nudge_due
  ON public.marketplace_listings (last_confirmed_at)
  WHERE status = 'available' AND freshness_nudged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_university_waitlist_domain_created_at
  ON public.university_waitlist (email_domain, created_at);
