-- Item names are screened content (handoff-moderation-childsafety-authemail-2026-10-11, A1).
--
-- marketplace_listing_items.name is user text rendered on every surface that
-- shows a listing (feed card, detail modal, photo tags, the guest view's items
-- array), but nothing ever screened it: moderate-listing read title, category and
-- description only, and 20261011000000's rescreen_listing_on_edit() watches the
-- PARENT row's columns, so an owner could add or rename an item on an approved,
-- live listing and it never left the feed. The only check on an item name was
-- the prohibited-words regex in reject_prohibited_listing_item(). Verified on the
-- local stack 2026-10-12: 8 of the 18 verdicts in
-- supabase/tests/listing_item_rescreen.test.sql were red before this migration.
--
-- moderate-listing now reads item names into its text screen (same deploy). This
-- migration makes an item change re-enter that screen, reusing the parent rule
-- rather than duplicating it. Additive only: one new function + trigger, and
-- rescreen_listing_on_edit() re-created VERBATIM from 20261011000000 plus one
-- marker check and a message that now names items. No data is rewritten.
--
-- 1. rescreen_listing_on_item_change(), AFTER INSERT OR UPDATE OF name on items:
--    when an end user (same exemption shape as the parent trigger) adds an item
--    or changes an item's name (compared after btrim, so the edit form re-saving
--    every unchanged name is not a change), it touches the parent row with a
--    transaction-local marker naming that listing. Item DELETE is deliberately
--    not a screened change: removing an item adds no content.
--
-- 2. rescreen_listing_on_edit() treats "the marker names this listing AND the
--    update came from inside another trigger (pg_trigger_depth() > 1)" as a
--    screened change, then applies the existing status rules unchanged:
--    available|open -> pending_review with the verdict cleared; pending_review ->
--    in-flight claim cleared; under_review -> unchanged; anything else refused.
--    The depth check means the marker cannot be forged by a direct listing write
--    (and PostgREST exposes no way to set it; test ir11 pins this anyway).
--
--    Why go through the parent trigger instead of updating the moderation columns
--    from the item trigger directly: protect_listing_moderation_state() restores
--    those columns from OLD for every end-user update, and it fires first
--    (alphabetical), so only the rescreen trigger's own clear survives. Same
--    ordering argument as 20261011000000.

CREATE OR REPLACE FUNCTION public.rescreen_listing_on_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_items_changed boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR EXISTS (
       SELECT 1 FROM public.profiles
        WHERE id = (SELECT auth.uid()) AND is_admin = true
     ) THEN
    RETURN NEW;
  END IF;

  -- 20261012000000: an item add/rename arrives as a no-op parent update from
  -- rescreen_listing_on_item_change(), marked with this listing's id.
  v_items_changed := pg_trigger_depth() > 1
    AND current_setting('dormcheck.items_changed_listing', true) = NEW.id::text;

  IF NOT v_items_changed
     AND NULLIF(btrim(NEW.title), '')       IS NOT DISTINCT FROM NULLIF(btrim(OLD.title), '')
     AND NULLIF(btrim(NEW.description), '') IS NOT DISTINCT FROM NULLIF(btrim(OLD.description), '')
     AND NULLIF(btrim(NEW.category), '')    IS NOT DISTINCT FROM NULLIF(btrim(OLD.category), '')
     AND coalesce(NEW.image_urls, '{}')    IS NOT DISTINCT FROM coalesce(OLD.image_urls, '{}') THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('available', 'open') THEN
    NEW.status                := 'pending_review';
    NEW.moderation_decision   := NULL;
    NEW.moderation_reason     := NULL;
    NEW.moderation_categories := NULL;
    NEW.moderated_at          := NULL;
    NEW.moderation_started_at := NULL;
  ELSIF OLD.status = 'pending_review' THEN
    NEW.moderation_started_at := NULL;
  ELSIF OLD.status = 'under_review' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Relist this listing before changing its photos, title, description, category or items.'
      USING errcode = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rescreen_listing_on_edit() FROM public, anon, authenticated;

COMMENT ON FUNCTION public.rescreen_listing_on_edit() IS
  'An end-user edit to a screened field (title/description/category/image_urls, or an item add/rename marked by rescreen_listing_on_item_change) sends a live listing back to pending_review for moderate-listing; refuses it on lifecycle states approve cannot restore. 20261011000000, items 20261012000000.';

CREATE OR REPLACE FUNCTION public.rescreen_listing_on_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR EXISTS (
       SELECT 1 FROM public.profiles
        WHERE id = (SELECT auth.uid()) AND is_admin = true
     ) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NULLIF(btrim(NEW.name), '') IS NOT DISTINCT FROM NULLIF(btrim(OLD.name), '') THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('dormcheck.items_changed_listing', NEW.listing_id::text, true);
  UPDATE public.marketplace_listings SET status = status WHERE id = NEW.listing_id;
  PERFORM set_config('dormcheck.items_changed_listing', '', true);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.rescreen_listing_on_item_change() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rescreen_listing_on_item_change ON public.marketplace_listing_items;
CREATE TRIGGER trg_rescreen_listing_on_item_change
  AFTER INSERT OR UPDATE OF name ON public.marketplace_listing_items
  FOR EACH ROW EXECUTE FUNCTION public.rescreen_listing_on_item_change();

COMMENT ON FUNCTION public.rescreen_listing_on_item_change() IS
  'An end-user item add or rename re-enters the parent listing''s screen via rescreen_listing_on_edit (marker + pg_trigger_depth). Item delete is not a screened change. 20261012000000.';
