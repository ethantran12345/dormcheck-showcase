set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.am_i_in_group_with_user(target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 
    FROM ranking_group_members my_mem
    JOIN ranking_group_members their_mem ON my_mem.group_id = their_mem.group_id
    WHERE my_mem.user_id = auth.uid()
    AND their_mem.user_id = target_user_id
    AND my_mem.status = 'accepted'
    AND their_mem.status = 'accepted'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.check_group_access(check_group_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Simple, direct check: Is the user an accepted member?
  RETURN EXISTS (
    SELECT 1 
    FROM public.ranking_group_members 
    WHERE group_id = check_group_id
    AND user_id = auth.uid()
    AND status = 'accepted'
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.clone_personal_to_group(target_group_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Insert a copy of every personal item (where group_id is NULL)
  -- into the target group, but ONLY if the group is currently empty.
  INSERT INTO public.checklist_items (user_id, category, item, is_checked, is_custom, group_id)
  SELECT 
    auth.uid(), 
    category, 
    item, 
    FALSE, -- Start unchecked in the group list
    is_custom, 
    target_group_id -- Assign them to the new group
  FROM public.checklist_items
  WHERE user_id = auth.uid() 
    AND group_id IS NULL
    AND NOT EXISTS (
      -- Safety check: Don't clone if items already exist in this group
      SELECT 1 FROM public.checklist_items WHERE group_id = target_group_id
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.create_ranking_group(p_group_name text DEFAULT NULL::text, p_member_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_group_id uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.ranking_collaborations (owner_id, collaborator_id, group_name, status)
  VALUES (v_uid, NULL, NULLIF(TRIM(p_group_name), ''), 'accepted')
  RETURNING id INTO v_group_id;

  INSERT INTO public.ranking_group_members (group_id, user_id, status, role)
  SELECT v_group_id, v_uid, 'accepted', 'owner'
  UNION ALL
  SELECT v_group_id, u, 'pending', 'collaborator'
  FROM unnest(p_member_ids) AS u
  WHERE u IS NOT NULL AND u != v_uid
  ON CONFLICT (user_id, group_id) DO NOTHING;

  RETURN v_group_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.drop_all_policies_for_table(target_schema text, target_table text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT policyname FROM pg_policies WHERE schemaname = target_schema AND tablename = target_table) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, target_schema, target_table);
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.extract_listing_id(url text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Simple regex to find a UUID in the URL string
  RETURN (regexp_match(url, '([a-f0-9-]{36})'))[1]::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_group_checklist(query_group_id uuid)
 RETURNS SETOF public.checklist_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ranking_group_members
    WHERE group_id = query_group_id
      AND user_id = v_uid
      AND status = 'accepted'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT ci.*
  FROM public.checklist_items ci
  WHERE ci.group_id = query_group_id
    AND ci.user_id IN (
      SELECT rgm.user_id
      FROM public.ranking_group_members rgm
      WHERE rgm.group_id = query_group_id
        AND rgm.status = 'accepted'
    )
  ORDER BY ci.order_index ASC NULLS LAST, ci.created_at ASC NULLS LAST, ci.id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_groups_i_own()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM ranking_collaborations 
  WHERE owner_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_accepted_group_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT group_id FROM ranking_group_members 
  WHERE user_id = auth.uid() AND status = 'accepted';
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_all_group_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT group_id FROM ranking_group_members 
  WHERE user_id = auth.uid(); 
  -- Note: We REMOVED "AND status = 'accepted'" so pending invites are included.
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, has_completed_onboarding)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.email,
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user_checklist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.checklist_items (user_id, category, item)
  VALUES 
    (NEW.id, 'Bedding', 'Twin XL Sheets (2 sets)'),
    (NEW.id, 'Bedding', 'Mattress Topper'),
    (NEW.id, 'Bathroom', 'Shower Caddy'),
    (NEW.id, 'Tech', 'Power Strip (Surge Protector)'),
    (NEW.id, 'Climate', 'Woozo / High-Power Fan'),
    (NEW.id, 'Utility', 'Umbrella (Pittsburgh Essential)'),
    (NEW.id, 'Wellness', 'First Aid Kit & Thermometer'),
    (NEW.id, 'Laundry', 'Detergent Pods / Dryer Sheets'),
    (NEW.id, 'Kitchen', 'Reusable Water Bottle');

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.limit_user_listings()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (SELECT COUNT(*) FROM public.marketplace_listings WHERE user_id = NEW.user_id) >= 15 THEN
    RAISE EXCEPTION 'User has reached the maximum limit of 15 listings';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.payment_history_receiver_confirm()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM 'sent' OR NEW.status IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'Invalid payment confirmation';
  END IF;
  IF NEW.payer_id IS DISTINCT FROM OLD.payer_id
     OR NEW.receiver_id IS DISTINCT FROM OLD.receiver_id
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'Only status may change when confirming';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.protect_profile_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.email <> OLD.email THEN
    RAISE EXCEPTION 'You cannot change your university email address.';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reset_checklist_custom(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Not authorized to reset checklist for this user';
  END IF;
  DELETE FROM public.checklist_items WHERE user_id = p_user_id;
  UPDATE public.profiles SET has_completed_onboarding = true WHERE id = p_user_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reset_checklist_defaults(p_user_id uuid, p_list_type text DEFAULT 'dorm'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Not authorized to reset checklist for this user';
  END IF;

  DELETE FROM public.checklist_items WHERE user_id = p_user_id;

  IF p_list_type = 'apartment' THEN
    INSERT INTO public.checklist_items (user_id, category, item, is_checked, is_custom)
    SELECT p_user_id, v.cat, v.itm, false, false
    FROM (VALUES
      ('Sleep', 'Twin XL Sheets (2 sets)'),
      ('Sleep', 'Comforter / Duvet'),
      ('Sleep', 'Mattress Topper'),
      ('Sleep', 'Pillows (2)'),
      ('Climate', 'Woozo Fan'),
      ('Bathroom', 'Shower Caddy'),
      ('Bathroom', 'Towels (Body, Hand, Face)'),
      ('Bathroom', 'Personal Hygiene Kit'),
      ('Tech', 'Laptop & Charger'),
      ('Tech', 'Power Strip (Surge Protector)'),
      ('Tech', 'Headphones (Noise Cancelling)'),
      ('Documents', 'Student ID / Driver License'),
      ('Documents', 'Health Insurance Card'),
      ('Kitchen', 'Reusable Water Bottle'),
      ('Kitchen', 'Utensil Set'),
      ('Kitchen', 'Dish Soap'),
      ('Laundry', 'Laundry Basket'),
      ('Laundry', 'Detergent Pods'),
      ('Wellness', 'First Aid Kit'),
      ('Decor', 'Command Hooks'),
      ('Decor', 'Desk Lamp'),
      ('Organization', 'Under-Bed Storage'),
      ('Bathroom Maintenance', 'Plunger'),
      ('Bathroom Maintenance', 'Cleaning Supplies'),
      ('Full Kitchen', 'Pots & Pans'),
      ('Full Kitchen', 'Kitchenware (Plates, Bowls, Mugs)'),
      ('Full Kitchen', 'Trash Bags'),
      ('Living Room', 'Couch / Sofa'),
      ('Living Room', 'Coffee Table'),
      ('Living Room', 'TV Stand')
    ) AS v(cat, itm);
  ELSE
    INSERT INTO public.checklist_items (user_id, category, item, is_checked, is_custom)
    SELECT p_user_id, v.cat, v.itm, false, false
    FROM (VALUES
      ('Sleep', 'Twin XL Sheets (2 sets)'),
      ('Sleep', 'Comforter / Duvet'),
      ('Sleep', 'Mattress Topper'),
      ('Sleep', 'Pillows (2)'),
      ('Climate', 'Woozo Fan'),
      ('Bathroom', 'Shower Caddy'),
      ('Bathroom', 'Towels (Body, Hand, Face)'),
      ('Bathroom', 'Personal Hygiene Kit'),
      ('Tech', 'Laptop & Charger'),
      ('Tech', 'Power Strip (Surge Protector)'),
      ('Tech', 'Headphones (Noise Cancelling)'),
      ('Documents', 'Student ID / Driver License'),
      ('Documents', 'Health Insurance Card'),
      ('Kitchen', 'Reusable Water Bottle'),
      ('Kitchen', 'Utensil Set'),
      ('Kitchen', 'Dish Soap'),
      ('Laundry', 'Laundry Basket'),
      ('Laundry', 'Detergent Pods'),
      ('Wellness', 'First Aid Kit'),
      ('Decor', 'Command Hooks'),
      ('Decor', 'Desk Lamp'),
      ('Organization', 'Under-Bed Storage')
    ) AS v(cat, itm);
  END IF;

  UPDATE public.profiles SET has_completed_onboarding = true WHERE id = p_user_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.roommate_search_interests_bump_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.roommate_search_posts
    SET interest_count = interest_count + 1
    WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.roommate_search_posts
    SET interest_count = GREATEST(0, interest_count - 1)
    WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.roommate_search_posts_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_group_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.ranking_group_members
  SET status = NEW.status
  WHERE group_id = NEW.id;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_business_listings_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_conversation_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  -- We use 'public.' before the table name to be explicit
  UPDATE public.conversations 
  SET updated_at = timezone('utc'::text, now())
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$
;


