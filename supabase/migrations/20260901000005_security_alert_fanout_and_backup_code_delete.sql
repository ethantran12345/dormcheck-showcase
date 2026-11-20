-- Security queue follow-ups (2026-08-02).
--
-- 1. marketplace_alerts fan-out matched tenants with
--    `a.university_id IS NOT DISTINCT FROM NEW.university_id`, which treats
--    NULL as equal to NULL — so a NULL-university alert would match a
--    NULL-university listing across tenants. Closed by data today (0 profiles
--    with a NULL university_id), NOT by constraint. Closing it by LOGIC is
--    strictly better than closing it by column constraint, because
--    `profiles.university_id` cannot be made NOT NULL: `handle_new_user()`
--    derives it from the email domain, and the advertiser-invitation carve-out
--    in `validate_university_email()` deliberately admits non-university
--    domains, for which the lookup yields NULL. A NOT NULL column would make
--    the first advertiser signup fail inside an AFTER INSERT trigger on
--    auth.users — i.e. it would break account creation outright. See
--    docs/DECISIONS.md, 2026-08-02.
--
-- 2. mfa_backup_codes DELETE required only own-row ownership, so an AAL1
--    session could destroy the account's recovery codes (denial of recovery).
--    A rate limit only slows that down; requiring AAL2 stops it, and costs
--    nothing in practice — the only legitimate caller is the disable-2FA flow,
--    which verifies TOTP immediately beforehand and is therefore already aal2.
--    Same principle as the mint gate: the destructive operation is the one
--    that must prove a live factor.

-- ── 1. Alert fan-out: NULL never matches ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_marketplace_alert_matches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status <> 'available' OR NEW.is_sublease THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NOT (
         OLD.status = 'pending_review'
      OR (OLD.status = 'under_review'
          AND OLD.moderation_decision IN ('held', 'rejected'))
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- A listing with no university fans out to nobody.
  IF NEW.university_id IS NULL THEN
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
    -- Plain equality: NULL on either side now yields NULL (not a match),
    -- instead of IS NOT DISTINCT FROM's NULL = NULL cross-tenant match.
    AND a.university_id = NEW.university_id
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
  RAISE WARNING 'notify_marketplace_alert_matches failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- ── 2. Backup-code DELETE requires AAL2 ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.protect_backup_code_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service-role / direct SQL (account deletion cascades, seeds) is unaffected.
  IF auth.uid() IS NULL THEN
    RETURN OLD;
  END IF;
  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION 'aal2 required to delete backup codes';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_backup_code_delete ON public.mfa_backup_codes;
CREATE TRIGGER protect_backup_code_delete
  BEFORE DELETE ON public.mfa_backup_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_backup_code_delete();
