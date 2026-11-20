-- Admin RBAC Tier 1: delegated admin invitations + role-management RPCs.
-- Delegation model: university_admin invites freely, but only role=university_admin
-- scoped to their own university; cannot touch superadmins. Everything audited.

create table public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  role public.app_role not null default 'university_admin'
    check (role <> 'user'::public.app_role),
  university_id uuid not null references public.universities(id),
  invited_by uuid not null references public.profiles(id),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id)
);

alter table public.admin_invitations enable row level security;

-- Superadmin: full access.
create policy "superadmin manages all invitations"
  on public.admin_invitations for all to authenticated
  using ((select public.is_superadmin()))
  with check ((select public.is_superadmin()));

-- university_admin: read + create + update only within their own university,
-- and may only ever mint university_admin invites as themselves.
create policy "university_admin reads own-school invitations"
  on public.admin_invitations for select to authenticated
  using (
    (select public.current_app_role()) = 'university_admin'::public.app_role
    and university_id = (select public.current_university_id())
  );

create policy "university_admin creates own-school invitations"
  on public.admin_invitations for insert to authenticated
  with check (
    (select public.current_app_role()) = 'university_admin'::public.app_role
    and university_id = (select public.current_university_id())
    and role = 'university_admin'::public.app_role
    and invited_by = (select auth.uid())
  );

create policy "university_admin updates own-school invitations"
  on public.admin_invitations for update to authenticated
  using (
    (select public.current_app_role()) = 'university_admin'::public.app_role
    and university_id = (select public.current_university_id())
  )
  with check (
    (select public.current_app_role()) = 'university_admin'::public.app_role
    and university_id = (select public.current_university_id())
    and role = 'university_admin'::public.app_role
  );

revoke delete on public.admin_invitations from authenticated, anon;

create index admin_invitations_email_idx on public.admin_invitations (email) where status = 'pending';
create index admin_invitations_university_idx on public.admin_invitations (university_id, created_at desc);

-- The role-guard trigger blocks role changes from any authenticated context,
-- including SECURITY DEFINER RPCs (auth.uid() is still the end user there).
-- Add a transaction-local authorization flag that only our definer RPCs set.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  role_changed boolean;
begin
  if tg_op = 'INSERT' then
    role_changed := (new.role is distinct from 'user'::public.app_role)
      or (new.university_id is not null);
  else
    role_changed := (new.role is distinct from old.role)
      or (new.university_id is distinct from old.university_id);
  end if;

  if role_changed then
    -- Internal / definer / service contexts (signup trigger, migrations,
    -- service_role) bypass. A real end user always has a non-null auth.uid().
    if auth.uid() is null
       or session_user in ('postgres', 'supabase_admin')
       or auth.role() = 'service_role'
       -- Authorized definer RPCs (claim_pending_admin_invites, set_admin_role)
       -- set this transaction-local flag after validating their own rails.
       or coalesce(current_setting('dormcheck.role_change_authorized', true), '') = 'on' then
      return new;
    end if;

    if auth.uid() = new.id then
      raise exception 'Cannot modify your own role';
    end if;

    if not public.is_superadmin() then
      raise exception 'Only superadmins may modify roles';
    end if;
  end if;

  return new;
end;
$$;

-- Claim any pending, unexpired invites matching the logged-in user's email.
-- Called fire-and-forget on login. Returns number of invites applied.
create or replace function public.claim_pending_admin_invites()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_invite record;
  v_claimed integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is null then
    return 0;
  end if;

  for v_invite in
    select i.* from public.admin_invitations i
    join public.universities u on u.id = i.university_id and u.is_active
    where i.status = 'pending'
      and i.expires_at > now()
      and i.email = v_email
    order by i.created_at
    for update of i
  loop
    perform set_config('dormcheck.role_change_authorized', 'on', true);

    update public.profiles
    set role = v_invite.role, university_id = v_invite.university_id
    where id = v_uid;

    update public.admin_invitations
    set status = 'accepted', accepted_at = now(), accepted_by = v_uid
    where id = v_invite.id;

    insert into public.admin_audit_log (actor_id, action, target_type, target_id, university_id)
    values (v_uid, 'admin.invite_accepted', 'profile', v_uid, v_invite.university_id);

    v_claimed := v_claimed + 1;
  end loop;

  return v_claimed;
end;
$$;

-- Grant / revoke / change an admin role with tier rails enforced in-function.
create or replace function public.set_admin_role(p_target_id uuid, p_new_role public.app_role)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_role public.app_role := public.current_app_role();
  v_caller_university uuid := public.current_university_id();
  v_target record;
  v_action text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if v_uid = p_target_id then
    raise exception 'cannot_change_own_role';
  end if;

  select id, role, university_id into v_target
  from public.profiles where id = p_target_id;
  if v_target.id is null then
    raise exception 'target_not_found';
  end if;

  if v_caller_role = 'superadmin'::public.app_role then
    null; -- any target, any role
  elsif v_caller_role = 'university_admin'::public.app_role then
    if v_target.role = 'superadmin'::public.app_role
       or p_new_role = 'superadmin'::public.app_role then
      raise exception 'cannot_touch_superadmin';
    end if;
    if v_caller_university is null or v_target.university_id is distinct from v_caller_university then
      raise exception 'wrong_university';
    end if;
  else
    raise exception 'not_authorized';
  end if;

  perform set_config('dormcheck.role_change_authorized', 'on', true);

  update public.profiles set role = p_new_role where id = p_target_id;

  v_action := case
    when p_new_role = 'user'::public.app_role then 'admin.revoke'
    else 'admin.role_change'
  end;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, university_id)
  values (v_uid, v_action, 'profile', p_target_id, v_target.university_id);
end;
$$;

-- Revoke a pending invitation (scope enforced in-function; RLS also applies to direct updates).
create or replace function public.revoke_admin_invitation(p_invite_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_caller_role public.app_role := public.current_app_role();
  v_caller_university uuid := public.current_university_id();
  v_invite record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_invite from public.admin_invitations where id = p_invite_id for update;
  if v_invite.id is null then
    raise exception 'invite_not_found';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invite_not_pending';
  end if;

  if v_caller_role = 'superadmin'::public.app_role then
    null;
  elsif v_caller_role = 'university_admin'::public.app_role then
    if v_invite.university_id is distinct from v_caller_university then
      raise exception 'wrong_university';
    end if;
  else
    raise exception 'not_authorized';
  end if;

  update public.admin_invitations set status = 'revoked' where id = p_invite_id;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, university_id)
  values (v_uid, 'admin.invite_revoked', 'admin_invitation', p_invite_id, v_invite.university_id);
end;
$$;

-- Scoped read of fellow admins for the Team page (profiles SELECT RLS is self-only).
create or replace function public.get_university_admins()
returns table (
  id uuid,
  full_name text,
  email text,
  role public.app_role,
  university_id uuid,
  created_at timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.full_name, p.email, p.role, p.university_id, p.created_at
  from public.profiles p
  where p.role <> 'user'::public.app_role
    and (
      public.is_superadmin()
      or (
        public.current_app_role() = 'university_admin'::public.app_role
        and p.university_id = public.current_university_id()
      )
    );
$$;

revoke execute on function
  public.claim_pending_admin_invites(),
  public.set_admin_role(uuid, public.app_role),
  public.revoke_admin_invitation(uuid),
  public.get_university_admins()
from public, anon;
grant execute on function
  public.claim_pending_admin_invites(),
  public.set_admin_role(uuid, public.app_role),
  public.revoke_admin_invitation(uuid),
  public.get_university_admins()
to authenticated;
