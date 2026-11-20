-- Tenant-isolation verification recipe (multi-university step 7).
-- Run each block via psql or the Supabase MCP execute_sql. IMPORTANT: MCP execute_sql runs as
-- postgres, which BYPASSES RLS — every check must run inside a transaction that assumes the
-- authenticated role + a JWT, exactly as below, or the results are meaningless.
--
-- Executed green against prod 2026-07-10 (results in docs/CHANGELOG.md entry).
--
-- Setup: two throwaway null-email auth users (null email skips the signup domain gate, which
-- is separately asserted below), one profile per tenant.
--   INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
--     ('<PITT_TEST_ID>', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL),
--     ('<CMU_TEST_ID>',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', NULL);
--   INSERT INTO public.profiles (id, full_name, university_id) VALUES
--     ('<PITT_TEST_ID>', 'Isolation Test Pitt', '00000000-0000-4000-8000-000000000001'),
--     ('<CMU_TEST_ID>',  'Isolation Test CMU',  '00000000-0000-4000-8000-000000000002');
-- Teardown: delete both profiles + auth.users rows.

-- 0. Signup gate: an inactive-tenant domain must be rejected by validate_university_email().
--    INSERT INTO auth.users (..., email) VALUES (..., 'x@andrew.cmu.edu');  -- expect EXCEPTION

-- 1. As the CMU test user: every count must be 0 except own-tenant housing (65).
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<CMU_TEST_ID>","role":"authenticated"}';
select
  (select count(*) from master_housing where university_id='00000000-0000-4000-8000-000000000001') as pitt_housing_visible,     -- 0
  (select count(*) from master_housing where university_id='00000000-0000-4000-8000-000000000002') as cmu_housing_visible,      -- 65
  (select count(*) from marketplace_listings) as listings_visible,                                                              -- 0
  (select count(*) from marketplace_listings_contact) as contact_rows_visible,                                                  -- 0
  (select count(*) from roommate_profiles where id <> auth.uid()) as roommate_others_visible,                                   -- 0
  (select count(*) from public_profiles where id <> auth.uid()) as profiles_others_visible,                                     -- 0
  (select count(*) from dorm_questions) as dorm_questions_visible,                                                              -- 0
  (select count(*) from dorm_answers) as dorm_answers_visible,                                                                  -- 0
  (select count(*) from student_setups) as setups_visible,                                                                      -- 0
  (select count(*) from setup_photos) as setup_photos_visible,                                                                  -- 0
  (select count(*) from building_chat_links) as chat_links_visible,                                                             -- 0
  (select count(*) from explore_picks) as explore_picks_visible,                                                                -- 0
  (select count(*) from seller_ratings) as seller_ratings_visible,                                                              -- 0
  (select count(*) from seller_rating_stats) as rating_stats_visible,                                                           -- 0
  (select count(*) from business_listings) as business_visible,                                                                 -- 0
  (select count(*) from roommate_search_posts) as roommate_posts_visible;                                                       -- 0
rollback;

-- 2. As the Pitt test user: Pitt behavior intact (housing 142, listings/setups nonzero as of
--    2026-07-10), zero CMU rows on every surface (swap the tenant filters from block 1).

-- 3. Cross-tenant DM must be blocked; authenticated insert without university_id must land in
--    the inserter's tenant via set_university_id_from_profile().
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<PITT_TEST_ID>","role":"authenticated"}';
do $$
declare v uuid; d bigint;
begin
  begin
    insert into public.conversations (participant_1, participant_2)
    values ('<PITT_TEST_ID>', '<CMU_TEST_ID>');
    raise exception 'ISOLATION_FAILED: cross-tenant conversation was allowed';
  exception
    when raise_exception then
      if sqlerrm like 'ISOLATION_FAILED%' then raise; end if;
    when others then null; -- blocked as expected
  end;
  select id into d from public.master_housing limit 1;
  insert into public.dorm_questions (dorm_id, user_id, question)
  values (d, '<PITT_TEST_ID>', 'isolation trigger test?')
  returning university_id into v;
  if v is distinct from '00000000-0000-4000-8000-000000000001' then
    raise exception 'TRIGGER_FAILED: got %', v;
  end if;
end $$;
rollback;

-- 4. Superadmin bypass: set the test profile role='superadmin' (as postgres), rerun block 1 —
--    both tenants' housing visible (65 + 142). Reset role afterwards.
