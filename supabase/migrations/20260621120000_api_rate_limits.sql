-- Per-user rate limiting for the email-sending /api endpoints (SEC-3).
-- A single atomic RPC implements a fixed-window counter so the stateless Vercel
-- serverless handlers can throttle without an external store. Only the service
-- role (used by the api/ layer) may call it; clients cannot reach it.

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket_key   text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count        integer     NOT NULL DEFAULT 0
);

-- Locked down: RLS on with no policies => anon/authenticated cannot read or
-- write. The service role bypasses RLS, which is the only caller.
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.api_rate_limits FROM anon, authenticated;

-- Atomic check-and-increment. Returns true when the request is within the limit
-- for the current window, false when it should be rejected. The upsert resets
-- the window in-place once it has expired.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket_key     text,
  p_max_requests   integer,
  p_window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now   timestamptz := now();
  v_count integer;
BEGIN
  INSERT INTO public.api_rate_limits AS r (bucket_key, window_start, count)
  VALUES (p_bucket_key, v_now, 1)
  ON CONFLICT (bucket_key) DO UPDATE
    SET
      window_start = CASE
        WHEN r.window_start < v_now - make_interval(secs => p_window_seconds)
          THEN v_now
        ELSE r.window_start
      END,
      count = CASE
        WHEN r.window_start < v_now - make_interval(secs => p_window_seconds)
          THEN 1
        ELSE r.count + 1
      END
  RETURNING r.count INTO v_count;

  RETURN v_count <= p_max_requests;
END;
$$;

-- Only the service role may invoke it (defense in depth; the function is also
-- protected by being unreachable from the anon/authenticated PostgREST roles).
REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;

COMMENT ON FUNCTION public.check_rate_limit(text, integer, integer) IS
  'Atomic fixed-window rate limiter for the email-sending /api endpoints. '
  'Returns true if the call is within p_max_requests in the last p_window_seconds. '
  'Service-role only; called by api/_lib/rateLimit.ts.';
