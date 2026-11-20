-- P1.10 advertiser portal, slice 1 (foundation). Expand-only.
-- Product decisions (Ethan, 2026-07-12): advertiser accounts are
-- INVITE-GATED - the .edu signup gate stays airtight; a superadmin-issued
-- invitation is the only way a business email can register. Money-in (Stripe)
-- and reporting are later slices; campaigns stop at approved/rejected.
-- Hard rules encoded here: campaigns target ONE university (required);
-- targeting is aggregate-only with a k-anonymity floor (reach < 50 is never
-- disclosed); no student PII is ever readable by advertisers.
-- PROD APPLY: via Supabase MCP apply_migration, after 20260712180000 (privacy_prefs).

-- ── 1. Invitations (superadmin-issued) ───────────────────────────────────────

CREATE TABLE public.advertiser_invitations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$'),
  business_name text CHECK (business_name IS NULL OR char_length(business_name) <= 120),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  accepted_at timestamptz
);

ALTER TABLE public.advertiser_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY adv_inv_superadmin_all ON public.advertiser_invitations
  FOR ALL TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

REVOKE ALL ON TABLE public.advertiser_invitations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.advertiser_invitations TO authenticated;

-- Pre-signup check for the auth form (anon-callable, boolean only - reveals
-- no more than attempting the signup itself would).
CREATE OR REPLACE FUNCTION public.has_advertiser_invitation(p_email text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.advertiser_invitations i
    WHERE i.email = lower(trim(p_email))
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.has_advertiser_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_advertiser_invitation(text) TO anon, authenticated;

-- ── 2. Signup-gate exception ─────────────────────────────────────────────────
-- Same body as 20260723030000 with ONE addition: a live advertiser invitation
-- admits that exact email. Everything else stays university-domain gated.

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

  -- Advertiser exception (P1.10): a superadmin-issued, unexpired, unaccepted
  -- invitation admits exactly this email.
  IF EXISTS (
    SELECT 1 FROM public.advertiser_invitations i
    WHERE i.email = lower(NEW.email)
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
  ) THEN
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

-- ── 3. Advertiser accounts ───────────────────────────────────────────────────

CREATE TABLE public.advertisers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name text NOT NULL CHECK (char_length(business_name) BETWEEN 1 AND 120),
  website text CHECK (website IS NULL OR website ~* '^https://'),
  category text CHECK (category IS NULL OR char_length(category) <= 60),
  contact_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.advertisers ENABLE ROW LEVEL SECURITY;

-- Owner bootstraps their row only while holding a live invitation for the
-- email on their JWT; owner reads/updates own; superadmin everything.
-- The invitation lookup must go through the SECURITY DEFINER helper: the
-- invitations table is superadmin-only RLS, invisible to a plain policy
-- subquery running as the advertiser.
CREATE POLICY advertisers_insert_own ON public.advertisers
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.has_advertiser_invitation(coalesce((SELECT auth.jwt() ->> 'email'), ''))
  );
CREATE POLICY advertisers_select_own ON public.advertisers
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_superadmin());
CREATE POLICY advertisers_update_own ON public.advertisers
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_superadmin());

REVOKE ALL ON TABLE public.advertisers FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.advertisers TO authenticated;

-- Mark the invitation accepted when the advertiser row lands.
CREATE OR REPLACE FUNCTION public.accept_advertiser_invitation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.advertiser_invitations
     SET accepted_at = now()
   WHERE email = lower(coalesce(NEW.contact_email, ''))
     AND accepted_at IS NULL;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.accept_advertiser_invitation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_accept_advertiser_invitation ON public.advertisers;
CREATE TRIGGER trg_accept_advertiser_invitation
  AFTER INSERT ON public.advertisers
  FOR EACH ROW EXECUTE FUNCTION public.accept_advertiser_invitation();

-- Client helper: is the signed-in user an advertiser (or invited-but-not-yet
-- onboarded)? Used by enforceUniversityEmailOrSignOut so advertiser logins
-- route to /advertise instead of being signed out.
CREATE OR REPLACE FUNCTION public.is_advertiser_account()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.advertisers a WHERE a.user_id = auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.advertiser_invitations i
        WHERE i.email = lower(coalesce((SELECT auth.jwt() ->> 'email'), ''))
          AND i.expires_at > now()
      );
$$;
REVOKE EXECUTE ON FUNCTION public.is_advertiser_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_advertiser_account() TO authenticated;

-- ── 4. Campaigns + creatives + impressions ───────────────────────────────────

CREATE TABLE public.ad_campaigns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  advertiser_id uuid NOT NULL REFERENCES public.advertisers(id) ON DELETE CASCADE,
  university_id uuid NOT NULL REFERENCES public.universities(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'ended')),
  start_date date,
  end_date date CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  -- Flat, advertiser-facing price (B2B money-in; never surfaces in any
  -- university- or student-facing UI). Set at checkout in the Stripe slice.
  flat_price_cents integer CHECK (flat_price_cents IS NULL OR flat_price_cents >= 0),
  -- {class_years: int[], dorms: text[]} - aggregate buckets only, never lists
  -- of students. university_id is the required base target.
  targeting jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ad_campaigns_advertiser_idx ON public.ad_campaigns (advertiser_id, created_at DESC);
CREATE INDEX ad_campaigns_status_idx ON public.ad_campaigns (status, created_at);

ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY ad_campaigns_owner_select ON public.ad_campaigns
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.advertisers a WHERE a.id = advertiser_id AND a.user_id = (SELECT auth.uid()))
    OR public.is_superadmin()
  );
CREATE POLICY ad_campaigns_owner_insert ON public.ad_campaigns
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.advertisers a WHERE a.id = advertiser_id AND a.user_id = (SELECT auth.uid()))
    AND status IN ('draft', 'pending_review')
  );
-- Owner edits drafts/rejected and submits for review; approval fields and the
-- approved/ended states are the superadmin policy's domain.
CREATE POLICY ad_campaigns_owner_update ON public.ad_campaigns
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.advertisers a WHERE a.id = advertiser_id AND a.user_id = (SELECT auth.uid()))
    AND status IN ('draft', 'pending_review', 'rejected')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.advertisers a WHERE a.id = advertiser_id AND a.user_id = (SELECT auth.uid()))
    AND status IN ('draft', 'pending_review')
  );
CREATE POLICY ad_campaigns_owner_delete ON public.ad_campaigns
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.advertisers a WHERE a.id = advertiser_id AND a.user_id = (SELECT auth.uid()))
    AND status IN ('draft', 'rejected')
  );
CREATE POLICY ad_campaigns_superadmin_update ON public.ad_campaigns
  FOR UPDATE TO authenticated
  USING (public.is_superadmin());

REVOKE ALL ON TABLE public.ad_campaigns FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ad_campaigns TO authenticated;

CREATE TABLE public.ad_creatives (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id uuid NOT NULL UNIQUE REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  image_url text CHECK (image_url IS NULL OR image_url ~* '^https://'),
  headline text NOT NULL CHECK (char_length(headline) BETWEEN 1 AND 80),
  body text CHECK (body IS NULL OR char_length(body) <= 200),
  cta_text text NOT NULL DEFAULT 'Learn more' CHECK (char_length(cta_text) BETWEEN 1 AND 30),
  cta_url text NOT NULL CHECK (cta_url ~* '^https://'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ad_creatives ENABLE ROW LEVEL SECURITY;

CREATE POLICY ad_creatives_owner_all ON public.ad_creatives
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ad_campaigns c
      JOIN public.advertisers a ON a.id = c.advertiser_id
      WHERE c.id = campaign_id AND a.user_id = (SELECT auth.uid())
    )
    OR public.is_superadmin()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ad_campaigns c
      JOIN public.advertisers a ON a.id = c.advertiser_id
      WHERE c.id = campaign_id AND a.user_id = (SELECT auth.uid())
        AND c.status IN ('draft', 'pending_review', 'rejected')
    )
    OR public.is_superadmin()
  );

REVOKE ALL ON TABLE public.ad_creatives FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ad_creatives TO authenticated;

-- Impression/click event log (reporting slice consumes it; service-role only
-- writes for now - no client policies on purpose).
CREATE TABLE public.ad_impressions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES public.ad_campaigns(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('impression', 'click')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ad_impressions_campaign_idx ON public.ad_impressions (campaign_id, created_at);
ALTER TABLE public.ad_impressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ad_impressions FROM anon, authenticated;

-- ── 5. Privacy-safe reach estimate (k-anonymity floor) ───────────────────────
-- Aggregate count only; NULL means "under the floor" and the UI greys the
-- segment out. The floor is the compliance control: advertisers can never
-- resolve a segment smaller than AD_REACH_K students.

CREATE OR REPLACE FUNCTION public.estimate_ad_reach(
  p_university uuid,
  p_class_years int[] DEFAULT NULL,
  p_dorms text[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  k constant integer := 50;
  n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO n
  FROM public.profiles p
  WHERE p.university_id = p_university
    AND (p_class_years IS NULL OR cardinality(p_class_years) = 0
         OR p.graduation_year = ANY(p_class_years))
    AND (p_dorms IS NULL OR cardinality(p_dorms) = 0
         OR p.current_dorm = ANY(p_dorms));
  IF n < k THEN
    RETURN NULL;
  END IF;
  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.estimate_ad_reach(uuid, int[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estimate_ad_reach(uuid, int[], text[]) TO authenticated;
