-- Append-only audit trail for all admin actions (moderation, dorm edits, role changes).
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  university_id uuid references public.universities(id),
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

-- Insert: any admin, only as themselves. Auth/helper calls wrapped in scalar
-- subqueries so they evaluate once per statement (advisor: auth_rls_initplan).
create policy "admins insert own audit rows"
  on public.admin_audit_log for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and (select public.current_app_role()) <> 'user'::public.app_role
  );

-- Select: superadmin all; university_admin scoped to their university
create policy "superadmin reads all audit rows"
  on public.admin_audit_log for select to authenticated
  using ((select public.is_superadmin()));

create policy "university_admin reads scoped audit rows"
  on public.admin_audit_log for select to authenticated
  using (
    (select public.current_app_role()) = 'university_admin'::public.app_role
    and university_id is not null
    and university_id = (select public.current_university_id())
  );

-- Append-only: no update/delete policies, and revoke grants defensively
revoke update, delete on public.admin_audit_log from authenticated, anon;

create index admin_audit_log_actor_idx on public.admin_audit_log (actor_id, created_at desc);
create index admin_audit_log_university_idx on public.admin_audit_log (university_id, created_at desc);
