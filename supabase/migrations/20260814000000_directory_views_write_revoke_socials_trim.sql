-- Option-A hardening of the two directory views (docs/audits/security-posture.md,
-- dated 2026-07-18). Both views stay SECURITY DEFINER — accepted baseline: they
-- are PostgREST embed targets, and both the security_invoker/private-schema
-- wrapper AND an rpc rewrite break embed resolution (PGRST200), verified live
-- 2026-07-17/18. Full clear = the profiles_private split (Option B), deferred.
--
-- 1) Capture the write-grant revoke ALREADY APPLIED to prod via SQL 2026-07-18
--    (idempotent). This closed a CONFIRMED live authenticated RLS-bypass
--    write/delete vector: an UPDATE through the view hit another user's row
--    while the same direct UPDATE on profiles was RLS-blocked. Views are
--    SELECT-only now; zero app code writes through them (verified by grep).
revoke insert, update, delete, truncate on public.public_profiles  from authenticated, anon;
revoke insert, update, delete, truncate on public.roommate_profiles from authenticated, anon;

-- 2) Drop the social handles from public_profiles (non-public-user leak; the
--    marketplace UI reads seller handles from the gated
--    marketplace_listings_contact view, not from this fallback — code fallback
--    removed in the same commit). roommate_profiles keeps socials (already
--    scoped to is_public/self). Keep SECURITY DEFINER + the same relationship
--    shape (select over public.profiles, id FK) so PostgREST embeds resolve.
drop view public.public_profiles;
create view public.public_profiles as
  select id, full_name, avatar_url from public.profiles;

-- The recreated view re-inherits Supabase's default privileges (ALL to anon/authenticated),
-- so the top-of-file revoke (on the now-dropped old view) does not protect it. Re-revoke
-- writes from authenticated so the new view is SELECT-only — otherwise the auto-updatable
-- definer view reopens the RLS-bypass write vector. Prod already patched live 2026-07-18.
revoke insert, update, delete, truncate on public.public_profiles from authenticated, anon;
-- Strip Supabase's default anon/public SELECT + re-lock to authenticated SELECT only.
revoke all on public.public_profiles from anon, public;
grant select on public.public_profiles to authenticated;

notify pgrst, 'reload schema';
