


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."am_i_in_group_with_user"("target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM ranking_group_members my_mem
    JOIN ranking_group_members their_mem ON my_mem.group_id = their_mem.group_id
    WHERE my_mem.user_id = auth.uid()
    AND their_mem.user_id = target_user_id
    AND my_mem.status = 'accepted'
    AND their_mem.status = 'accepted'
  );
$$;


ALTER FUNCTION "public"."am_i_in_group_with_user"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_group_access"("check_group_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."check_group_access"("check_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_group_checklist"("target_group_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  DELETE FROM public.checklist_items
  WHERE user_id IN (
    SELECT user_id FROM public.ranking_group_members
    WHERE group_id = target_group_id
  );
END;
$$;


ALTER FUNCTION "public"."clear_group_checklist"("target_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clone_personal_to_group"("target_group_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."clone_personal_to_group"("target_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_ranking_group"("p_group_name" "text" DEFAULT NULL::"text", "p_member_ids" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."create_ranking_group"("p_group_name" "text", "p_member_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_ranking_group"("p_group_name" "text", "p_owner_id" "uuid", "p_member_ids" "uuid"[]) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_group_id UUID;
  v_member_id UUID;
BEGIN
  -- Create the Group record
  INSERT INTO public.ranking_collaborations (group_name, owner_id, status)
  VALUES (p_group_name, p_owner_id, 'active')
  RETURNING id INTO v_group_id;

  -- Add the Owner to the members table
  INSERT INTO public.ranking_group_members (group_id, user_id, role, status)
  VALUES (v_group_id, p_owner_id, 'owner', 'accepted');

  -- Add the Invited Members
  FOREACH v_member_id IN ARRAY p_member_ids
  LOOP
    IF v_member_id != p_owner_id THEN
      INSERT INTO public.ranking_group_members (group_id, user_id, role, status)
      VALUES (v_group_id, v_member_id, 'member', 'pending');
    END IF;
  END LOOP;

  RETURN v_group_id;
END;
$$;


ALTER FUNCTION "public"."create_ranking_group"("p_group_name" "text", "p_owner_id" "uuid", "p_member_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_academic_year"() RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE
    WHEN EXTRACT(MONTH FROM CURRENT_DATE) < 5
      OR (EXTRACT(MONTH FROM CURRENT_DATE) = 5 AND EXTRACT(DAY FROM CURRENT_DATE) < 15)
    THEN
      (EXTRACT(YEAR FROM CURRENT_DATE)::int - 1)::text
        || '-'
        || EXTRACT(YEAR FROM CURRENT_DATE)::text
    ELSE
      EXTRACT(YEAR FROM CURRENT_DATE)::text
        || '-'
        || (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)::text
  END;
$$;


ALTER FUNCTION "public"."current_academic_year"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decrement_product_hearts"("product_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE amazon_products
  SET hearts = GREATEST(hearts - 1, 0)
  WHERE id = product_id;
END;
$$;


ALTER FUNCTION "public"."decrement_product_hearts"("product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user_data"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.marketplace_listings WHERE user_id = uid;
  DELETE FROM public.ranking_group_members WHERE user_id = uid;
  DELETE FROM public.ranking_collaborations WHERE owner_id = uid OR collaborator_id = uid;
  DELETE FROM public.user_dorm_rankings WHERE user_id = uid;
  DELETE FROM public.saved_dorms WHERE user_id = uid;
  DELETE FROM public.student_reviews WHERE user_id = uid;
  DELETE FROM public.roommate_profiles WHERE user_id = uid;
  DELETE FROM public.saved_roommates WHERE user_id = uid;
  DELETE FROM public.favorite_roommates WHERE user_id = uid OR prospect_id = uid;
  DELETE FROM public.favorite_listings WHERE user_id = uid;
  DELETE FROM public.checklist_item_claims WHERE user_id = uid;
  DELETE FROM public.checklist_items WHERE user_id = uid;
  DELETE FROM public.profiles WHERE id = uid;
END;
$$;


ALTER FUNCTION "public"."delete_user_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."drop_all_policies_for_table"("target_schema" "text", "target_table" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN (SELECT policyname FROM pg_policies WHERE schemaname = target_schema AND tablename = target_table) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, target_schema, target_table);
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."drop_all_policies_for_table"("target_schema" "text", "target_table" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."eject_from_unmatched_building_chats"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF (NEW.current_dorm IS DISTINCT FROM OLD.current_dorm)
     OR (NEW.housing_type IS DISTINCT FROM OLD.housing_type) THEN

    DELETE FROM public.group_members gm
    USING public.group_conversations gc, public.master_housing m
    WHERE gm.user_id = NEW.id
      AND gm.group_id = gc.id
      AND gc.building_id IS NOT NULL
      AND gc.building_id = m.id
      AND (
        NEW.housing_type IS DISTINCT FROM 'on-campus'
        OR lower(btrim(regexp_replace(coalesce(NEW.current_dorm, ''), '\s+', ' ', 'g')))
          IS DISTINCT FROM
           lower(btrim(regexp_replace(coalesce(m.residence_hall, ''), '\s+', ' ', 'g')))
      );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."eject_from_unmatched_building_chats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."extract_listing_id"("url" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- Simple regex to find a UUID in the URL string
  RETURN (regexp_match(url, '([a-f0-9-]{36})'))[1]::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."extract_listing_id"("url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_building_chat_links"("b_id" bigint, "year" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "building_id" bigint, "floor" "text", "platform" "text", "url" "text", "label" "text", "submitted_by" "uuid", "submitter_display_name" "text", "academic_year" "text", "created_at" timestamp with time zone, "report_count" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    bcl.id,
    bcl.building_id,
    bcl.floor,
    bcl.platform,
    bcl.url,
    bcl.label,
    bcl.submitted_by,
    CASE
      WHEN p.full_name IS NULL OR btrim(p.full_name) = '' THEN 'Student'
      WHEN array_length(string_to_array(btrim(p.full_name), ' '), 1) = 1
        THEN split_part(btrim(p.full_name), ' ', 1)
      ELSE
        split_part(btrim(p.full_name), ' ', 1)
          || ' '
          || upper(substr(split_part(btrim(p.full_name), ' ', array_length(string_to_array(btrim(p.full_name), ' '), 1)), 1, 1))
          || '.'
    END AS submitter_display_name,
    bcl.academic_year,
    bcl.created_at,
    (SELECT count(*)::int FROM public.building_chat_link_reports WHERE link_id = bcl.id) AS report_count
  FROM public.building_chat_links bcl
  LEFT JOIN public.profiles p ON p.id = bcl.submitted_by
  WHERE bcl.building_id = b_id
    AND bcl.academic_year = COALESCE(year, current_academic_year())
    AND user_current_dorm_matches_building(bcl.building_id)
  ORDER BY
    CASE bcl.platform
      WHEN 'snapchat' THEN 1
      WHEN 'groupme' THEN 2
      WHEN 'whatsapp' THEN 3
      WHEN 'discord' THEN 4
      WHEN 'other' THEN 5
    END,
    bcl.created_at DESC;
$$;


ALTER FUNCTION "public"."get_building_chat_links"("b_id" bigint, "year" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_building_chats"("b_id" bigint) RETURNS TABLE("id" "uuid", "name" "text", "floor" "text", "created_at" timestamp with time zone, "last_message" "text", "updated_at" timestamp with time zone, "member_count" integer, "am_i_member" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    gc.id,
    gc.name,
    gc.floor,
    gc.created_at,
    gc.last_message,
    gc.updated_at,
    (SELECT count(*)::int FROM public.group_members WHERE group_id = gc.id) AS member_count,
    EXISTS (
      SELECT 1 FROM public.group_members
      WHERE group_id = gc.id AND user_id = auth.uid()
    ) AS am_i_member
  FROM public.group_conversations gc
  WHERE gc.building_id = b_id
    AND (
      user_current_dorm_matches_building(gc.building_id)
      OR EXISTS (
        SELECT 1 FROM public.group_members
        WHERE group_id = gc.id AND user_id = auth.uid()
      )
    )
  ORDER BY gc.floor NULLS FIRST, gc.created_at;
$$;


ALTER FUNCTION "public"."get_building_chats"("b_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_content_reports"("content_type_filter" "text" DEFAULT NULL::"text") RETURNS TABLE("report_id" "uuid", "content_type" "text", "content_id" "uuid", "reporter_id" "uuid", "reporter_name" "text", "reason" "text", "reported_at" timestamp with time zone, "content_preview_title" "text", "content_preview_body" "text", "content_owner_id" "uuid", "content_owner_name" "text", "content_context" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    cr.id AS report_id,
    cr.content_type,
    cr.content_id,
    cr.reporter_id,
    reporter.full_name AS reporter_name,
    cr.reason,
    cr.created_at AS reported_at,
    CASE cr.content_type
      WHEN 'student_review' THEN 'Review'
      WHEN 'marketplace_listing' THEN (SELECT ml.title FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT
        CASE rsp.post_type
          WHEN 'looking-for-roommates' THEN 'Looking for roommates'
          WHEN 'have-place-need-people' THEN 'Have a place, need people'
          ELSE 'Roommate post'
        END
        FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT COALESCE(bcl.label, 'Chat link') FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
    END AS content_preview_title,
    CASE cr.content_type
      WHEN 'student_review' THEN (SELECT LEFT(COALESCE(sr.comment, ''), 200) FROM student_reviews sr WHERE sr.id = cr.content_id)
      WHEN 'marketplace_listing' THEN (SELECT LEFT(COALESCE(ml.description, ''), 200) FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT LEFT(COALESCE(rsp.content, ''), 200) FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.url FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
    END AS content_preview_body,
    CASE cr.content_type
      WHEN 'student_review' THEN (SELECT sr.user_id FROM student_reviews sr WHERE sr.id = cr.content_id)
      WHEN 'marketplace_listing' THEN (SELECT ml.user_id FROM marketplace_listings ml WHERE ml.id = cr.content_id)
      WHEN 'roommate_post' THEN (SELECT rsp.user_id FROM roommate_search_posts rsp WHERE rsp.id = cr.content_id)
      WHEN 'building_chat_link' THEN (SELECT bcl.submitted_by FROM building_chat_links bcl WHERE bcl.id = cr.content_id)
    END AS content_owner_id,
    NULL::text AS content_owner_name,
    CASE cr.content_type
      WHEN 'student_review' THEN (
        SELECT mh.residence_hall
        FROM student_reviews sr
        JOIN master_housing mh ON mh.id::text = sr.dorm_id
        WHERE sr.id = cr.content_id
      )
      WHEN 'building_chat_link' THEN (
        SELECT mh.residence_hall
        FROM building_chat_links bcl
        JOIN master_housing mh ON mh.id = bcl.building_id
        WHERE bcl.id = cr.content_id
      )
      ELSE NULL
    END AS content_context
  FROM public.content_reports cr
  LEFT JOIN public.profiles reporter ON reporter.id = cr.reporter_id
  WHERE
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
    AND (content_type_filter IS NULL OR cr.content_type = content_type_filter)
  ORDER BY cr.created_at DESC;
$$;


ALTER FUNCTION "public"."get_content_reports"("content_type_filter" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dorm_review_stats"() RETURNS TABLE("dorm_id" integer, "average_rating" numeric, "review_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sr.dorm_id,
    COALESCE(ROUND(AVG(sr.rating)::NUMERIC, 1), 0)::NUMERIC as average_rating,
    COUNT(*)::BIGINT as review_count
  FROM student_reviews sr
  GROUP BY sr.dorm_id;
END;
$$;


ALTER FUNCTION "public"."get_dorm_review_stats"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."checklist_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "item" "text" NOT NULL,
    "is_checked" boolean DEFAULT false,
    "is_custom" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "link" "text",
    "note" "text",
    "description" "text",
    "link_title" "text",
    "link_image" "text",
    "group_id" "uuid",
    "estimated_price" numeric(10,2) DEFAULT 0,
    "split_cost" boolean DEFAULT true,
    "split_participant_ids" "uuid"[],
    "split_percentages" "jsonb",
    "position" integer DEFAULT 0,
    "order_index" integer DEFAULT 0,
    "icon_name" "text",
    "needs_purchase" boolean DEFAULT false,
    "status" "text" DEFAULT 'need'::"text",
    "image_url" "text",
    CONSTRAINT "checklist_items_status_check" CHECK (("status" = ANY (ARRAY['need'::"text", 'bought'::"text", 'packed'::"text"])))
);


ALTER TABLE "public"."checklist_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."checklist_items"."estimated_price" IS 'Estimated cost for the item (USD).';



COMMENT ON COLUMN "public"."checklist_items"."split_cost" IS 'When true (group context), divide item price by number of roommates for My Share.';



COMMENT ON COLUMN "public"."checklist_items"."split_participant_ids" IS 'User IDs who share this item cost. Null/empty = all roommates.';



COMMENT ON COLUMN "public"."checklist_items"."split_percentages" IS 'Custom split percentages: {"userId": 30, "userId2": 70}. Null = equal split among split_participant_ids.';



COMMENT ON COLUMN "public"."checklist_items"."position" IS 'Display order within (user_id, group_id). Lower = earlier. Sections ordered by min(position) of items; items within section by position.';



COMMENT ON COLUMN "public"."checklist_items"."order_index" IS 'Display order: sections by min(order_index) per category; items within section by order_index ascending.';



COMMENT ON COLUMN "public"."checklist_items"."needs_purchase" IS 'When true, item appears on Checkout tab as something to buy.';



COMMENT ON COLUMN "public"."checklist_items"."status" IS 'Checkout flow: need, bought, or packed (packed mirrors is_checked).';



CREATE OR REPLACE FUNCTION "public"."get_group_checklist"("query_group_id" "uuid") RETURNS SETOF "public"."checklist_items"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."get_group_checklist"("query_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_groups_i_own"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT id FROM ranking_collaborations 
  WHERE owner_id = auth.uid();
$$;


ALTER FUNCTION "public"."get_groups_i_own"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_accepted_group_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT group_id FROM ranking_group_members 
  WHERE user_id = auth.uid() AND status = 'accepted';
$$;


ALTER FUNCTION "public"."get_my_accepted_group_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_all_group_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT group_id FROM ranking_group_members 
  WHERE user_id = auth.uid(); 
  -- Note: We REMOVED "AND status = 'accepted'" so pending invites are included.
$$;


ALTER FUNCTION "public"."get_my_all_group_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user_checklist"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."handle_new_user_checklist"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_product_hearts"("product_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE amazon_products
  SET hearts = hearts + 1
  WHERE id = product_id;
END;
$$;


ALTER FUNCTION "public"."increment_product_hearts"("product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_chat_group_member"("gid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members 
    WHERE group_id = gid AND user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_chat_group_member"("gid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."limit_user_listings"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.marketplace_listings WHERE user_id = NEW.user_id) >= 15 THEN
    RAISE EXCEPTION 'User has reached the maximum limit of 15 listings';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."limit_user_listings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."payment_history_receiver_confirm"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."payment_history_receiver_confirm"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_profile_email"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.email <> OLD.email THEN
    RAISE EXCEPTION 'You cannot change your university email address.';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."protect_profile_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_checklist_custom"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Not authorized to reset checklist for this user';
  END IF;
  DELETE FROM public.checklist_items WHERE user_id = p_user_id;
  UPDATE public.profiles SET has_completed_onboarding = true WHERE id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."reset_checklist_custom"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_checklist_defaults"("p_user_id" "uuid", "p_list_type" "text" DEFAULT 'dorm'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."reset_checklist_defaults"("p_user_id" "uuid", "p_list_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."roommate_search_interests_bump_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."roommate_search_interests_bump_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."roommate_search_posts_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."roommate_search_posts_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_group_rankings_from_members"("p_group_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.group_dorm_rankings (group_id, dorm_id, rank_order)
  SELECT DISTINCT ON (rgm.group_id, udr.dorm_id)
    rgm.group_id,
    udr.dorm_id,
    udr.rank_order
  FROM public.user_dorm_rankings udr
  JOIN public.ranking_group_members rgm ON udr.user_id = rgm.user_id
  WHERE rgm.group_id = p_group_id
    AND rgm.status = 'accepted'
    AND udr.group_id IS NULL
  ORDER BY rgm.group_id, udr.dorm_id, udr.rank_order
  ON CONFLICT (group_id, dorm_id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."sync_group_rankings_from_members"("p_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_group_status"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.ranking_group_members
  SET status = NEW.status
  WHERE group_id = NEW.id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_group_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_personal_to_group"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- If a user updates their personal rank, update the group rank if it exists
  UPDATE public.group_dorm_rankings
  SET rank_order = NEW.rank_order
  WHERE dorm_id = NEW.dorm_id
  AND group_id IN (SELECT group_id FROM ranking_group_members WHERE user_id = NEW.user_id AND status = 'accepted');
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_personal_to_group"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_sync_group_rankings_on_member_accept"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW.status = 'accepted' THEN
    PERFORM public.sync_group_rankings_from_members(NEW.group_id);
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_sync_group_rankings_on_member_accept"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_building_chat_links_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_building_chat_links_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_business_listings_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_business_listings_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_conversation_timestamp"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
BEGIN
  -- We use 'public.' before the table name to be explicit
  UPDATE public.conversations 
  SET updated_at = timezone('utc'::text, now())
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_conversation_timestamp"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_current_dorm_matches_building"("b_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.master_housing m ON m.id = b_id
    WHERE p.id = auth.uid()
      AND p.housing_type = 'on-campus'
      AND lower(btrim(regexp_replace(coalesce(p.current_dorm, ''), '\s+', ' ', 'g')))
        = lower(btrim(regexp_replace(coalesce(m.residence_hall, ''), '\s+', ' ', 'g')))
  );
$$;


ALTER FUNCTION "public"."user_current_dorm_matches_building"("b_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_pitt_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
BEGIN
  IF new.email IS NOT NULL AND new.email !~* '^[A-Za-z0-9._%+-]+@pitt\.edu$' THEN
    RAISE EXCEPTION 'Registration is restricted to University of Pittsburgh (@pitt.edu) email addresses only.';
  END IF;
  RETURN new;
END;
$_$;


ALTER FUNCTION "public"."validate_pitt_email"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."amazon_products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "price" numeric(10,2) NOT NULL,
    "category" "text" NOT NULL,
    "affiliate_link" "text" NOT NULL,
    "image_url" "text",
    "rating" numeric(2,1),
    "review_count" integer,
    "is_trending" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "hearts" integer DEFAULT 0
);


ALTER TABLE "public"."amazon_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."analytics_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_name" "text" NOT NULL,
    "event_properties" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "session_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "analytics_events_event_name_len_chk" CHECK ((("char_length"("event_name") >= 1) AND ("char_length"("event_name") <= 64)))
);


ALTER TABLE "public"."analytics_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."analytics_events" IS 'Append-only pilot metrics; RLS allows INSERT for own user_id only; no SELECT for anon/authenticated.';



CREATE TABLE IF NOT EXISTS "public"."building_chat_link_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "link_id" "uuid" NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_reason_length" CHECK ((("reason" IS NULL) OR (("char_length"("reason") >= 1) AND ("char_length"("reason") <= 500))))
);


ALTER TABLE "public"."building_chat_link_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."building_chat_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "building_id" bigint NOT NULL,
    "floor" "text",
    "platform" "text" NOT NULL,
    "url" "text" NOT NULL,
    "label" "text",
    "submitted_by" "uuid",
    "academic_year" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_academic_year_format" CHECK (("academic_year" ~ '^\d{4}-\d{4}$'::"text")),
    CONSTRAINT "chk_label_length" CHECK ((("label" IS NULL) OR (("char_length"("label") >= 1) AND ("char_length"("label") <= 60)))),
    CONSTRAINT "chk_platform" CHECK (("platform" = ANY (ARRAY['snapchat'::"text", 'groupme'::"text", 'whatsapp'::"text", 'discord'::"text", 'other'::"text"]))),
    CONSTRAINT "chk_url_https" CHECK (("url" ~* '^https://'::"text")),
    CONSTRAINT "chk_url_per_platform" CHECK (((("platform" = 'snapchat'::"text") AND ("url" ~* '^https://t\.snapchat\.com/[A-Za-z0-9_-]+/?(\?.*)?$'::"text")) OR (("platform" = 'groupme'::"text") AND ("url" ~* '^https://groupme\.com/join_group/\d+/[A-Za-z0-9]+/?$'::"text")) OR (("platform" = 'whatsapp'::"text") AND ("url" ~* '^https://chat\.whatsapp\.com/[A-Za-z0-9]+/?$'::"text")) OR (("platform" = 'discord'::"text") AND ("url" ~* '^https://(discord\.gg|discord(app)?\.com/invite)/[A-Za-z0-9-]+/?$'::"text")) OR (("platform" = 'other'::"text") AND ("url" ~* '^https://[^[:space:]<>"]+$'::"text"))))
);


ALTER TABLE "public"."building_chat_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bus_stops" (
    "objectID" bigint NOT NULL,
    "stop_id" "text",
    "stop_code" bigint,
    "stop_name" "text",
    "stop_lat" double precision,
    "stop_lon" double precision,
    "stop_route" "text",
    "routes" "text",
    "route_filter" "text",
    "route_sort" "text",
    "mode" "text",
    "direction" "text",
    "svc_days" "text"
);


ALTER TABLE "public"."bus_stops" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."business_listings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "business_name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "description" "text" NOT NULL,
    "instagram_handle" "text",
    "price_range" "text",
    "tags" "text"[],
    "website_url" "text",
    "packages" "jsonb",
    "banner_color" "text",
    "banner_image_url" "text",
    "logo_url" "text",
    "seller_instagram_handle" "text",
    "seller_snapchat_handle" "text",
    "show_seller_instagram" boolean DEFAULT false,
    "show_seller_snapchat" boolean DEFAULT false,
    "is_active" boolean DEFAULT true,
    "is_approved" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."business_listings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campus_map_courses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "course_name" "text" NOT NULL,
    "building_name" "text" NOT NULL,
    "days" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "campus_map_courses_building_not_empty" CHECK (("length"(TRIM(BOTH FROM "building_name")) > 0)),
    CONSTRAINT "campus_map_courses_course_name_not_empty" CHECK (("length"(TRIM(BOTH FROM "course_name")) > 0)),
    CONSTRAINT "campus_map_courses_time_order" CHECK (("start_time" < "end_time"))
);


ALTER TABLE "public"."campus_map_courses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checklist_item_claims" (
    "item_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."checklist_item_claims" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checklist_payment_acks" (
    "group_id" "uuid" NOT NULL,
    "debtor_id" "uuid" NOT NULL,
    "creditor_id" "uuid" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "checklist_payment_acks_no_self" CHECK (("debtor_id" <> "creditor_id"))
);


ALTER TABLE "public"."checklist_payment_acks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."checklist_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "payer_id" "uuid" NOT NULL,
    "payee_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "paid_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "checklist_payments_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."checklist_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "avatar_url" "text",
    "major" "text",
    "grade_level" "text",
    "current_dorm" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "bio" "text",
    "graduation_year" integer,
    "tags" "text"[],
    "cleanliness" "text",
    "social_level" "text",
    "study_style" "text",
    "guest_preference" "text",
    "sleep_habit" "text",
    "temp_preference" "text",
    "conflict_style" "text",
    "dealbreakers" "text"[],
    "instagram_username" "text",
    "snapchat_username" "text",
    "profile_photos" "text"[],
    "guests" "text",
    "sleep" "text",
    "temp" "text",
    "graduation_semester" "text",
    "has_completed_onboarding" boolean DEFAULT false,
    "is_public" boolean DEFAULT false,
    "is_roommate_searching" boolean DEFAULT false,
    "is_admin" boolean DEFAULT false,
    "pronouns" "text",
    "email_notifications" boolean DEFAULT true NOT NULL,
    "current_floor" "text",
    "current_room" "text",
    "preferred_areas" "text"[] DEFAULT '{}'::"text"[],
    "housing_type" "text",
    "neighborhood" "text",
    "phone_number" "text",
    "school" "text",
    "venmo_username" "text",
    "zelle_info" "text",
    CONSTRAINT "profiles_housing_type_check" CHECK ((("housing_type" IS NULL) OR ("housing_type" = ANY (ARRAY['on-campus'::"text", 'off-campus'::"text"]))))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."bio" IS 'Roommate bio; non-null means profile appears in Find Roommates feed';



COMMENT ON COLUMN "public"."profiles"."graduation_year" IS 'Graduation year for roommate filtering';



COMMENT ON COLUMN "public"."profiles"."profile_photos" IS 'Up to 5 profile photo URLs for roommate card';



COMMENT ON COLUMN "public"."profiles"."graduation_semester" IS 'Expected graduation semester: Spring or Fall';



COMMENT ON COLUMN "public"."profiles"."has_completed_onboarding" IS 'Whether the user completed the initial onboarding flow; used for post-login redirect.';



COMMENT ON COLUMN "public"."profiles"."is_public" IS 'When true, profile appears in roommate discovery feeds (Browse, Match). Requires bio IS NOT NULL.';



COMMENT ON COLUMN "public"."profiles"."is_admin" IS 'When true, user has admin privileges. Only founder.demo@pitt.edu is verified in-app.';



COMMENT ON COLUMN "public"."profiles"."pronouns" IS 'User pronouns for display (e.g., she/her, he/him, they/them)';



COMMENT ON COLUMN "public"."profiles"."email_notifications" IS 'When true, user receives email notifications (message requests, group invites, etc.).';



COMMENT ON COLUMN "public"."profiles"."venmo_username" IS 'Venmo username (with or without @); used for pay links in group checklist balances.';



COMMENT ON COLUMN "public"."profiles"."zelle_info" IS 'Phone or email for Zelle; informational / copy only.';



CREATE TABLE IF NOT EXISTS "public"."ranking_collaborations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "owner_id" "uuid" NOT NULL,
    "collaborator_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text",
    "group_name" "text",
    "parent_group_id" "uuid"
);


ALTER TABLE "public"."ranking_collaborations" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."collaboration_details" WITH ("security_invoker"='on') AS
 SELECT "rc"."owner_id",
    "rc"."collaborator_id",
    "rc"."created_at",
    "op"."full_name" AS "owner_full_name",
    "op"."avatar_url" AS "owner_avatar_url",
    "cp"."full_name" AS "collaborator_full_name",
    "cp"."avatar_url" AS "collaborator_avatar_url"
   FROM (("public"."ranking_collaborations" "rc"
     JOIN "public"."profiles" "op" ON (("op"."id" = "rc"."owner_id")))
     LEFT JOIN "public"."profiles" "cp" ON (("cp"."id" = "rc"."collaborator_id")));


ALTER VIEW "public"."collaboration_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_type" "text" NOT NULL,
    "content_id" "uuid" NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chk_content_type" CHECK (("content_type" = ANY (ARRAY['student_review'::"text", 'marketplace_listing'::"text", 'roommate_post'::"text", 'building_chat_link'::"text"]))),
    CONSTRAINT "chk_reason_length" CHECK ((("reason" IS NULL) OR (("char_length"("reason") >= 1) AND ("char_length"("reason") <= 500))))
);


ALTER TABLE "public"."content_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "participant_1" "uuid" NOT NULL,
    "participant_2" "uuid" NOT NULL,
    "last_message" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "participant_1_last_read" timestamp with time zone DEFAULT "now"(),
    "participant_2_last_read" timestamp with time zone DEFAULT "now"(),
    "participant_1_last_notified_at" timestamp with time zone,
    "participant_2_last_notified_at" timestamp with time zone,
    "user_a_last_read_at" timestamp with time zone,
    "user_b_last_read_at" timestamp with time zone,
    "status" "text" DEFAULT 'accepted'::"text" NOT NULL,
    "initiated_by" "uuid",
    CONSTRAINT "conversations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text"])))
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."conversations"."status" IS 'pending = new DM in recipient Requests tab; accepted = normal Chat';



COMMENT ON COLUMN "public"."conversations"."initiated_by" IS 'UUID of the user who created this conversation';



CREATE TABLE IF NOT EXISTS "public"."dining_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "spot_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "rating" integer NOT NULL,
    "content" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "photo_url" "text",
    "is_anonymous" boolean DEFAULT false,
    CONSTRAINT "dining_reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."dining_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dining_spots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "category" "text" DEFAULT 'dining-hall'::"text" NOT NULL,
    "location" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "dining_spots_category_check" CHECK (("category" = ANY (ARRAY['dining-hall'::"text", 'cafe'::"text", 'restaurant'::"text", 'grab-and-go'::"text"])))
);


ALTER TABLE "public"."dining_spots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dining_upvotes" (
    "user_id" "uuid" NOT NULL,
    "spot_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."dining_upvotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dorm_answers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "answer" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dorm_answers_answer_not_empty" CHECK (("length"(TRIM(BOTH FROM "answer")) > 0))
);


ALTER TABLE "public"."dorm_answers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dorm_edits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dorm_id" bigint NOT NULL,
    "edited_by" "uuid",
    "field_name" "text" NOT NULL,
    "old_value" "jsonb",
    "new_value" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dorm_edits_field_name_len_chk" CHECK ((("char_length"("field_name") >= 1) AND ("char_length"("field_name") <= 64)))
);


ALTER TABLE "public"."dorm_edits" OWNER TO "postgres";


COMMENT ON TABLE "public"."dorm_edits" IS 'Audit trail for admin edits to master_housing rows. Immutable - no updates or deletes.';



COMMENT ON COLUMN "public"."dorm_edits"."edited_by" IS 'Nullable because ON DELETE SET NULL is intentional - preserves audit entries even if admin accounts are later deleted.';



CREATE TABLE IF NOT EXISTS "public"."dorm_future_residents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dorm_id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "year" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dorm_future_residents_year_not_empty" CHECK (("length"(TRIM(BOTH FROM "year")) > 0))
);


ALTER TABLE "public"."dorm_future_residents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dorm_question_upvotes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."dorm_question_upvotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dorm_questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dorm_id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "question" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dorm_questions_question_not_empty" CHECK (("length"(TRIM(BOTH FROM "question")) > 0))
);


ALTER TABLE "public"."dorm_questions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."explore_picks" (
    "user_id" "uuid" NOT NULL,
    "product_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."explore_picks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."favorite_listings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "listing_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."favorite_listings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."favorite_roommates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" NOT NULL,
    "prospect_id" "uuid" NOT NULL
);


ALTER TABLE "public"."favorite_roommates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."group_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_message" "text",
    "building_id" bigint,
    "floor" "text",
    CONSTRAINT "chk_floor_requires_building" CHECK ((("floor" IS NULL) OR ("building_id" IS NOT NULL)))
);


ALTER TABLE "public"."group_conversations" OWNER TO "postgres";


COMMENT ON TABLE "public"."group_conversations" IS 'Named group chat rooms with multiple members';



CREATE TABLE IF NOT EXISTS "public"."group_dorm_rankings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid",
    "dorm_id" bigint NOT NULL,
    "rank_order" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."group_dorm_rankings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."group_members" (
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_read_at" timestamp with time zone
);


ALTER TABLE "public"."group_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."group_members" IS 'Membership roster for each group chat';



CREATE TABLE IF NOT EXISTS "public"."group_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "group_messages_content_check" CHECK (("char_length"("content") >= 1))
);


ALTER TABLE "public"."group_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marketplace_listings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "price" numeric NOT NULL,
    "category" "text" NOT NULL,
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "is_sublease" boolean DEFAULT false,
    "sublease_start" "date",
    "sublease_end" "date",
    "building_name" "text",
    "image_urls" "text"[] DEFAULT '{}'::"text"[],
    "condition" "text",
    "meetup_location" "text",
    "show_instagram" boolean DEFAULT false,
    "show_snapchat" boolean DEFAULT false,
    "utilities" "text"[],
    "is_furnished" boolean DEFAULT false,
    "has_parking" boolean DEFAULT false,
    "house_rules" "text",
    "included_utilities" "text"[],
    "additional_rules" "text",
    "parking" boolean DEFAULT false,
    "status" "text" DEFAULT 'available'::"text" NOT NULL,
    "gender_preference" "text" DEFAULT 'Any'::"text",
    "latitude" double precision,
    "longitude" double precision,
    "instagram_handle" "text",
    "snapchat_handle" "text",
    "phone_number" "text",
    "show_phone" boolean DEFAULT false NOT NULL,
    CONSTRAINT "marketplace_listings_status_check" CHECK (("status" = ANY (ARRAY['available'::"text", 'sold'::"text"])))
);


ALTER TABLE "public"."marketplace_listings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."marketplace_listings"."image_urls" IS 'Array of image URLs (up to 10). image_url remains the primary/cover image.';



COMMENT ON COLUMN "public"."marketplace_listings"."condition" IS 'Item condition: New, Like New, Good, Fair';



COMMENT ON COLUMN "public"."marketplace_listings"."meetup_location" IS 'Campus landmark or meetup location for handoff';



COMMENT ON COLUMN "public"."marketplace_listings"."show_instagram" IS 'Whether to display seller Instagram on listing';



COMMENT ON COLUMN "public"."marketplace_listings"."show_snapchat" IS 'Whether to display seller Snapchat on listing';



COMMENT ON COLUMN "public"."marketplace_listings"."utilities" IS 'Utilities included (e.g., WiFi, Electricity, Water, Gas)';



COMMENT ON COLUMN "public"."marketplace_listings"."is_furnished" IS 'Whether the sublease unit is furnished';



COMMENT ON COLUMN "public"."marketplace_listings"."parking" IS 'Whether parking is available';



COMMENT ON COLUMN "public"."marketplace_listings"."status" IS 'Listing status: available (active) or sold';



COMMENT ON COLUMN "public"."marketplace_listings"."latitude" IS 'Geocoded latitude from building_name address (subleases only)';



COMMENT ON COLUMN "public"."marketplace_listings"."longitude" IS 'Geocoded longitude from building_name address (subleases only)';



COMMENT ON COLUMN "public"."marketplace_listings"."instagram_handle" IS 'Seller Instagram handle stored at submit; displayed when show_instagram is true';



COMMENT ON COLUMN "public"."marketplace_listings"."snapchat_handle" IS 'Seller Snapchat handle stored at submit; displayed when show_snapchat is true';



CREATE TABLE IF NOT EXISTS "public"."master_housing" (
    "id" bigint NOT NULL,
    "residence_hall" "text",
    "accomodation" "text",
    "rate_per_term" "text",
    "meal_plan_options" boolean,
    "housing_type" "text",
    "address" "text",
    "capacity" "text",
    "floors" bigint,
    "terms" "text",
    "details" "text",
    "resident_director" "text",
    "who_lives_here" "text",
    "community_type" "text",
    "important_dates" "text",
    "wifi_and_cable" boolean,
    "heat_and_air_conditioning" boolean,
    "window_coverings" boolean,
    "latitude" double precision,
    "longitude" double precision,
    "inroom_amenities" "text",
    "building_amenities" "text",
    "mailing_services" "text",
    "mailing_address" "text",
    "laundry" "text",
    "floorplan" "text",
    "image_url" "text",
    "rent_period" "text",
    "building_llc" "text",
    "move_in_parking_lot" "text",
    "move_in_time_window" "text",
    "move_in_entrance" "text",
    "move_in_cart_location" "text",
    "move_in_notes" "text",
    "move_in_date" "date"
);


ALTER TABLE "public"."master_housing" OWNER TO "postgres";


COMMENT ON COLUMN "public"."master_housing"."move_in_parking_lot" IS 'Assigned parking lot/zone for move-in, e.g. "Lot 12" or "Forbes Garage"';



COMMENT ON COLUMN "public"."master_housing"."move_in_time_window" IS 'Time window for move-in, e.g. "8-11 AM" or "By last name: A-M 9am, N-Z 1pm"';



COMMENT ON COLUMN "public"."master_housing"."move_in_entrance" IS 'Which entrance to use, e.g. "Fifth Ave side entrance"';



COMMENT ON COLUMN "public"."master_housing"."move_in_cart_location" IS 'Where move-in carts are stationed';



COMMENT ON COLUMN "public"."master_housing"."move_in_notes" IS 'Any additional guidance (long-form)';



COMMENT ON COLUMN "public"."master_housing"."move_in_date" IS 'Official move-in day date';



CREATE OR REPLACE VIEW "public"."master_housing_map" WITH ("security_invoker"='on') AS
 SELECT "id",
    "residence_hall",
    "housing_type",
    "who_lives_here",
    "building_llc",
    "heat_and_air_conditioning",
    "rate_per_term",
    "longitude",
    "latitude"
   FROM "public"."master_housing"
  WHERE (("latitude" IS NOT NULL) AND ("longitude" IS NOT NULL));


ALTER VIEW "public"."master_housing_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" bigint NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_read" boolean DEFAULT false
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


ALTER TABLE "public"."messages" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."messages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."off_campus_dining_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "off_campus_spot_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "rating" integer NOT NULL,
    "content" "text",
    "photo_url" "text",
    "is_anonymous" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "off_campus_dining_reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."off_campus_dining_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."off_campus_dining_spots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "neighborhood" "text",
    "category" "text",
    "added_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."off_campus_dining_spots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "payer_id" "uuid" NOT NULL,
    "receiver_id" "uuid" NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "method" "text",
    "status" "text" DEFAULT 'sent'::"text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_history_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "payment_history_no_self" CHECK (("payer_id" <> "receiver_id")),
    CONSTRAINT "payment_history_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'confirmed'::"text"])))
);


ALTER TABLE "public"."payment_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."payment_history" IS 'Checklist group payments; confirmed rows reduce displayed balance vs split obligations.';



CREATE TABLE IF NOT EXISTS "public"."pogoh_station" (
    "Id" bigint NOT NULL,
    "Name" "text",
    "Total Docks" bigint,
    "Latitude" double precision,
    "Longitude" double precision
);


ALTER TABLE "public"."pogoh_station" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_profiles" WITH ("security_invoker"='on') AS
 SELECT "id",
    "full_name",
    "avatar_url",
    "major",
    "grade_level",
    "current_dorm"
   FROM "public"."profiles";


ALTER VIEW "public"."public_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ranking_group_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text",
    "added_at" timestamp with time zone DEFAULT "now"(),
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ranking_group_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roommate_search_interests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."roommate_search_interests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roommate_search_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "post_type" "text" NOT NULL,
    "content" "text" NOT NULL,
    "budget_max" integer,
    "preferred_areas" "text"[] DEFAULT '{}'::"text"[],
    "move_in_semester" "text",
    "spots_total" integer DEFAULT 1 NOT NULL,
    "spots_filled" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "interest_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "address" "text",
    "housing_type" "text",
    "utilities_included" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_furnished" boolean,
    "parking_available" boolean,
    "gender_preference" "text",
    "additional_details" "text",
    "photos" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "instagram" "text",
    "snapchat" "text",
    "phone_number" "text",
    "show_instagram" boolean DEFAULT false NOT NULL,
    "show_snapchat" boolean DEFAULT false NOT NULL,
    "show_phone" boolean DEFAULT false NOT NULL,
    "room_type" "text",
    "lease_length" "text",
    "pets_allowed" boolean,
    CONSTRAINT "roommate_search_posts_check" CHECK ((("spots_filled" >= 0) AND ("spots_filled" <= "spots_total"))),
    CONSTRAINT "roommate_search_posts_content_check" CHECK (("char_length"("content") > 0)),
    CONSTRAINT "roommate_search_posts_gender_preference_check" CHECK ((("gender_preference" IS NULL) OR ("gender_preference" = ANY (ARRAY['any'::"text", 'all-female'::"text", 'all-male'::"text"])))),
    CONSTRAINT "roommate_search_posts_housing_type_check" CHECK ((("housing_type" IS NULL) OR ("housing_type" = ANY (ARRAY['on-campus'::"text", 'off-campus'::"text"])))),
    CONSTRAINT "roommate_search_posts_interest_count_check" CHECK (("interest_count" >= 0)),
    CONSTRAINT "roommate_search_posts_lease_length_check" CHECK (("lease_length" = ANY (ARRAY['month-to-month'::"text", '6-months'::"text", '12-months'::"text"]))),
    CONSTRAINT "roommate_search_posts_post_type_check" CHECK (("post_type" = ANY (ARRAY['looking-for-roommates'::"text", 'have-place-need-people'::"text"]))),
    CONSTRAINT "roommate_search_posts_room_type_check" CHECK (("room_type" = ANY (ARRAY['private'::"text", 'shared'::"text"]))),
    CONSTRAINT "roommate_search_posts_spots_total_check" CHECK (("spots_total" >= 1))
);


ALTER TABLE "public"."roommate_search_posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."saved_businesses" (
    "user_id" "uuid" NOT NULL,
    "business_listing_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."saved_businesses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."saved_dorms" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "dorm_id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."saved_dorms" OWNER TO "postgres";


ALTER TABLE "public"."saved_dorms" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."saved_dorms_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."saved_items" (
    "user_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."saved_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."saved_roommate_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "post_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."saved_roommate_posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."saved_roommates" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "roommate_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."saved_roommates" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."saved_roommates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."saved_roommates_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."saved_roommates_id_seq" OWNED BY "public"."saved_roommates"."id";



CREATE TABLE IF NOT EXISTS "public"."saved_subleases" (
    "user_id" "uuid" NOT NULL,
    "sublease_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."saved_subleases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."setup_comments" (
    "id" bigint NOT NULL,
    "setup_id" bigint NOT NULL,
    "user_id" "uuid",
    "author_name" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "parent_id" bigint
);


ALTER TABLE "public"."setup_comments" OWNER TO "postgres";


ALTER TABLE "public"."setup_comments" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."setup_comments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."setup_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "user_id" "uuid" NOT NULL,
    "setup_id" bigint NOT NULL
);


ALTER TABLE "public"."setup_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."setup_photos" (
    "id" bigint NOT NULL,
    "setup_id" bigint NOT NULL,
    "image_url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."setup_photos" OWNER TO "postgres";


ALTER TABLE "public"."setup_photos" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."setup_photos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."setup_products" (
    "id" bigint NOT NULL,
    "setup_id" bigint NOT NULL,
    "product_name" "text" NOT NULL,
    "product_url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "listing_id" "uuid"
);


ALTER TABLE "public"."setup_products" OWNER TO "postgres";


ALTER TABLE "public"."setup_products" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."setup_products_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."student_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dorm_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "rating" numeric(3,1),
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_anonymous" boolean DEFAULT false,
    "rating_community" numeric(3,1),
    "rating_student_life" numeric(3,1),
    "rating_location" numeric(3,1),
    CONSTRAINT "student_reviews_rating_check" CHECK ((("rating" >= (1)::numeric) AND ("rating" <= (5)::numeric))),
    CONSTRAINT "student_reviews_rating_community_check" CHECK ((("rating_community" IS NULL) OR (("rating_community" >= (1)::numeric) AND ("rating_community" <= (5)::numeric)))),
    CONSTRAINT "student_reviews_rating_location_check" CHECK ((("rating_location" IS NULL) OR (("rating_location" >= (1)::numeric) AND ("rating_location" <= (5)::numeric)))),
    CONSTRAINT "student_reviews_rating_student_life_check" CHECK ((("rating_student_life" IS NULL) OR (("rating_student_life" >= (1)::numeric) AND ("rating_student_life" <= (5)::numeric))))
);


ALTER TABLE "public"."student_reviews" OWNER TO "postgres";


COMMENT ON COLUMN "public"."student_reviews"."rating" IS 'Room quality rating (1-5, half-steps). Repurposed from generic rating. Old reviews retain a value here only.';



COMMENT ON COLUMN "public"."student_reviews"."rating_community" IS 'Community/social rating (1-5, half-steps). NULL for pre-migration reviews.';



COMMENT ON COLUMN "public"."student_reviews"."rating_student_life" IS 'Student life rating (1-5, half-steps). NULL for pre-migration reviews.';



COMMENT ON COLUMN "public"."student_reviews"."rating_location" IS 'Location rating (1-5, half-steps). NULL for pre-migration reviews.';



CREATE TABLE IF NOT EXISTS "public"."student_setups" (
    "id" bigint NOT NULL,
    "dorm_name" "text" NOT NULL,
    "image_url" "text" NOT NULL,
    "caption" "text",
    "author_name" "text",
    "likes" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid" DEFAULT "auth"."uid"(),
    "tags" "jsonb" DEFAULT '[]'::"jsonb",
    "dorm_id" bigint
);


ALTER TABLE "public"."student_setups" OWNER TO "postgres";


COMMENT ON COLUMN "public"."student_setups"."tags" IS 'Array of tag objects: { x: number (0-1), y: number (0-1), product_name: string, product_link: string, photo_index?: number }';



ALTER TABLE "public"."student_setups" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."student_setups_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_dorm_rankings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "dorm_id" bigint NOT NULL,
    "rank_order" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "group_id" "uuid"
);


ALTER TABLE "public"."user_dorm_rankings" OWNER TO "postgres";


ALTER TABLE ONLY "public"."saved_roommates" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."saved_roommates_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."amazon_products"
    ADD CONSTRAINT "amazon_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."building_chat_link_reports"
    ADD CONSTRAINT "building_chat_link_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."building_chat_links"
    ADD CONSTRAINT "building_chat_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bus_stops"
    ADD CONSTRAINT "bus_stops_pkey" PRIMARY KEY ("objectID");



ALTER TABLE ONLY "public"."business_listings"
    ADD CONSTRAINT "business_listings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campus_map_courses"
    ADD CONSTRAINT "campus_map_courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checklist_item_claims"
    ADD CONSTRAINT "checklist_item_claims_pkey" PRIMARY KEY ("item_id", "user_id");



ALTER TABLE ONLY "public"."checklist_items"
    ADD CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."checklist_payment_acks"
    ADD CONSTRAINT "checklist_payment_acks_pkey" PRIMARY KEY ("group_id", "debtor_id", "creditor_id");



ALTER TABLE ONLY "public"."checklist_payments"
    ADD CONSTRAINT "checklist_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_participant_1_participant_2_key" UNIQUE ("participant_1", "participant_2");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dining_reviews"
    ADD CONSTRAINT "dining_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dining_reviews"
    ADD CONSTRAINT "dining_reviews_spot_id_user_id_key" UNIQUE ("spot_id", "user_id");



ALTER TABLE ONLY "public"."dining_spots"
    ADD CONSTRAINT "dining_spots_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."dining_spots"
    ADD CONSTRAINT "dining_spots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dining_spots"
    ADD CONSTRAINT "dining_spots_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."dining_upvotes"
    ADD CONSTRAINT "dining_upvotes_pkey" PRIMARY KEY ("user_id", "spot_id");



ALTER TABLE ONLY "public"."dorm_answers"
    ADD CONSTRAINT "dorm_answers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dorm_edits"
    ADD CONSTRAINT "dorm_edits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dorm_future_residents"
    ADD CONSTRAINT "dorm_future_residents_dorm_user_unique" UNIQUE ("dorm_id", "user_id");



ALTER TABLE ONLY "public"."dorm_future_residents"
    ADD CONSTRAINT "dorm_future_residents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dorm_question_upvotes"
    ADD CONSTRAINT "dorm_question_upvotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dorm_question_upvotes"
    ADD CONSTRAINT "dorm_question_upvotes_question_user_unique" UNIQUE ("question_id", "user_id");



ALTER TABLE ONLY "public"."dorm_questions"
    ADD CONSTRAINT "dorm_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."explore_picks"
    ADD CONSTRAINT "explore_picks_pkey" PRIMARY KEY ("user_id", "product_name");



ALTER TABLE ONLY "public"."favorite_listings"
    ADD CONSTRAINT "favorite_listings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."favorite_listings"
    ADD CONSTRAINT "favorite_listings_user_id_listing_id_key" UNIQUE ("user_id", "listing_id");



ALTER TABLE ONLY "public"."favorite_roommates"
    ADD CONSTRAINT "favorite_roommates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."favorite_roommates"
    ADD CONSTRAINT "favorite_roommates_user_id_prospect_id_key" UNIQUE ("user_id", "prospect_id");



ALTER TABLE ONLY "public"."group_conversations"
    ADD CONSTRAINT "group_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_dorm_rankings"
    ADD CONSTRAINT "group_dorm_rankings_group_id_dorm_id_key" UNIQUE ("group_id", "dorm_id");



ALTER TABLE ONLY "public"."group_dorm_rankings"
    ADD CONSTRAINT "group_dorm_rankings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_pkey" PRIMARY KEY ("group_id", "user_id");



ALTER TABLE ONLY "public"."group_messages"
    ADD CONSTRAINT "group_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketplace_listings"
    ADD CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_housing"
    ADD CONSTRAINT "master_housing_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."off_campus_dining_reviews"
    ADD CONSTRAINT "off_campus_dining_reviews_off_campus_spot_id_user_id_key" UNIQUE ("off_campus_spot_id", "user_id");



ALTER TABLE ONLY "public"."off_campus_dining_reviews"
    ADD CONSTRAINT "off_campus_dining_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."off_campus_dining_spots"
    ADD CONSTRAINT "off_campus_dining_spots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_history"
    ADD CONSTRAINT "payment_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pogoh_station"
    ADD CONSTRAINT "pogoh_station_pkey" PRIMARY KEY ("Id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ranking_collaborations"
    ADD CONSTRAINT "ranking_collaborations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ranking_collaborations"
    ADD CONSTRAINT "ranking_collaborations_ranking_owner_id_collaborator_id_key" UNIQUE ("owner_id", "collaborator_id");



ALTER TABLE ONLY "public"."ranking_group_members"
    ADD CONSTRAINT "ranking_group_members_group_id_user_id_key" UNIQUE ("group_id", "user_id");



ALTER TABLE ONLY "public"."ranking_group_members"
    ADD CONSTRAINT "ranking_group_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roommate_search_interests"
    ADD CONSTRAINT "roommate_search_interests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roommate_search_interests"
    ADD CONSTRAINT "roommate_search_interests_post_id_user_id_key" UNIQUE ("post_id", "user_id");



ALTER TABLE ONLY "public"."roommate_search_posts"
    ADD CONSTRAINT "roommate_search_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."saved_businesses"
    ADD CONSTRAINT "saved_businesses_pkey" PRIMARY KEY ("user_id", "business_listing_id");



ALTER TABLE ONLY "public"."saved_dorms"
    ADD CONSTRAINT "saved_dorms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."saved_dorms"
    ADD CONSTRAINT "saved_dorms_user_id_dorm_id_key" UNIQUE ("user_id", "dorm_id");



ALTER TABLE ONLY "public"."saved_items"
    ADD CONSTRAINT "saved_items_pkey" PRIMARY KEY ("user_id", "item_id");



ALTER TABLE ONLY "public"."saved_roommate_posts"
    ADD CONSTRAINT "saved_roommate_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."saved_roommate_posts"
    ADD CONSTRAINT "saved_roommate_posts_user_id_post_id_key" UNIQUE ("user_id", "post_id");



ALTER TABLE ONLY "public"."saved_roommates"
    ADD CONSTRAINT "saved_roommates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."saved_roommates"
    ADD CONSTRAINT "saved_roommates_user_id_roommate_user_id_key" UNIQUE ("user_id", "roommate_user_id");



ALTER TABLE ONLY "public"."saved_subleases"
    ADD CONSTRAINT "saved_subleases_pkey" PRIMARY KEY ("user_id", "sublease_id");



ALTER TABLE ONLY "public"."setup_comments"
    ADD CONSTRAINT "setup_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."setup_likes"
    ADD CONSTRAINT "setup_likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."setup_likes"
    ADD CONSTRAINT "setup_likes_user_id_setup_id_key" UNIQUE ("user_id", "setup_id");



ALTER TABLE ONLY "public"."setup_photos"
    ADD CONSTRAINT "setup_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."setup_products"
    ADD CONSTRAINT "setup_products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_reviews"
    ADD CONSTRAINT "student_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_setups"
    ADD CONSTRAINT "student_setups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "uniq_one_report_per_user_per_content" UNIQUE ("content_type", "content_id", "reporter_id");



ALTER TABLE ONLY "public"."building_chat_link_reports"
    ADD CONSTRAINT "uniq_one_report_per_user_per_link" UNIQUE ("link_id", "reporter_id");



ALTER TABLE ONLY "public"."student_setups"
    ADD CONSTRAINT "unique_user_setup_per_dorm" UNIQUE ("user_id", "dorm_id");



ALTER TABLE ONLY "public"."user_dorm_rankings"
    ADD CONSTRAINT "user_dorm_rankings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_dorm_rankings"
    ADD CONSTRAINT "user_dorm_rankings_user_dorm_unique" UNIQUE ("user_id", "dorm_id");



CREATE INDEX "analytics_events_created_at_idx" ON "public"."analytics_events" USING "btree" ("created_at" DESC);



CREATE INDEX "analytics_events_event_name_created_at_idx" ON "public"."analytics_events" USING "btree" ("event_name", "created_at" DESC);



CREATE INDEX "analytics_events_user_id_created_at_idx" ON "public"."analytics_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "dorm_edits_created_at_idx" ON "public"."dorm_edits" USING "btree" ("created_at" DESC);



CREATE INDEX "dorm_edits_dorm_id_created_at_idx" ON "public"."dorm_edits" USING "btree" ("dorm_id", "created_at" DESC);



CREATE INDEX "dorm_edits_edited_by_created_at_idx" ON "public"."dorm_edits" USING "btree" ("edited_by", "created_at" DESC);



CREATE INDEX "idx_building_chat_link_reports_link_id" ON "public"."building_chat_link_reports" USING "btree" ("link_id");



CREATE INDEX "idx_building_chat_links_building_year" ON "public"."building_chat_links" USING "btree" ("building_id", "academic_year");



CREATE INDEX "idx_building_chat_links_submitted_by" ON "public"."building_chat_links" USING "btree" ("submitted_by") WHERE ("submitted_by" IS NOT NULL);



CREATE INDEX "idx_campus_map_courses_created_at" ON "public"."campus_map_courses" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_campus_map_courses_user_id" ON "public"."campus_map_courses" USING "btree" ("user_id");



CREATE INDEX "idx_checklist_item_claims_item_id" ON "public"."checklist_item_claims" USING "btree" ("item_id");



CREATE INDEX "idx_checklist_item_claims_user_id" ON "public"."checklist_item_claims" USING "btree" ("user_id");



CREATE INDEX "idx_checklist_items_group_id" ON "public"."checklist_items" USING "btree" ("group_id");



CREATE INDEX "idx_checklist_payment_acks_group" ON "public"."checklist_payment_acks" USING "btree" ("group_id");



CREATE INDEX "idx_checklist_payments_group_id" ON "public"."checklist_payments" USING "btree" ("group_id");



CREATE INDEX "idx_checklist_payments_payer_payee_group" ON "public"."checklist_payments" USING "btree" ("group_id", "payer_id", "payee_id");



CREATE INDEX "idx_checklist_user_category" ON "public"."checklist_items" USING "btree" ("user_id", "category");



CREATE INDEX "idx_content_reports_content" ON "public"."content_reports" USING "btree" ("content_type", "content_id");



CREATE INDEX "idx_content_reports_created_at" ON "public"."content_reports" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_conversations_p2_fkey" ON "public"."conversations" USING "btree" ("participant_2");



CREATE INDEX "idx_dining_reviews_spot" ON "public"."dining_reviews" USING "btree" ("spot_id", "created_at" DESC);



CREATE INDEX "idx_dining_upvotes_spot" ON "public"."dining_upvotes" USING "btree" ("spot_id");



CREATE INDEX "idx_dorm_answers_question_id_created" ON "public"."dorm_answers" USING "btree" ("question_id", "created_at");



CREATE INDEX "idx_dorm_future_residents_dorm_id" ON "public"."dorm_future_residents" USING "btree" ("dorm_id");



CREATE INDEX "idx_dorm_question_upvotes_question_id" ON "public"."dorm_question_upvotes" USING "btree" ("question_id");



CREATE INDEX "idx_dorm_questions_dorm_id_created" ON "public"."dorm_questions" USING "btree" ("dorm_id", "created_at" DESC);



CREATE INDEX "idx_explore_picks_user_id" ON "public"."explore_picks" USING "btree" ("user_id");



CREATE INDEX "idx_fav_listings_id_fkey" ON "public"."favorite_listings" USING "btree" ("listing_id");



CREATE INDEX "idx_fav_roommates_prospect_fkey" ON "public"."favorite_roommates" USING "btree" ("prospect_id");



CREATE INDEX "idx_group_conversations_building_id" ON "public"."group_conversations" USING "btree" ("building_id") WHERE ("building_id" IS NOT NULL);



CREATE INDEX "idx_group_members_user_id" ON "public"."group_members" USING "btree" ("user_id");



CREATE INDEX "idx_group_messages_group_id_created_at" ON "public"."group_messages" USING "btree" ("group_id", "created_at" DESC);



CREATE INDEX "idx_msgs_conv_id_fkey" ON "public"."messages" USING "btree" ("conversation_id");



CREATE INDEX "idx_msgs_sender_id_fkey" ON "public"."messages" USING "btree" ("sender_id");



CREATE INDEX "idx_off_campus_dining_reviews_spot" ON "public"."off_campus_dining_reviews" USING "btree" ("off_campus_spot_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_off_campus_dining_spots_name_lower" ON "public"."off_campus_dining_spots" USING "btree" ("lower"("name"));



CREATE INDEX "idx_payment_history_group" ON "public"."payment_history" USING "btree" ("group_id");



CREATE INDEX "idx_payment_history_group_payer_receiver" ON "public"."payment_history" USING "btree" ("group_id", "payer_id", "receiver_id");



CREATE INDEX "idx_rank_coll_collab_fkey" ON "public"."ranking_collaborations" USING "btree" ("collaborator_id");



CREATE INDEX "idx_rank_coll_group_fkey" ON "public"."ranking_collaborations" USING "btree" ("parent_group_id");



CREATE INDEX "idx_reviews_dorm_id" ON "public"."student_reviews" USING "btree" ("dorm_id");



CREATE INDEX "idx_roommate_interests_post" ON "public"."roommate_search_interests" USING "btree" ("post_id");



CREATE INDEX "idx_roommate_posts_active" ON "public"."roommate_search_posts" USING "btree" ("is_active", "created_at" DESC);



CREATE INDEX "idx_saved_items_item_id" ON "public"."saved_items" USING "btree" ("item_id");



CREATE INDEX "idx_saved_items_user_id" ON "public"."saved_items" USING "btree" ("user_id");



CREATE INDEX "idx_saved_roommate_posts_post_id" ON "public"."saved_roommate_posts" USING "btree" ("post_id");



CREATE INDEX "idx_saved_roommate_posts_user_id" ON "public"."saved_roommate_posts" USING "btree" ("user_id");



CREATE INDEX "idx_saved_roommates_user_fkey" ON "public"."saved_roommates" USING "btree" ("roommate_user_id");



CREATE INDEX "idx_saved_subleases_sublease_id" ON "public"."saved_subleases" USING "btree" ("sublease_id");



CREATE INDEX "idx_saved_subleases_user_id" ON "public"."saved_subleases" USING "btree" ("user_id");



CREATE INDEX "idx_setup_comm_parent_fkey" ON "public"."setup_comments" USING "btree" ("parent_id");



CREATE INDEX "idx_setup_comm_setup_fkey" ON "public"."setup_comments" USING "btree" ("setup_id");



CREATE INDEX "idx_setup_comm_user_fkey" ON "public"."setup_comments" USING "btree" ("user_id");



CREATE INDEX "idx_setup_likes_setup_fkey" ON "public"."setup_likes" USING "btree" ("setup_id");



CREATE INDEX "idx_setup_photos_setup_fkey" ON "public"."setup_photos" USING "btree" ("setup_id");



CREATE INDEX "idx_setup_prod_listing_fkey" ON "public"."setup_products" USING "btree" ("listing_id");



CREATE INDEX "idx_setup_prod_setup_fkey" ON "public"."setup_products" USING "btree" ("setup_id");



CREATE INDEX "idx_student_reviews_user_fkey" ON "public"."student_reviews" USING "btree" ("user_id");



CREATE INDEX "idx_student_setups_dorm_id" ON "public"."student_setups" USING "btree" ("dorm_id");



CREATE UNIQUE INDEX "idx_user_dorm_rankings_group" ON "public"."user_dorm_rankings" USING "btree" ("user_id", "dorm_id", "group_id") WHERE ("group_id" IS NOT NULL);



CREATE UNIQUE INDEX "idx_user_dorm_rankings_personal" ON "public"."user_dorm_rankings" USING "btree" ("user_id", "dorm_id") WHERE ("group_id" IS NULL);



CREATE INDEX "idx_user_rankings_dorm_fkey" ON "public"."user_dorm_rankings" USING "btree" ("dorm_id");



CREATE INDEX "idx_user_rankings_group_fkey" ON "public"."user_dorm_rankings" USING "btree" ("group_id");



CREATE UNIQUE INDEX "marketplace_listings_user_one_active_sublease" ON "public"."marketplace_listings" USING "btree" ("user_id") WHERE (("is_sublease" = true) AND ("status" = 'available'::"text"));



CREATE UNIQUE INDEX "student_setups_user_dorm_unique" ON "public"."student_setups" USING "btree" ("user_id", "dorm_id") WHERE ("dorm_id" IS NOT NULL);



CREATE UNIQUE INDEX "uniq_group_conv_building_floor" ON "public"."group_conversations" USING "btree" ("building_id", "floor") WHERE (("building_id" IS NOT NULL) AND ("floor" IS NOT NULL));



CREATE UNIQUE INDEX "uniq_group_conv_building_wide" ON "public"."group_conversations" USING "btree" ("building_id") WHERE (("building_id" IS NOT NULL) AND ("floor" IS NULL));



CREATE UNIQUE INDEX "unique_active_sublease_per_user" ON "public"."marketplace_listings" USING "btree" ("user_id") WHERE (("category" = 'Sublease'::"text") AND ("status" = 'available'::"text"));



CREATE OR REPLACE TRIGGER "on_new_message" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."update_conversation_timestamp"();



CREATE OR REPLACE TRIGGER "on_personal_ranking_update" AFTER UPDATE ON "public"."user_dorm_rankings" FOR EACH ROW EXECUTE FUNCTION "public"."sync_personal_to_group"();



CREATE OR REPLACE TRIGGER "on_profile_created_checklist" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user_checklist"();



CREATE OR REPLACE TRIGGER "sync_member_status_trigger" AFTER UPDATE OF "status" ON "public"."ranking_collaborations" FOR EACH ROW EXECUTE FUNCTION "public"."sync_group_status"();



CREATE OR REPLACE TRIGGER "tr_protect_email" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."protect_profile_email"();



CREATE OR REPLACE TRIGGER "tr_roommate_search_interests_count" AFTER INSERT OR DELETE ON "public"."roommate_search_interests" FOR EACH ROW EXECUTE FUNCTION "public"."roommate_search_interests_bump_count"();



CREATE OR REPLACE TRIGGER "tr_roommate_search_posts_updated_at" BEFORE UPDATE ON "public"."roommate_search_posts" FOR EACH ROW EXECUTE FUNCTION "public"."roommate_search_posts_set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_building_chat_links_updated_at" BEFORE UPDATE ON "public"."building_chat_links" FOR EACH ROW EXECUTE FUNCTION "public"."update_building_chat_links_updated_at"();



CREATE OR REPLACE TRIGGER "trg_eject_from_unmatched_building_chats" AFTER UPDATE OF "current_dorm", "housing_type" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."eject_from_unmatched_building_chats"();



CREATE OR REPLACE TRIGGER "trg_payment_history_confirm" BEFORE UPDATE ON "public"."payment_history" FOR EACH ROW EXECUTE FUNCTION "public"."payment_history_receiver_confirm"();



CREATE OR REPLACE TRIGGER "trg_ranking_group_members_sync_group_rankings" AFTER INSERT OR UPDATE OF "status" ON "public"."ranking_group_members" FOR EACH ROW EXECUTE FUNCTION "public"."trg_sync_group_rankings_on_member_accept"();



CREATE OR REPLACE TRIGGER "trigger_limit_listings" BEFORE INSERT ON "public"."marketplace_listings" FOR EACH ROW EXECUTE FUNCTION "public"."limit_user_listings"();



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."building_chat_link_reports"
    ADD CONSTRAINT "building_chat_link_reports_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."building_chat_links"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."building_chat_link_reports"
    ADD CONSTRAINT "building_chat_link_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."building_chat_links"
    ADD CONSTRAINT "building_chat_links_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "public"."master_housing"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."building_chat_links"
    ADD CONSTRAINT "building_chat_links_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."business_listings"
    ADD CONSTRAINT "business_listings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campus_map_courses"
    ADD CONSTRAINT "campus_map_courses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_item_claims"
    ADD CONSTRAINT "checklist_item_claims_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."checklist_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_item_claims"
    ADD CONSTRAINT "checklist_item_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_items"
    ADD CONSTRAINT "checklist_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."ranking_collaborations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_items"
    ADD CONSTRAINT "checklist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_payment_acks"
    ADD CONSTRAINT "checklist_payment_acks_creditor_id_fkey" FOREIGN KEY ("creditor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_payment_acks"
    ADD CONSTRAINT "checklist_payment_acks_debtor_id_fkey" FOREIGN KEY ("debtor_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_payment_acks"
    ADD CONSTRAINT "checklist_payment_acks_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."ranking_collaborations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_payments"
    ADD CONSTRAINT "checklist_payments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."ranking_collaborations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_payments"
    ADD CONSTRAINT "checklist_payments_payee_id_fkey" FOREIGN KEY ("payee_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."checklist_payments"
    ADD CONSTRAINT "checklist_payments_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_participant_1_fkey" FOREIGN KEY ("participant_1") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_participant_2_fkey" FOREIGN KEY ("participant_2") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dining_reviews"
    ADD CONSTRAINT "dining_reviews_spot_id_fkey" FOREIGN KEY ("spot_id") REFERENCES "public"."dining_spots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dining_reviews"
    ADD CONSTRAINT "dining_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dining_upvotes"
    ADD CONSTRAINT "dining_upvotes_spot_id_fkey" FOREIGN KEY ("spot_id") REFERENCES "public"."dining_spots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dining_upvotes"
    ADD CONSTRAINT "dining_upvotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dorm_answers"
    ADD CONSTRAINT "dorm_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."dorm_questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dorm_answers"
    ADD CONSTRAINT "dorm_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dorm_edits"
    ADD CONSTRAINT "dorm_edits_dorm_id_fkey" FOREIGN KEY ("dorm_id") REFERENCES "public"."master_housing"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dorm_edits"
    ADD CONSTRAINT "dorm_edits_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dorm_future_residents"
    ADD CONSTRAINT "dorm_future_residents_dorm_id_fkey" FOREIGN KEY ("dorm_id") REFERENCES "public"."master_housing"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dorm_future_residents"
    ADD CONSTRAINT "dorm_future_residents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dorm_question_upvotes"
    ADD CONSTRAINT "dorm_question_upvotes_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."dorm_questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dorm_question_upvotes"
    ADD CONSTRAINT "dorm_question_upvotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dorm_questions"
    ADD CONSTRAINT "dorm_questions_dorm_id_fkey" FOREIGN KEY ("dorm_id") REFERENCES "public"."master_housing"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dorm_questions"
    ADD CONSTRAINT "dorm_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."explore_picks"
    ADD CONSTRAINT "explore_picks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."favorite_listings"
    ADD CONSTRAINT "favorite_listings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."favorite_listings"
    ADD CONSTRAINT "favorite_listings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."favorite_roommates"
    ADD CONSTRAINT "favorite_roommates_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."favorite_roommates"
    ADD CONSTRAINT "favorite_roommates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ranking_collaborations"
    ADD CONSTRAINT "fk_collaborator" FOREIGN KEY ("collaborator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ranking_collaborations"
    ADD CONSTRAINT "fk_collaborator_profile" FOREIGN KEY ("collaborator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_conversations"
    ADD CONSTRAINT "group_conversations_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "public"."master_housing"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_conversations"
    ADD CONSTRAINT "group_conversations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."group_dorm_rankings"
    ADD CONSTRAINT "group_dorm_rankings_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."ranking_collaborations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."group_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_members"
    ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_messages"
    ADD CONSTRAINT "group_messages_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."group_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."group_messages"
    ADD CONSTRAINT "group_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marketplace_listings"
    ADD CONSTRAINT "marketplace_listings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."off_campus_dining_reviews"
    ADD CONSTRAINT "off_campus_dining_reviews_off_campus_spot_id_fkey" FOREIGN KEY ("off_campus_spot_id") REFERENCES "public"."off_campus_dining_spots"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."off_campus_dining_reviews"
    ADD CONSTRAINT "off_campus_dining_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."off_campus_dining_spots"
    ADD CONSTRAINT "off_campus_dining_spots_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payment_history"
    ADD CONSTRAINT "payment_history_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."ranking_collaborations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_history"
    ADD CONSTRAINT "payment_history_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payment_history"
    ADD CONSTRAINT "payment_history_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ranking_collaborations"
    ADD CONSTRAINT "ranking_collaborations_collaborator_id_fkey" FOREIGN KEY ("collaborator_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ranking_collaborations"
    ADD CONSTRAINT "ranking_collaborations_parent_group_id_fkey" FOREIGN KEY ("parent_group_id") REFERENCES "public"."ranking_collaborations"("id");



ALTER TABLE ONLY "public"."ranking_collaborations"
    ADD CONSTRAINT "ranking_collaborations_ranking_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ranking_group_members"
    ADD CONSTRAINT "ranking_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."ranking_collaborations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roommate_search_interests"
    ADD CONSTRAINT "roommate_search_interests_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."roommate_search_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roommate_search_interests"
    ADD CONSTRAINT "roommate_search_interests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roommate_search_posts"
    ADD CONSTRAINT "roommate_search_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_businesses"
    ADD CONSTRAINT "saved_businesses_business_listing_id_fkey" FOREIGN KEY ("business_listing_id") REFERENCES "public"."business_listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_businesses"
    ADD CONSTRAINT "saved_businesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_dorms"
    ADD CONSTRAINT "saved_dorms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_items"
    ADD CONSTRAINT "saved_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_items"
    ADD CONSTRAINT "saved_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_roommate_posts"
    ADD CONSTRAINT "saved_roommate_posts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."roommate_search_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_roommate_posts"
    ADD CONSTRAINT "saved_roommate_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_roommates"
    ADD CONSTRAINT "saved_roommates_roommate_user_id_fkey" FOREIGN KEY ("roommate_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_roommates"
    ADD CONSTRAINT "saved_roommates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_subleases"
    ADD CONSTRAINT "saved_subleases_sublease_id_fkey" FOREIGN KEY ("sublease_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_subleases"
    ADD CONSTRAINT "saved_subleases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."setup_comments"
    ADD CONSTRAINT "setup_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."setup_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."setup_comments"
    ADD CONSTRAINT "setup_comments_setup_id_fkey" FOREIGN KEY ("setup_id") REFERENCES "public"."student_setups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."setup_comments"
    ADD CONSTRAINT "setup_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."setup_likes"
    ADD CONSTRAINT "setup_likes_setup_id_fkey" FOREIGN KEY ("setup_id") REFERENCES "public"."student_setups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."setup_likes"
    ADD CONSTRAINT "setup_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."setup_photos"
    ADD CONSTRAINT "setup_photos_setup_id_fkey" FOREIGN KEY ("setup_id") REFERENCES "public"."student_setups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."setup_products"
    ADD CONSTRAINT "setup_products_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id");



ALTER TABLE ONLY "public"."setup_products"
    ADD CONSTRAINT "setup_products_setup_id_fkey" FOREIGN KEY ("setup_id") REFERENCES "public"."student_setups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_reviews"
    ADD CONSTRAINT "student_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."student_setups"
    ADD CONSTRAINT "student_setups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."user_dorm_rankings"
    ADD CONSTRAINT "user_dorm_rankings_dorm_id_fkey" FOREIGN KEY ("dorm_id") REFERENCES "public"."master_housing"("id");



ALTER TABLE ONLY "public"."user_dorm_rankings"
    ADD CONSTRAINT "user_dorm_rankings_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."ranking_collaborations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_dorm_rankings"
    ADD CONSTRAINT "user_dorm_rankings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can update all listings" ON "public"."business_listings" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "Admins can view all listings" ON "public"."business_listings" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "Anyone authenticated can view" ON "public"."off_campus_dining_spots" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Anyone can view amazon products" ON "public"."amazon_products" FOR SELECT USING (true);



CREATE POLICY "Anyone can view approved listings" ON "public"."business_listings" FOR SELECT USING ((("is_approved" = true) AND ("is_active" = true)));



CREATE POLICY "Anyone verified can read dining spots" ON "public"."dining_spots" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Anyone verified can read dining upvotes" ON "public"."dining_upvotes" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Anyone verified can read off-campus reviews" ON "public"."off_campus_dining_reviews" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Anyone verified can read reviews" ON "public"."dining_reviews" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can insert" ON "public"."off_campus_dining_spots" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "added_by"));



CREATE POLICY "Group members can manage shared rankings" ON "public"."group_dorm_rankings" USING ((("group_id" IN ( SELECT "public"."get_my_accepted_group_ids"() AS "get_my_accepted_group_ids")) OR ("group_id" IN ( SELECT "public"."get_groups_i_own"() AS "get_groups_i_own"))));



CREATE POLICY "Group members can view each other's saved dorms" ON "public"."saved_dorms" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."ranking_group_members" "my_mem"
     JOIN "public"."ranking_group_members" "their_mem" ON (("my_mem"."group_id" = "their_mem"."group_id")))
  WHERE (("my_mem"."user_id" = "auth"."uid"()) AND ("their_mem"."user_id" = "saved_dorms"."user_id") AND ("my_mem"."status" = 'accepted'::"text") AND ("their_mem"."status" = 'accepted'::"text")))));



CREATE POLICY "Members (including pending) can view group details" ON "public"."ranking_collaborations" FOR SELECT USING ((("id" IN ( SELECT "public"."get_my_all_group_ids"() AS "get_my_all_group_ids")) OR ("owner_id" = "auth"."uid"())));



CREATE POLICY "Members can delete their group" ON "public"."ranking_collaborations" FOR DELETE TO "authenticated" USING (("id" IN ( SELECT "ranking_group_members"."group_id"
   FROM "public"."ranking_group_members"
  WHERE ("ranking_group_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Members can insert group rankings" ON "public"."group_dorm_rankings" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Members can update group details" ON "public"."ranking_collaborations" FOR UPDATE TO "authenticated" USING (("id" IN ( SELECT "ranking_group_members"."group_id"
   FROM "public"."ranking_group_members"
  WHERE ("ranking_group_members"."user_id" = "auth"."uid"())))) WITH CHECK (("id" IN ( SELECT "ranking_group_members"."group_id"
   FROM "public"."ranking_group_members"
  WHERE ("ranking_group_members"."user_id" = "auth"."uid"()))));



CREATE POLICY "Members can update group rankings" ON "public"."group_dorm_rankings" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "Members can update group status" ON "public"."ranking_collaborations" FOR UPDATE USING ((("id" IN ( SELECT "public"."get_my_all_group_ids"() AS "get_my_all_group_ids")) OR ("owner_id" = "auth"."uid"())));



CREATE POLICY "Members can view all group rankings" ON "public"."group_dorm_rankings" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."ranking_group_members"
  WHERE (("ranking_group_members"."group_id" = "group_dorm_rankings"."group_id") AND ("ranking_group_members"."user_id" = "auth"."uid"())))));



CREATE POLICY "Members can view other members in their group" ON "public"."ranking_group_members" FOR SELECT USING (("group_id" IN ( SELECT "public"."get_my_accepted_group_ids"() AS "get_my_accepted_group_ids")));



CREATE POLICY "Only admins can delete amazon products" ON "public"."amazon_products" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "Only admins can insert amazon products" ON "public"."amazon_products" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "Only admins can update amazon products" ON "public"."amazon_products" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "Owner can view own listings" ON "public"."business_listings" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Owners can manage members of their groups" ON "public"."ranking_group_members" USING (("group_id" IN ( SELECT "public"."get_groups_i_own"() AS "get_groups_i_own")));



CREATE POLICY "Owners can view/edit their groups" ON "public"."ranking_collaborations" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "Public profiles are viewable by everyone" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Students can delete their own listing" ON "public"."business_listings" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Students can insert their own listing" ON "public"."business_listings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Students can update their own listing" ON "public"."business_listings" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can accept their own invites" ON "public"."ranking_group_members" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can add picks" ON "public"."explore_picks" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can delete own marketplace listings" ON "public"."marketplace_listings" FOR DELETE TO "authenticated" USING ((("auth"."uid"() = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true))))));



CREATE POLICY "Users can delete own rankings" ON "public"."user_dorm_rankings" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own saved items" ON "public"."saved_items" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own saved subleases" ON "public"."saved_subleases" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own off-campus review" ON "public"."off_campus_dining_reviews" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own review" ON "public"."dining_reviews" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own rankings" ON "public"."user_dorm_rankings" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own saved items" ON "public"."saved_items" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own saved subleases" ON "public"."saved_subleases" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can leave groups" ON "public"."ranking_group_members" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can manage own saved businesses" ON "public"."saved_businesses" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own checklist" ON "public"."checklist_items" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can remove picks" ON "public"."explore_picks" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users can remove upvote" ON "public"."dining_upvotes" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can save roommates via swipe" ON "public"."saved_roommates" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own rankings" ON "public"."user_dorm_rankings" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update shared checklist items" ON "public"."checklist_items" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR ("group_id" IN ( SELECT "ranking_group_members"."group_id"
   FROM "public"."ranking_group_members"
  WHERE ("ranking_group_members"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can update their own off-campus review" ON "public"."off_campus_dining_reviews" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own review" ON "public"."dining_reviews" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can upvote" ON "public"."dining_upvotes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own memberships" ON "public"."ranking_group_members" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can view own rankings" ON "public"."user_dorm_rankings" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own saved businesses" ON "public"."saved_businesses" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own saved items" ON "public"."saved_items" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own saved subleases" ON "public"."saved_subleases" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view shared checklist items" ON "public"."checklist_items" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR ("group_id" IN ( SELECT "ranking_group_members"."group_id"
   FROM "public"."ranking_group_members"
  WHERE ("ranking_group_members"."user_id" = "auth"."uid"())))));



CREATE POLICY "Users can view their own picks" ON "public"."explore_picks" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Users manage their own saved dorms" ON "public"."saved_dorms" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Verified users can create off-campus reviews" ON "public"."off_campus_dining_reviews" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Verified users can create reviews" ON "public"."dining_reviews" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "View groups I am invited to" ON "public"."ranking_collaborations" FOR SELECT USING ((("owner_id" = "auth"."uid"()) OR ("id" IN ( SELECT "ranking_group_members"."group_id"
   FROM "public"."ranking_group_members"
  WHERE ("ranking_group_members"."user_id" = "auth"."uid"())))));



CREATE POLICY "admins_insert_dorm_edits" ON "public"."dorm_edits" FOR INSERT TO "authenticated" WITH CHECK ((("edited_by" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."is_admin" = true))))));



CREATE POLICY "admins_read_dorm_edits" ON "public"."dorm_edits" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "admins_update_master_housing" ON "public"."master_housing" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = ( SELECT "auth"."uid"() AS "uid")) AND ("profiles"."is_admin" = true)))));



COMMENT ON POLICY "admins_update_master_housing" ON "public"."master_housing" IS 'Admins can update housing rows. All edits are audited via public.dorm_edits (Phase 1 migration).';



ALTER TABLE "public"."amazon_products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."analytics_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."building_chat_link_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."building_chat_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."bus_stops" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."business_listings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campus_map_courses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "campus_map_courses_delete_own" ON "public"."campus_map_courses" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "campus_map_courses_insert_own" ON "public"."campus_map_courses" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "campus_map_courses_select_own" ON "public"."campus_map_courses" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "campus_map_courses_update_own" ON "public"."campus_map_courses" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."checklist_item_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."checklist_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."checklist_payment_acks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "checklist_payment_acks_insert" ON "public"."checklist_payment_acks" FOR INSERT TO "authenticated" WITH CHECK ((("debtor_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."ranking_group_members" "rgm"
  WHERE (("rgm"."group_id" = "checklist_payment_acks"."group_id") AND ("rgm"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("rgm"."status" = 'accepted'::"text"))))));



CREATE POLICY "checklist_payment_acks_select" ON "public"."checklist_payment_acks" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."ranking_group_members" "rgm"
  WHERE (("rgm"."group_id" = "checklist_payment_acks"."group_id") AND ("rgm"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("rgm"."status" = 'accepted'::"text")))));



CREATE POLICY "checklist_payment_acks_update" ON "public"."checklist_payment_acks" FOR UPDATE TO "authenticated" USING (("debtor_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("debtor_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."checklist_payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "checklist_payments_insert" ON "public"."checklist_payments" FOR INSERT TO "authenticated" WITH CHECK (("payer_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "checklist_payments_insert_payee" ON "public"."checklist_payments" FOR INSERT TO "authenticated" WITH CHECK ((("payee_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("payer_id" <> ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."ranking_group_members" "rgm"
  WHERE (("rgm"."group_id" = "checklist_payments"."group_id") AND ("rgm"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("rgm"."status" = 'accepted'::"text"))))));



CREATE POLICY "checklist_payments_select" ON "public"."checklist_payments" FOR SELECT TO "authenticated" USING ((("payer_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("payee_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "checklist_payments_update" ON "public"."checklist_payments" FOR UPDATE TO "authenticated" USING (("payer_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("payer_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."content_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dining_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dining_spots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dining_upvotes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dorm_answers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dorm_answers_delete_own" ON "public"."dorm_answers" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "dorm_answers_insert_own" ON "public"."dorm_answers" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "dorm_answers_select_anon" ON "public"."dorm_answers" FOR SELECT TO "anon" USING (true);



CREATE POLICY "dorm_answers_select_authenticated" ON "public"."dorm_answers" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "dorm_answers_update_own" ON "public"."dorm_answers" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."dorm_edits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dorm_future_residents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dorm_future_residents_delete_own" ON "public"."dorm_future_residents" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "dorm_future_residents_insert_own" ON "public"."dorm_future_residents" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "dorm_future_residents_select_anon" ON "public"."dorm_future_residents" FOR SELECT TO "anon" USING (true);



CREATE POLICY "dorm_future_residents_select_authenticated" ON "public"."dorm_future_residents" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."dorm_question_upvotes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dorm_question_upvotes_delete_own" ON "public"."dorm_question_upvotes" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "dorm_question_upvotes_insert_own" ON "public"."dorm_question_upvotes" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "dorm_question_upvotes_select_all" ON "public"."dorm_question_upvotes" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."dorm_questions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dorm_questions_delete_own" ON "public"."dorm_questions" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "dorm_questions_insert_own" ON "public"."dorm_questions" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "dorm_questions_select_anon" ON "public"."dorm_questions" FOR SELECT TO "anon" USING (true);



CREATE POLICY "dorm_questions_select_authenticated" ON "public"."dorm_questions" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "dorm_questions_update_own" ON "public"."dorm_questions" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."explore_picks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."favorite_listings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."favorite_roommates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_dorm_rankings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."group_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."marketplace_listings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."master_housing" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."off_campus_dining_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."off_campus_dining_spots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payment_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payment_history_insert" ON "public"."payment_history" FOR INSERT TO "authenticated" WITH CHECK (((("payer_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("receiver_id" = ( SELECT "auth"."uid"() AS "uid"))) AND (EXISTS ( SELECT 1
   FROM "public"."ranking_group_members" "rgm"
  WHERE (("rgm"."group_id" = "payment_history"."group_id") AND ("rgm"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("rgm"."status" = 'accepted'::"text"))))));



CREATE POLICY "payment_history_select" ON "public"."payment_history" FOR SELECT TO "authenticated" USING ((("payer_id" = ( SELECT "auth"."uid"() AS "uid")) OR ("receiver_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "payment_history_update_receiver" ON "public"."payment_history" FOR UPDATE TO "authenticated" USING (("receiver_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ((("receiver_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("status" = 'confirmed'::"text")));



ALTER TABLE "public"."pogoh_station" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ranking_collaborations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ranking_group_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rls_analytics_events_insert" ON "public"."analytics_events" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "rls_bcl_delete" ON "public"."building_chat_links" FOR DELETE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "submitted_by") OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true))))));



CREATE POLICY "rls_bcl_insert" ON "public"."building_chat_links" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "submitted_by") AND "public"."user_current_dorm_matches_building"("building_id") AND ("academic_year" = "public"."current_academic_year"())));



CREATE POLICY "rls_bcl_select" ON "public"."building_chat_links" FOR SELECT TO "authenticated" USING ("public"."user_current_dorm_matches_building"("building_id"));



CREATE POLICY "rls_bcl_update" ON "public"."building_chat_links" FOR UPDATE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "submitted_by") OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "submitted_by") OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true))))));



CREATE POLICY "rls_bclr_delete_admin" ON "public"."building_chat_link_reports" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "rls_bclr_insert" ON "public"."building_chat_link_reports" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "reporter_id") AND (EXISTS ( SELECT 1
   FROM "public"."building_chat_links" "bcl"
  WHERE (("bcl"."id" = "building_chat_link_reports"."link_id") AND "public"."user_current_dorm_matches_building"("bcl"."building_id"))))));



CREATE POLICY "rls_bclr_select_admin" ON "public"."building_chat_link_reports" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "rls_bus_stops_select" ON "public"."bus_stops" FOR SELECT USING (true);



CREATE POLICY "rls_checklist_item_claims_delete" ON "public"."checklist_item_claims" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "rls_checklist_item_claims_insert" ON "public"."checklist_item_claims" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."checklist_items" "ci"
     LEFT JOIN "public"."ranking_group_members" "rgm" ON ((("rgm"."group_id" = "ci"."group_id") AND ("rgm"."user_id" = "auth"."uid"()) AND ("rgm"."status" = 'accepted'::"text"))))
  WHERE (("ci"."id" = "checklist_item_claims"."item_id") AND ("ci"."group_id" IS NOT NULL) AND ("rgm"."user_id" IS NOT NULL))))));



CREATE POLICY "rls_checklist_item_claims_select" ON "public"."checklist_item_claims" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."checklist_items" "ci"
     LEFT JOIN "public"."ranking_group_members" "rgm" ON ((("rgm"."group_id" = "ci"."group_id") AND ("rgm"."user_id" = "auth"."uid"()) AND ("rgm"."status" = 'accepted'::"text"))))
  WHERE (("ci"."id" = "checklist_item_claims"."item_id") AND ((("ci"."group_id" IS NULL) AND ("ci"."user_id" = "auth"."uid"())) OR ("rgm"."user_id" IS NOT NULL))))));



CREATE POLICY "rls_checklist_items_delete" ON "public"."checklist_items" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_checklist_items_insert" ON "public"."checklist_items" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_checklist_items_select" ON "public"."checklist_items" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (("group_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."ranking_group_members" "rgm"
  WHERE (("rgm"."group_id" = "checklist_items"."group_id") AND ("rgm"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("rgm"."status" = 'accepted'::"text")))))));



CREATE POLICY "rls_checklist_items_update" ON "public"."checklist_items" FOR UPDATE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (("group_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."ranking_group_members" "rgm"
  WHERE (("rgm"."group_id" = "checklist_items"."group_id") AND ("rgm"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("rgm"."status" = 'accepted'::"text"))))))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (("group_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."ranking_group_members" "rgm"
  WHERE (("rgm"."group_id" = "checklist_items"."group_id") AND ("rgm"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("rgm"."status" = 'accepted'::"text")))))));



CREATE POLICY "rls_content_reports_delete_admin" ON "public"."content_reports" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "rls_content_reports_insert" ON "public"."content_reports" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "reporter_id"));



CREATE POLICY "rls_content_reports_select_admin" ON "public"."content_reports" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "rls_conversations_delete" ON "public"."conversations" FOR DELETE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "participant_1") OR (( SELECT "auth"."uid"() AS "uid") = "participant_2")));



CREATE POLICY "rls_conversations_insert" ON "public"."conversations" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "participant_1") OR (( SELECT "auth"."uid"() AS "uid") = "participant_2")));



CREATE POLICY "rls_conversations_select" ON "public"."conversations" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "participant_1") OR (( SELECT "auth"."uid"() AS "uid") = "participant_2")));



CREATE POLICY "rls_conversations_update" ON "public"."conversations" FOR UPDATE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "participant_1") OR (( SELECT "auth"."uid"() AS "uid") = "participant_2"))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "participant_1") OR (( SELECT "auth"."uid"() AS "uid") = "participant_2")));



CREATE POLICY "rls_favorite_listings_delete" ON "public"."favorite_listings" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_favorite_listings_insert" ON "public"."favorite_listings" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_favorite_listings_select" ON "public"."favorite_listings" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_favorite_roommates_delete" ON "public"."favorite_roommates" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_favorite_roommates_insert" ON "public"."favorite_roommates" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_favorite_roommates_select" ON "public"."favorite_roommates" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_group_conversations_insert" ON "public"."group_conversations" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "created_by") AND (("building_id" IS NULL) OR "public"."user_current_dorm_matches_building"("building_id"))));



CREATE POLICY "rls_group_conversations_select" ON "public"."group_conversations" FOR SELECT TO "authenticated" USING (("public"."is_chat_group_member"("id") OR (("building_id" IS NOT NULL) AND "public"."user_current_dorm_matches_building"("building_id"))));



CREATE POLICY "rls_group_conversations_update" ON "public"."group_conversations" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "created_by")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "created_by"));



CREATE POLICY "rls_group_members_delete" ON "public"."group_members" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."group_conversations"
  WHERE (("group_conversations"."id" = "group_members"."group_id") AND ("group_conversations"."created_by" = "auth"."uid"()))))));



CREATE POLICY "rls_group_members_insert" ON "public"."group_members" FOR INSERT TO "authenticated" WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."group_conversations"
  WHERE (("group_conversations"."id" = "group_members"."group_id") AND ("group_conversations"."created_by" = "auth"."uid"())))) OR (("user_id" = "auth"."uid"()) AND "public"."is_chat_group_member"("group_id")) OR (("user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."group_conversations" "gc"
  WHERE (("gc"."id" = "group_members"."group_id") AND ("gc"."building_id" IS NOT NULL) AND "public"."user_current_dorm_matches_building"("gc"."building_id")))))));



CREATE POLICY "rls_group_members_select" ON "public"."group_members" FOR SELECT TO "authenticated" USING ("public"."is_chat_group_member"("group_id"));



CREATE POLICY "rls_group_messages_insert" ON "public"."group_messages" FOR INSERT TO "authenticated" WITH CHECK ((("sender_id" = "auth"."uid"()) AND "public"."is_chat_group_member"("group_id")));



CREATE POLICY "rls_group_messages_select" ON "public"."group_messages" FOR SELECT TO "authenticated" USING ("public"."is_chat_group_member"("group_id"));



CREATE POLICY "rls_marketplace_listings_delete" ON "public"."marketplace_listings" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_marketplace_listings_insert" ON "public"."marketplace_listings" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_marketplace_listings_select" ON "public"."marketplace_listings" FOR SELECT USING (true);



CREATE POLICY "rls_marketplace_listings_update" ON "public"."marketplace_listings" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_master_housing_select" ON "public"."master_housing" FOR SELECT USING (true);



CREATE POLICY "rls_messages_delete" ON "public"."messages" FOR DELETE TO "authenticated" USING ((("sender_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."conversations" "c"
  WHERE (("c"."id" = "messages"."conversation_id") AND (("c"."participant_1" = ( SELECT "auth"."uid"() AS "uid")) OR ("c"."participant_2" = ( SELECT "auth"."uid"() AS "uid"))))))));



CREATE POLICY "rls_messages_insert" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK ((("sender_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."conversations" "c"
  WHERE (("c"."id" = "messages"."conversation_id") AND (("c"."participant_1" = ( SELECT "auth"."uid"() AS "uid")) OR ("c"."participant_2" = ( SELECT "auth"."uid"() AS "uid"))))))));



CREATE POLICY "rls_messages_select" ON "public"."messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."conversations" "c"
  WHERE (("c"."id" = "messages"."conversation_id") AND (("c"."participant_1" = ( SELECT "auth"."uid"() AS "uid")) OR ("c"."participant_2" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "rls_messages_update" ON "public"."messages" FOR UPDATE TO "authenticated" USING ((("sender_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."conversations" "c"
  WHERE (("c"."id" = "messages"."conversation_id") AND (("c"."participant_1" = ( SELECT "auth"."uid"() AS "uid")) OR ("c"."participant_2" = ( SELECT "auth"."uid"() AS "uid"))))))));



CREATE POLICY "rls_pogoh_station_select" ON "public"."pogoh_station" FOR SELECT USING (true);



CREATE POLICY "rls_profiles_delete" ON "public"."profiles" FOR DELETE TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "rls_profiles_insert" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "rls_profiles_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_profiles_update" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "rls_roommate_search_posts_delete" ON "public"."roommate_search_posts" FOR DELETE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true))))));



CREATE POLICY "rls_saved_roommates_delete" ON "public"."saved_roommates" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_saved_roommates_insert" ON "public"."saved_roommates" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_saved_roommates_select" ON "public"."saved_roommates" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_saved_roommates_update" ON "public"."saved_roommates" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_setup_comments_delete" ON "public"."setup_comments" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_setup_comments_insert" ON "public"."setup_comments" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_setup_comments_select" ON "public"."setup_comments" FOR SELECT USING (true);



CREATE POLICY "rls_setup_comments_update" ON "public"."setup_comments" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_setup_likes_delete" ON "public"."setup_likes" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_setup_likes_insert" ON "public"."setup_likes" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_setup_likes_select" ON "public"."setup_likes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "rls_setup_photos_delete" ON "public"."setup_photos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."student_setups" "ss"
  WHERE (("ss"."id" = "setup_photos"."setup_id") AND ("ss"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "rls_setup_photos_insert" ON "public"."setup_photos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."student_setups" "ss"
  WHERE (("ss"."id" = "setup_photos"."setup_id") AND ("ss"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "rls_setup_photos_select" ON "public"."setup_photos" FOR SELECT USING (true);



CREATE POLICY "rls_setup_products_delete" ON "public"."setup_products" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."student_setups" "ss"
  WHERE (("ss"."id" = "setup_products"."setup_id") AND ("ss"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "rls_setup_products_insert" ON "public"."setup_products" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."student_setups" "ss"
  WHERE (("ss"."id" = "setup_products"."setup_id") AND ("ss"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "rls_setup_products_select" ON "public"."setup_products" FOR SELECT USING (true);



CREATE POLICY "rls_setup_products_update" ON "public"."setup_products" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."student_setups" "ss"
  WHERE (("ss"."id" = "setup_products"."setup_id") AND ("ss"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "rls_student_reviews_delete" ON "public"."student_reviews" FOR DELETE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true))))));



CREATE POLICY "rls_student_reviews_insert" ON "public"."student_reviews" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_student_reviews_select" ON "public"."student_reviews" FOR SELECT USING (true);



CREATE POLICY "rls_student_reviews_update" ON "public"."student_reviews" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_student_setups_delete" ON "public"."student_setups" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_student_setups_insert" ON "public"."student_setups" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_student_setups_select" ON "public"."student_setups" FOR SELECT USING (true);



CREATE POLICY "rls_student_setups_update" ON "public"."student_setups" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "rls_user_dorm_rankings_select" ON "public"."user_dorm_rankings" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR "public"."am_i_in_group_with_user"("user_id")));



ALTER TABLE "public"."roommate_search_interests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roommate_search_interests_delete" ON "public"."roommate_search_interests" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "roommate_search_interests_insert" ON "public"."roommate_search_interests" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "roommate_search_interests_select" ON "public"."roommate_search_interests" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
   FROM "public"."roommate_search_posts" "p"
  WHERE (("p"."id" = "roommate_search_interests"."post_id") AND ("p"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



ALTER TABLE "public"."roommate_search_posts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roommate_search_posts_insert" ON "public"."roommate_search_posts" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "roommate_search_posts_select" ON "public"."roommate_search_posts" FOR SELECT TO "authenticated" USING ((("is_active" = true) OR (( SELECT "auth"."uid"() AS "uid") = "user_id")));



CREATE POLICY "roommate_search_posts_update" ON "public"."roommate_search_posts" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."saved_businesses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saved_dorms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saved_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saved_roommate_posts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "saved_roommate_posts_delete_own" ON "public"."saved_roommate_posts" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "saved_roommate_posts_insert_own" ON "public"."saved_roommate_posts" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "saved_roommate_posts_select_own" ON "public"."saved_roommate_posts" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."saved_roommates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saved_subleases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."setup_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."setup_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."setup_photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."setup_products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_setups" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_dorm_rankings" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."am_i_in_group_with_user"("target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."am_i_in_group_with_user"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."am_i_in_group_with_user"("target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_group_access"("check_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_group_access"("check_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_group_access"("check_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."clear_group_checklist"("target_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."clear_group_checklist"("target_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_group_checklist"("target_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."clone_personal_to_group"("target_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."clone_personal_to_group"("target_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."clone_personal_to_group"("target_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_ranking_group"("p_group_name" "text", "p_member_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."create_ranking_group"("p_group_name" "text", "p_member_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_ranking_group"("p_group_name" "text", "p_member_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_ranking_group"("p_group_name" "text", "p_owner_id" "uuid", "p_member_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."create_ranking_group"("p_group_name" "text", "p_owner_id" "uuid", "p_member_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_ranking_group"("p_group_name" "text", "p_owner_id" "uuid", "p_member_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."current_academic_year"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_academic_year"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_academic_year"() TO "service_role";



GRANT ALL ON FUNCTION "public"."decrement_product_hearts"("product_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."decrement_product_hearts"("product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decrement_product_hearts"("product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_user_data"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_user_data"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_user_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user_data"() TO "service_role";



GRANT ALL ON FUNCTION "public"."drop_all_policies_for_table"("target_schema" "text", "target_table" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."drop_all_policies_for_table"("target_schema" "text", "target_table" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."drop_all_policies_for_table"("target_schema" "text", "target_table" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."eject_from_unmatched_building_chats"() TO "anon";
GRANT ALL ON FUNCTION "public"."eject_from_unmatched_building_chats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."eject_from_unmatched_building_chats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."extract_listing_id"("url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."extract_listing_id"("url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."extract_listing_id"("url" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_building_chat_links"("b_id" bigint, "year" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_building_chat_links"("b_id" bigint, "year" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_building_chat_links"("b_id" bigint, "year" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_building_chats"("b_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_building_chats"("b_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_building_chats"("b_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_content_reports"("content_type_filter" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_content_reports"("content_type_filter" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_content_reports"("content_type_filter" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dorm_review_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_dorm_review_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dorm_review_stats"() TO "service_role";



GRANT ALL ON TABLE "public"."checklist_items" TO "anon";
GRANT ALL ON TABLE "public"."checklist_items" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist_items" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_group_checklist"("query_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_group_checklist"("query_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_group_checklist"("query_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_groups_i_own"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_groups_i_own"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_groups_i_own"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_accepted_group_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_accepted_group_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_accepted_group_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_all_group_ids"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_all_group_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_all_group_ids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user_checklist"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user_checklist"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user_checklist"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_product_hearts"("product_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_product_hearts"("product_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_product_hearts"("product_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_chat_group_member"("gid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_chat_group_member"("gid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_chat_group_member"("gid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."limit_user_listings"() TO "anon";
GRANT ALL ON FUNCTION "public"."limit_user_listings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."limit_user_listings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."payment_history_receiver_confirm"() TO "anon";
GRANT ALL ON FUNCTION "public"."payment_history_receiver_confirm"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."payment_history_receiver_confirm"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_profile_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_profile_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_profile_email"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reset_checklist_custom"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reset_checklist_custom"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_checklist_custom"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."reset_checklist_defaults"("p_user_id" "uuid", "p_list_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reset_checklist_defaults"("p_user_id" "uuid", "p_list_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_checklist_defaults"("p_user_id" "uuid", "p_list_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."roommate_search_interests_bump_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."roommate_search_interests_bump_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."roommate_search_interests_bump_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."roommate_search_posts_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."roommate_search_posts_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."roommate_search_posts_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_group_rankings_from_members"("p_group_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_group_rankings_from_members"("p_group_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_group_rankings_from_members"("p_group_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_group_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_group_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_group_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_personal_to_group"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_personal_to_group"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_personal_to_group"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_sync_group_rankings_on_member_accept"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_sync_group_rankings_on_member_accept"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_sync_group_rankings_on_member_accept"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_building_chat_links_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_building_chat_links_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_building_chat_links_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_business_listings_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_business_listings_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_business_listings_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_conversation_timestamp"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_conversation_timestamp"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_conversation_timestamp"() TO "service_role";



GRANT ALL ON FUNCTION "public"."user_current_dorm_matches_building"("b_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."user_current_dorm_matches_building"("b_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_current_dorm_matches_building"("b_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."validate_pitt_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."validate_pitt_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."validate_pitt_email"() TO "service_role";



GRANT ALL ON TABLE "public"."amazon_products" TO "anon";
GRANT ALL ON TABLE "public"."amazon_products" TO "authenticated";
GRANT ALL ON TABLE "public"."amazon_products" TO "service_role";



GRANT ALL ON TABLE "public"."analytics_events" TO "anon";
GRANT ALL ON TABLE "public"."analytics_events" TO "authenticated";
GRANT ALL ON TABLE "public"."analytics_events" TO "service_role";



GRANT ALL ON TABLE "public"."building_chat_link_reports" TO "anon";
GRANT ALL ON TABLE "public"."building_chat_link_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."building_chat_link_reports" TO "service_role";



GRANT ALL ON TABLE "public"."building_chat_links" TO "anon";
GRANT ALL ON TABLE "public"."building_chat_links" TO "authenticated";
GRANT ALL ON TABLE "public"."building_chat_links" TO "service_role";



GRANT ALL ON TABLE "public"."bus_stops" TO "anon";
GRANT ALL ON TABLE "public"."bus_stops" TO "authenticated";
GRANT ALL ON TABLE "public"."bus_stops" TO "service_role";



GRANT ALL ON TABLE "public"."business_listings" TO "anon";
GRANT ALL ON TABLE "public"."business_listings" TO "authenticated";
GRANT ALL ON TABLE "public"."business_listings" TO "service_role";



GRANT ALL ON TABLE "public"."campus_map_courses" TO "anon";
GRANT ALL ON TABLE "public"."campus_map_courses" TO "authenticated";
GRANT ALL ON TABLE "public"."campus_map_courses" TO "service_role";



GRANT ALL ON TABLE "public"."checklist_item_claims" TO "anon";
GRANT ALL ON TABLE "public"."checklist_item_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist_item_claims" TO "service_role";



GRANT ALL ON TABLE "public"."checklist_payment_acks" TO "anon";
GRANT ALL ON TABLE "public"."checklist_payment_acks" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist_payment_acks" TO "service_role";



GRANT ALL ON TABLE "public"."checklist_payments" TO "anon";
GRANT ALL ON TABLE "public"."checklist_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."checklist_payments" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."ranking_collaborations" TO "anon";
GRANT ALL ON TABLE "public"."ranking_collaborations" TO "authenticated";
GRANT ALL ON TABLE "public"."ranking_collaborations" TO "service_role";



GRANT ALL ON TABLE "public"."collaboration_details" TO "anon";
GRANT ALL ON TABLE "public"."collaboration_details" TO "authenticated";
GRANT ALL ON TABLE "public"."collaboration_details" TO "service_role";



GRANT ALL ON TABLE "public"."content_reports" TO "anon";
GRANT ALL ON TABLE "public"."content_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."content_reports" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."dining_reviews" TO "anon";
GRANT ALL ON TABLE "public"."dining_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."dining_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."dining_spots" TO "anon";
GRANT ALL ON TABLE "public"."dining_spots" TO "authenticated";
GRANT ALL ON TABLE "public"."dining_spots" TO "service_role";



GRANT ALL ON TABLE "public"."dining_upvotes" TO "anon";
GRANT ALL ON TABLE "public"."dining_upvotes" TO "authenticated";
GRANT ALL ON TABLE "public"."dining_upvotes" TO "service_role";



GRANT ALL ON TABLE "public"."dorm_answers" TO "anon";
GRANT ALL ON TABLE "public"."dorm_answers" TO "authenticated";
GRANT ALL ON TABLE "public"."dorm_answers" TO "service_role";



GRANT ALL ON TABLE "public"."dorm_edits" TO "anon";
GRANT ALL ON TABLE "public"."dorm_edits" TO "authenticated";
GRANT ALL ON TABLE "public"."dorm_edits" TO "service_role";



GRANT ALL ON TABLE "public"."dorm_future_residents" TO "anon";
GRANT ALL ON TABLE "public"."dorm_future_residents" TO "authenticated";
GRANT ALL ON TABLE "public"."dorm_future_residents" TO "service_role";



GRANT ALL ON TABLE "public"."dorm_question_upvotes" TO "anon";
GRANT ALL ON TABLE "public"."dorm_question_upvotes" TO "authenticated";
GRANT ALL ON TABLE "public"."dorm_question_upvotes" TO "service_role";



GRANT ALL ON TABLE "public"."dorm_questions" TO "anon";
GRANT ALL ON TABLE "public"."dorm_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."dorm_questions" TO "service_role";



GRANT ALL ON TABLE "public"."explore_picks" TO "anon";
GRANT ALL ON TABLE "public"."explore_picks" TO "authenticated";
GRANT ALL ON TABLE "public"."explore_picks" TO "service_role";



GRANT ALL ON TABLE "public"."favorite_listings" TO "anon";
GRANT ALL ON TABLE "public"."favorite_listings" TO "authenticated";
GRANT ALL ON TABLE "public"."favorite_listings" TO "service_role";



GRANT ALL ON TABLE "public"."favorite_roommates" TO "anon";
GRANT ALL ON TABLE "public"."favorite_roommates" TO "authenticated";
GRANT ALL ON TABLE "public"."favorite_roommates" TO "service_role";



GRANT ALL ON TABLE "public"."group_conversations" TO "anon";
GRANT ALL ON TABLE "public"."group_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."group_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."group_dorm_rankings" TO "anon";
GRANT ALL ON TABLE "public"."group_dorm_rankings" TO "authenticated";
GRANT ALL ON TABLE "public"."group_dorm_rankings" TO "service_role";



GRANT ALL ON TABLE "public"."group_members" TO "anon";
GRANT ALL ON TABLE "public"."group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."group_members" TO "service_role";



GRANT ALL ON TABLE "public"."group_messages" TO "anon";
GRANT ALL ON TABLE "public"."group_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."group_messages" TO "service_role";



GRANT ALL ON TABLE "public"."marketplace_listings" TO "anon";
GRANT ALL ON TABLE "public"."marketplace_listings" TO "authenticated";
GRANT ALL ON TABLE "public"."marketplace_listings" TO "service_role";



GRANT ALL ON TABLE "public"."master_housing" TO "anon";
GRANT ALL ON TABLE "public"."master_housing" TO "authenticated";
GRANT ALL ON TABLE "public"."master_housing" TO "service_role";



GRANT ALL ON TABLE "public"."master_housing_map" TO "anon";
GRANT ALL ON TABLE "public"."master_housing_map" TO "authenticated";
GRANT ALL ON TABLE "public"."master_housing_map" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."off_campus_dining_reviews" TO "anon";
GRANT ALL ON TABLE "public"."off_campus_dining_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."off_campus_dining_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."off_campus_dining_spots" TO "anon";
GRANT ALL ON TABLE "public"."off_campus_dining_spots" TO "authenticated";
GRANT ALL ON TABLE "public"."off_campus_dining_spots" TO "service_role";



GRANT ALL ON TABLE "public"."payment_history" TO "anon";
GRANT ALL ON TABLE "public"."payment_history" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_history" TO "service_role";



GRANT ALL ON TABLE "public"."pogoh_station" TO "anon";
GRANT ALL ON TABLE "public"."pogoh_station" TO "authenticated";
GRANT ALL ON TABLE "public"."pogoh_station" TO "service_role";



GRANT ALL ON TABLE "public"."public_profiles" TO "anon";
GRANT ALL ON TABLE "public"."public_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."public_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."ranking_group_members" TO "anon";
GRANT ALL ON TABLE "public"."ranking_group_members" TO "authenticated";
GRANT ALL ON TABLE "public"."ranking_group_members" TO "service_role";



GRANT ALL ON TABLE "public"."roommate_search_interests" TO "anon";
GRANT ALL ON TABLE "public"."roommate_search_interests" TO "authenticated";
GRANT ALL ON TABLE "public"."roommate_search_interests" TO "service_role";



GRANT ALL ON TABLE "public"."roommate_search_posts" TO "anon";
GRANT ALL ON TABLE "public"."roommate_search_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."roommate_search_posts" TO "service_role";



GRANT ALL ON TABLE "public"."saved_businesses" TO "anon";
GRANT ALL ON TABLE "public"."saved_businesses" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_businesses" TO "service_role";



GRANT ALL ON TABLE "public"."saved_dorms" TO "anon";
GRANT ALL ON TABLE "public"."saved_dorms" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_dorms" TO "service_role";



GRANT ALL ON SEQUENCE "public"."saved_dorms_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."saved_dorms_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."saved_dorms_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."saved_items" TO "anon";
GRANT ALL ON TABLE "public"."saved_items" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_items" TO "service_role";



GRANT ALL ON TABLE "public"."saved_roommate_posts" TO "anon";
GRANT ALL ON TABLE "public"."saved_roommate_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_roommate_posts" TO "service_role";



GRANT ALL ON TABLE "public"."saved_roommates" TO "anon";
GRANT ALL ON TABLE "public"."saved_roommates" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_roommates" TO "service_role";



GRANT ALL ON SEQUENCE "public"."saved_roommates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."saved_roommates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."saved_roommates_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."saved_subleases" TO "anon";
GRANT ALL ON TABLE "public"."saved_subleases" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_subleases" TO "service_role";



GRANT ALL ON TABLE "public"."setup_comments" TO "anon";
GRANT ALL ON TABLE "public"."setup_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."setup_comments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."setup_comments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."setup_comments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."setup_comments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."setup_likes" TO "anon";
GRANT ALL ON TABLE "public"."setup_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."setup_likes" TO "service_role";



GRANT ALL ON TABLE "public"."setup_photos" TO "anon";
GRANT ALL ON TABLE "public"."setup_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."setup_photos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."setup_photos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."setup_photos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."setup_photos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."setup_products" TO "anon";
GRANT ALL ON TABLE "public"."setup_products" TO "authenticated";
GRANT ALL ON TABLE "public"."setup_products" TO "service_role";



GRANT ALL ON SEQUENCE "public"."setup_products_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."setup_products_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."setup_products_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."student_reviews" TO "anon";
GRANT ALL ON TABLE "public"."student_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."student_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."student_setups" TO "anon";
GRANT ALL ON TABLE "public"."student_setups" TO "authenticated";
GRANT ALL ON TABLE "public"."student_setups" TO "service_role";



GRANT ALL ON SEQUENCE "public"."student_setups_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."student_setups_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."student_setups_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_dorm_rankings" TO "anon";
GRANT ALL ON TABLE "public"."user_dorm_rankings" TO "authenticated";
GRANT ALL ON TABLE "public"."user_dorm_rankings" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







