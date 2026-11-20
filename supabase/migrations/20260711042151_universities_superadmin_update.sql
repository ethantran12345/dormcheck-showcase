-- Platform tab: superadmins manage university activation from the console.
-- universities is platform-global (registry class E/F); reads stay open to
-- authenticated, writes are superadmin-only.
create policy universities_superadmin_update on public.universities
  for update to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());
