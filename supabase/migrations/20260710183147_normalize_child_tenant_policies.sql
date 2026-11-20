-- Tenant hardening 2/3: normalize class-B children to ONE explicit pattern.
-- These six children previously relied on their *permissive* parent-join policies for tenant
-- safety (the EXISTS subquery inherits the parent's RLS). That works, but is invisible to a
-- reviewer and fragile if a permissive policy is ever rewritten. Give them the same explicit
-- RESTRICTIVE tenant_isolation EXISTS-parent policy dorm_answers/setup_photos already carry
-- (20260723020000). Strictly additive/tightening: existing permissive policies are untouched.
-- Rollback: DROP POLICY tenant_isolation ON <each table>;

DROP POLICY IF EXISTS tenant_isolation ON public.marketplace_listing_items;
CREATE POLICY tenant_isolation ON public.marketplace_listing_items
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.marketplace_listings l WHERE l.id = marketplace_listing_items.listing_id));

DROP POLICY IF EXISTS tenant_isolation ON public.dorm_edits;
CREATE POLICY tenant_isolation ON public.dorm_edits
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.master_housing m WHERE m.id = dorm_edits.dorm_id));

DROP POLICY IF EXISTS tenant_isolation ON public.building_chat_link_reports;
CREATE POLICY tenant_isolation ON public.building_chat_link_reports
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.building_chat_links b WHERE b.id = building_chat_link_reports.link_id));

DROP POLICY IF EXISTS tenant_isolation ON public.roommate_search_interests;
CREATE POLICY tenant_isolation ON public.roommate_search_interests
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.roommate_search_posts p WHERE p.id = roommate_search_interests.post_id));

DROP POLICY IF EXISTS tenant_isolation ON public.setup_comment_likes;
CREATE POLICY tenant_isolation ON public.setup_comment_likes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.setup_comments c WHERE c.id = setup_comment_likes.comment_id));

DROP POLICY IF EXISTS tenant_isolation ON public.group_dorm_rankings;
CREATE POLICY tenant_isolation ON public.group_dorm_rankings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ranking_collaborations rc WHERE rc.id = group_dorm_rankings.group_id));
