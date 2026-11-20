#!/usr/bin/env python3
"""Mutation harness for supabase/tests/admin_invitations_rails.test.sql.

NOT RUN BY ANY GATE, and deliberately so: it rewrites live policies and functions, which is
the last thing a CI job should do to a shared database. It lives here so the claim
"mutation-checked" in that probe's header is reproducible rather than something you take on
trust. Run it by hand against a local stack after changing any rail:

    npx supabase db reset --local          # a clean, known schema
    python3 supabase/tests/admin_invitations_rails.mutations.py .

Every mutation is injected right after the probe's own BEGIN;, so the probe's final ROLLBACK
undoes the mutation too — nothing survives the run, including a failed one.

A mutation that SURVIVES is the finding: it means the probe does not actually check that rail,
and the rail is unprotected while looking protected. Result 2026-08-06: 14 mutations, 14 caught.

For each mutation we inject DDL immediately after the probe's own BEGIN;, so the probe's
final ROLLBACK undoes the mutation too — nothing survives the run. Then we check that the
verdicts we expect to break actually broke, and that nothing else did.
"""
import re, subprocess, sys, os

PROBE = 'supabase/tests/admin_invitations_rails.test.sql'
CONTAINER = 'supabase_db_Dormcheck'
ENV = ['-e', 'PGPASSWORD=postgres', '-e', 'PGOPTIONS=-c search_path="$user",public,extensions']


def psql(sql_text, tuples_only=True):
    args = ['docker', 'exec'] + ENV + ['-i', CONTAINER, 'psql', '-U', 'supabase_admin',
            '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q']
    if tuples_only:
        args += ['-tA']
    args += ['-f', '-']
    p = subprocess.run(args, input=sql_text, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def scrub(s):
    return '\n'.join(l for l in s.split('\n')
                     if 'collation version' not in l and 'Rebuild all objects' not in l
                     and 'The database was created' not in l)


def funcdef(name):
    rc, out, err = psql(f"select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='{name}';")
    body = scrub(out).strip()
    assert body, f'no definition for {name}: {err}'
    return body


def policydef(table, polname):
    rc, out, err = psql(
        "select p.polcmd, pg_get_expr(p.polqual, p.polrelid), coalesce(pg_get_expr(p.polwithcheck, p.polrelid),'') "
        f"from pg_policy p join pg_class c on c.oid=p.polrelid where c.relname='{table}' and p.polname='{polname}';")
    line = scrub(out).strip()
    assert line, f'no policy {polname}: {err}'
    cmd, qual, wc = line.split('|', 2)
    return cmd, qual, wc


VERDICTS = [m for m in re.findall(r'(?m)^\s*AS ([a-z_0-9]+);?\s*$', open(PROBE).read())]


def run(mutation_sql):
    src = open(PROBE).read()
    i = src.index('BEGIN;\n')
    injected = src[:i + len('BEGIN;\n')] + '\n' + mutation_sql + '\n' + src[i + len('BEGIN;\n'):]
    rc, out, err = psql(injected)
    rows = [l.strip() for l in scrub(out).split('\n') if l.strip().startswith(('PASS', 'FAIL'))]
    return rc, rows, scrub(err)


def replace_fn(name, old, new):
    d = funcdef(name)
    assert old in d, f'mutation anchor not found in {name}: {old!r}'
    return d.replace(old, new, 1) + ';'


def replace_policy(table, polname, *, qual_new=None, wc_new=None):
    cmd, qual, wc = policydef(table, polname)
    cmdmap = {'r': 'SELECT', 'a': 'INSERT', 'w': 'UPDATE', 'd': 'DELETE', '*': 'ALL'}
    parts = [f'DROP POLICY "{polname}" ON public.{table};',
             f'CREATE POLICY "{polname}" ON public.{table} FOR {cmdmap[cmd]} TO authenticated']
    q = qual_new if qual_new is not None else qual
    w = wc_new if wc_new is not None else wc
    if q:
        parts.append(f'  USING ({q})')
    if w:
        parts.append(f'  WITH CHECK ({w})')
    return '\n'.join(parts) + ';'


def main():
    _, base_rows, base_err = run('')
    if len(base_rows) != len(VERDICTS):
        print(f'!! verdict count mismatch: {len(base_rows)} rows vs {len(VERDICTS)} aliases')
        print(base_err[-2000:])
        sys.exit(1)
    bad = [VERDICTS[i] for i, r in enumerate(base_rows) if not r.startswith('PASS')]
    if bad:
        print('!! baseline is not green:', bad)
        sys.exit(1)
    print(f'baseline: {len(base_rows)}/{len(VERDICTS)} PASS\n')

    ins_wc = policydef('admin_invitations', 'university_admin creates own-school invitations')[2]

    mutations = [
        ('M1  invite policy drops the role clamp',
         lambda: replace_policy('admin_invitations', 'university_admin creates own-school invitations',
                                wc_new=re.sub(r"\s*AND \(role = 'university_admin'::app_role\)", '', ins_wc)),
         ['ua_cannot_mint_superadmin']),
        ('M2  invite policy drops the school clamp',
         lambda: replace_policy('admin_invitations', 'university_admin creates own-school invitations',
                                wc_new=re.sub(r"\s*AND \(university_id = \( SELECT current_university_id\(\) AS current_university_id\)\)", '', ins_wc)),
         ['ua_cannot_invite_other_school']),
        ('M3  invite policy drops the invited_by clamp',
         lambda: replace_policy('admin_invitations', 'university_admin creates own-school invitations',
                                wc_new=re.sub(r"\s*AND \(invited_by = \( SELECT auth\.uid\(\) AS uid\)\)", '', ins_wc)),
         ['ua_cannot_forge_inviter']),
        ('M4  DELETE is granted back to authenticated',
         lambda: 'GRANT DELETE ON public.admin_invitations TO authenticated;',
         ['delete_is_revoked']),
        ('M5  get_university_admins stops hiding superadmins',
         lambda: replace_fn('get_university_admins', "and p.role = 'university_admin'::public.app_role", ''),
         ['superadmin_invisible_to_university_admin']),
        ('M6  set_admin_role drops the superadmin rail',
         lambda: replace_fn('set_admin_role',
                            "if v_target.role = 'superadmin'::public.app_role\n       or p_new_role = 'superadmin'::public.app_role then\n      raise exception 'cannot_touch_superadmin';\n    end if;", ''),
         ['cannot_demote_superadmin', 'cannot_mint_superadmin']),
        ('M7  set_admin_role drops the school rail',
         lambda: replace_fn('set_admin_role',
                            "if v_caller_university is null or v_target.university_id is distinct from v_caller_university then\n      raise exception 'wrong_university';\n    end if;", ''),
         ['cannot_cross_school']),
        ('M8  set_admin_role drops the self-change rail',
         lambda: replace_fn('set_admin_role',
                            "if v_uid = p_target_id then\n    raise exception 'cannot_change_own_role';\n  end if;", ''),
         ['cannot_change_own_role']),
        ('M9  set_admin_role lets a non-admin through',
         lambda: replace_fn('set_admin_role', "raise exception 'not_authorized';", 'null;'),
         ['non_admin_cannot_grant']),
        ('M10 set_admin_role stops auditing',
         lambda: replace_fn('set_admin_role',
                            "insert into public.admin_audit_log (actor_id, action, target_type, target_id, university_id)\n  values (v_uid, v_action, 'profile', p_target_id, v_target.university_id);", ''),
         ['legitimate_grant_works_and_audits']),
        ('M11 revoke_admin_invitation drops the school rail',
         lambda: replace_fn('revoke_admin_invitation',
                            "if v_invite.university_id is distinct from v_caller_university then\n      raise exception 'wrong_university';\n    end if;", ''),
         ['cannot_revoke_other_school']),
        ('M12 claim_pending_admin_invites drops the expiry + active-school filter',
         lambda: replace_fn('claim_pending_admin_invites',
                            "join public.universities u on u.id = i.university_id and u.is_active\n    where i.status = 'pending'\n      and i.expires_at > now()",
                            "join public.universities u on u.id = i.university_id\n    where i.status = 'pending'"),
         ['claim_only_live_active_invite']),
        ('M13 set_admin_role sets the flag SESSION-wide instead of transaction-locally',
         lambda: replace_fn('set_admin_role',
                            "perform set_config('dormcheck.role_change_authorized', 'on', true);",
                            "perform set_config('dormcheck.role_change_authorized', 'on', false);"),
         ['flag_is_transaction_local']),
        # Inverted 2026-09-06 with 20261006000000_role_change_flag_reset: the reset is now
        # the shipped behaviour, so the mutation REMOVES it from set_admin_role and the
        # §7d verdict (flag_lowered_after_authorized_rpc) must go red. Removing it from
        # claim_pending_admin_invites alone would not be caught here because §3g's
        # set_admin_role call is the last authorized RPC before §7d runs.
        ('M14 set_admin_role stops lowering the flag (the pinned hazard returns)',
         lambda: replace_fn('set_admin_role',
                            "  perform set_config('dormcheck.role_change_authorized', 'off', true);\n",
                            ""),
         ['flag_lowered_after_authorized_rpc']),
    ]

    failures = []
    for label, build, expected in mutations:
        try:
            ddl = build()
        except AssertionError as e:
            print(f'{label}\n     SKIPPED — {e}\n')
            failures.append(label + ' (anchor missing)')
            continue
        rc, rows, err = run(ddl)
        if len(rows) != len(VERDICTS):
            # A mutation can make the probe error out entirely; that is also a red, but say so.
            print(f'{label}\n     probe aborted (rc={rc}) after {len(rows)} verdict(s) — counts as red')
            got = set(VERDICTS[len(rows):len(rows) + 1])
        else:
            got = {VERDICTS[i] for i, r in enumerate(rows) if not r.startswith('PASS')}
        ok = set(expected) <= got
        extra = got - set(expected)
        print(f'{label}\n     expected red: {expected}\n     actually red: {sorted(got) or "NOTHING"}'
              f'{"  [+ collateral: " + str(sorted(extra)) + "]" if extra else ""}\n     -> {"OK" if ok else "MUTATION SURVIVED"}\n')
        if not ok:
            failures.append(label)

    print('=' * 70)
    if failures:
        print('MUTATIONS THAT SURVIVED (the test does not actually check that rail):')
        for f in failures:
            print('  -', f)
        sys.exit(1)
    print(f'all {len(mutations)} mutations were caught.')


if __name__ == '__main__':
    os.chdir(sys.argv[1] if len(sys.argv) > 1 else '.')
    main()
