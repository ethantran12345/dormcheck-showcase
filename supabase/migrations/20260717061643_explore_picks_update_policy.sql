-- explore_picks had INSERT/SELECT/DELETE policies but no UPDATE, so the upsert that
-- persists a chosen variant (variant_label / variant_image_url / ...) onto an existing
-- pick was silently blocked by RLS. Users could never change the variant after saving.
-- Rollback: drop policy "Users can update their own picks" on public.explore_picks;

create policy "Users can update their own picks"
  on public.explore_picks
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
