-- Reset dormcheck.role_change_authorized before every authorized RPC returns (BA-03 / §7d,
-- docs/audits/backend-audit-2026-09-06.md).
--
-- THE HAZARD. protect_profile_role() (20260709132034, amended 20260713002250) lets a
-- profiles.role change through when the transaction-local GUC
-- dormcheck.role_change_authorized reads 'on'. set_admin_role() and
-- claim_pending_admin_invites() raise the flag after checking their own rails, perform the
-- authorized UPDATE, and return WITHOUT lowering it. set_config(name, value, true) is
-- transaction-local, not statement-local, so from that point until COMMIT the role guard is
-- disabled for the whole transaction: a raw `UPDATE profiles SET role = 'superadmin'` then
-- applies unchecked, including a self-escalation. supabase/tests/admin_invitations_rails
-- .test.sql §7d demonstrated that escalation and — recorded 2026-08-06 — PINNED it as the
-- expected verdict, with the instruction to delete the block once an RPC resets the flag.
--
-- REACHABILITY TODAY: none from a client. PostgREST runs one RPC per transaction and
-- exposes neither set_config nor current_setting (§7a). It becomes real the moment any
-- definer function, batched transaction or server-side job chains "call the RPC, then
-- touch profiles" — the containment was one `true` argument (§7c) and nothing else.
--
-- THE FIX is the one line each RPC always needed: lower the flag immediately after the
-- authorized UPDATE, before anything else runs. The audit-log insert that follows does not
-- need the flag. In claim_pending_admin_invites() the flag is raised and lowered per loop
-- iteration, so a second invite in the same claim still gets its own authorized window and
-- nothing after the loop inherits one. Bodies are otherwise byte-for-byte the live prod
-- definitions (pg_get_functiondef, 2026-09-06); CREATE OR REPLACE preserves owner, grants
-- and the SECURITY DEFINER / search_path attributes.
--
-- Probe: supabase/tests/admin_invitations_rails.test.sql §7d now asserts the flag is DOWN
-- after the RPCs and that a follow-on self-escalation in the same transaction is refused
-- (red before this file, green after). admin_invitations_rails.mutations.py M14 inverts to
-- "remove the reset" so the mutation harness still proves the verdict is load-bearing.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_admin_role(p_target_id uuid, p_new_role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Lower the flag the moment the authorized write is done. Everything after this line,
  -- and anything else in the same transaction, runs with protect_profile_role() armed.
  perform set_config('dormcheck.role_change_authorized', 'off', true);

  v_action := case
    when p_new_role = 'user'::public.app_role then 'admin.revoke'
    else 'admin.role_change'
  end;

  insert into public.admin_audit_log (actor_id, action, target_type, target_id, university_id)
  values (v_uid, v_action, 'profile', p_target_id, v_target.university_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_pending_admin_invites()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

    -- Lowered per iteration: each invite gets exactly one authorized write, and nothing
    -- after the loop inherits an open window.
    perform set_config('dormcheck.role_change_authorized', 'off', true);

    update public.admin_invitations
    set status = 'accepted', accepted_at = now(), accepted_by = v_uid
    where id = v_invite.id;

    insert into public.admin_audit_log (actor_id, action, target_type, target_id, university_id)
    values (v_uid, 'admin.invite_accepted', 'profile', v_uid, v_invite.university_id);

    v_claimed := v_claimed + 1;
  end loop;

  return v_claimed;
end;
$function$;

-- Self-check: both setters lower the flag, and lower it AFTER the profiles UPDATE (a reset
-- placed before the UPDATE would re-arm the guard against the RPC's own write and 500 every
-- legitimate grant, which the probe's positive control 3g would catch, but say so here too).
DO $$
DECLARE
  v_src text;
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['set_admin_role', 'claim_pending_admin_invites'] LOOP
    SELECT p.prosrc INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn;
    IF v_src IS NULL THEN
      RAISE EXCEPTION '20261006000000: public.% is missing', v_fn;
    END IF;
    IF position('set_config(''dormcheck.role_change_authorized'', ''off'', true)' IN v_src) = 0 THEN
      RAISE EXCEPTION '20261006000000: public.% does not lower dormcheck.role_change_authorized', v_fn;
    END IF;
    IF position('set_config(''dormcheck.role_change_authorized'', ''off'', true)' IN v_src)
       < position('update public.profiles' IN v_src) THEN
      RAISE EXCEPTION '20261006000000: public.% lowers the flag before its authorized UPDATE', v_fn;
    END IF;
  END LOOP;
END $$;

COMMIT;
