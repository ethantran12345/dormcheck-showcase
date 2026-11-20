-- Marketplace alerts: LinkedIn-job-alert-style saved searches over the student
-- market. A student saves a filter set (categories, price band, keywords); an
-- AFTER INSERT trigger on marketplace_listings fans a 'marketplace_alert'
-- notification (existing bell/feed pipeline, 20260713000000) out to every
-- matching alert owner. In-app only in v1 — email/push ride the existing
-- 'marketplace' pref category later. Expand-only.
-- PROD APPLY: via Supabase MCP apply_migration, after 20260809010000.

-- ── Alerts table (class C, user-owned; registered in table-classification) ───

CREATE TABLE public.marketplace_alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Server-derived from the owner's profile (BEFORE INSERT below); a dimension
  -- for match scoping, not a tenant boundary.
  university_id uuid REFERENCES public.universities(id),
  name          text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  -- Empty array = any category (mirrors the "All" chip in the filter UI).
  categories    text[] NOT NULL DEFAULT '{}',
  min_price     numeric CHECK (min_price IS NULL OR min_price >= 0),
  max_price     numeric CHECK (max_price IS NULL OR max_price >= 0),
  -- Free-text words; a listing matches when EVERY word appears in
  -- title+description (case-insensitive). NULL/blank = no keyword filter.
  keywords      text CHECK (keywords IS NULL OR char_length(keywords) <= 120),
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (min_price IS NULL OR max_price IS NULL OR min_price <= max_price)
);

CREATE INDEX idx_marketplace_alerts_user ON public.marketplace_alerts (user_id);
-- Fan-out scan: enabled alerts within the listing's university.
CREATE INDEX idx_marketplace_alerts_enabled_university
  ON public.marketplace_alerts (university_id) WHERE enabled;

ALTER TABLE public.marketplace_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own marketplace alerts"
  ON public.marketplace_alerts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON TABLE public.marketplace_alerts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.marketplace_alerts TO authenticated;

-- ── BEFORE INSERT: derive university_id server-side + cap 10 alerts/user ─────

CREATE FUNCTION public.marketplace_alerts_before_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF (SELECT count(*) FROM public.marketplace_alerts WHERE user_id = NEW.user_id) >= 10 THEN
    RAISE EXCEPTION 'alert_limit_reached' USING HINT = 'A user may keep at most 10 marketplace alerts.';
  END IF;
  NEW.university_id := (SELECT university_id FROM public.profiles WHERE id = NEW.user_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_marketplace_alerts_before_insert
  BEFORE INSERT ON public.marketplace_alerts
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_alerts_before_insert();

REVOKE EXECUTE ON FUNCTION public.marketplace_alerts_before_insert() FROM PUBLIC, anon, authenticated;

-- ── Widen notifications.type to include 'marketplace_alert' ──────────────────
-- Same dynamic-drop pattern as 20260729040000 (the live constraint name/list
-- has drifted across environments); re-add with the full known set.

DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.notifications'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%type%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'roommate_invite_accepted', 'building_new_residents', 'admin_announcement',
    'report_resolution', 'listing_freshness', 'roommate_invited',
    'marketplace_alert'
  ));

-- ── Fan-out trigger: new available listing → notify matching alert owners ────
-- One notification per recipient per listing even when several of their alerts
-- match (DISTINCT ON user_id, oldest alert wins the payload label). Sellers
-- never match their own listings; blocks respected both directions. Failure is
-- isolated so an alert bug can never block a listing post.

CREATE FUNCTION public.notify_marketplace_alert_matches()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status <> 'available' OR NEW.is_sublease THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (recipient_id, type, payload, university_id)
  SELECT DISTINCT ON (a.user_id)
    a.user_id,
    'marketplace_alert',
    jsonb_build_object(
      'listing_id', NEW.id,
      'title',      NEW.title,
      'price',      NEW.price,
      'category',   NEW.category,
      'image_url',  CASE WHEN coalesce(array_length(NEW.image_urls, 1), 0) >= 1
                         THEN NEW.image_urls[1] END,
      'alert_id',   a.id,
      'alert_name', a.name
    ),
    a.university_id
  FROM public.marketplace_alerts a
  WHERE a.enabled
    AND a.user_id <> NEW.user_id
    AND a.university_id IS NOT DISTINCT FROM NEW.university_id
    AND (cardinality(a.categories) = 0 OR NEW.category = ANY (a.categories))
    AND (a.min_price IS NULL OR NEW.price >= a.min_price)
    AND (a.max_price IS NULL OR NEW.price <= a.max_price)
    AND (
      a.keywords IS NULL OR btrim(a.keywords) = ''
      OR NOT EXISTS (
        SELECT 1
        FROM regexp_split_to_table(lower(btrim(a.keywords)), '\s+') AS w
        WHERE position(w IN lower(coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, ''))) = 0
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users b
      WHERE (b.blocker_id = a.user_id AND b.blocked_id = NEW.user_id)
         OR (b.blocker_id = NEW.user_id AND b.blocked_id = a.user_id)
    )
  ORDER BY a.user_id, a.created_at;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- An alert fan-out failure must never block a listing post.
  RAISE WARNING 'notify_marketplace_alert_matches failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_marketplace_alert_matches
  AFTER INSERT ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.notify_marketplace_alert_matches();

REVOKE EXECUTE ON FUNCTION public.notify_marketplace_alert_matches() FROM PUBLIC, anon, authenticated;
