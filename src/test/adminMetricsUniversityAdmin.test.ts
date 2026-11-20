import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from 'node:net';

/**
 * The admin-metrics Edge Function, from the point of view of a university_admin.
 *
 * WHY A TEST NOBODY WROTE FOR A YEAR. Prod has never had a real university_admin account, so
 * every claim about what that role sees has only ever been code-verified. Running one for the
 * first time on 2026-08-06 against the local stack found the function returning 500 to every
 * university_admin request — see the `scopedReports` case below — which means the delegated
 * admin dashboard has never worked for the role it was built for. A role that has never been
 * exercised is a role whose behaviour is a guess.
 *
 * Two layers here, deliberately:
 *   - the SOURCE guards run everywhere, including CI, and pin the two properties that were
 *     wrong or fragile;
 *   - the LIVE proof runs only when a local Supabase stack is reachable, because that is the
 *     only way to make a claim about what the function actually returns. It is skipped, loudly,
 *     rather than faked when the stack is down.
 *
 * Live result recorded 2026-08-06 against a clean stack (superadmin as the positive control,
 * which is what makes the strip meaningful — an empty array proves nothing if there was
 * nothing to strip):
 *   superadmin             200 · recentSignups 15 · suppression.applied false
 *   superadmin as_role=…   200 · recentSignups [] · stuckUsers.sample [] · applied true
 *   real university_admin  200 · recentSignups [] · stuckUsers.sample [] · applied true
 */
const FN = join(__dirname, '../../supabase/functions/admin-metrics/index.ts');
const source = readFileSync(FN, 'utf8');

describe('admin-metrics source guards', () => {
  it('strips both PII payloads for a university_admin shape', () => {
    // These two fields are the only places raw user rows (id + email + created_at) leave the
    // function. Both must be gated on shapeAsUniversityAdmin, and the gate must be the
    // ternary — a `?.` or a filter would let a shape change reintroduce them silently.
    expect(source).toContain('sample: shapeAsUniversityAdmin ? [] : raw.stuck_users ?? []');
    expect(source).toContain('recentSignups: shapeAsUniversityAdmin ? [] : raw.recent_signups ?? []');
  });

  it('reports which shape it applied, so a caller can tell suppressed from empty', () => {
    expect(source).toContain('suppression: { threshold: 5, applied: shapeAsUniversityAdmin }');
  });

  it('narrows scopedReports by type before reading .error', () => {
    // REGRESSION GUARD, fixed 2026-08-06. `scopedReports` is a NUMBER on the university-scoped
    // branch (countScopedContentReports) and a PostgREST result object otherwise. The guard
    // used to read `"error" in scopedReports`, and `in` on a number throws
    // "Cannot use the 'in' operator to search for 'error' in 2" — so EVERY university_admin
    // request 500'd with a generic "Metrics query failed", while every superadmin request
    // (which takes the object branch) worked. The bug was invisible to review because the very
    // next line already narrows correctly with `typeof === "number"`.
    expect(source).toContain('if (typeof scopedReports !== "number" && scopedReports.error)');
    expect(source).not.toContain('"error" in scopedReports');
  });
});

// ── live proof ───────────────────────────────────────────────────────────────────────────
// OPT-IN, and deliberately not auto-detected. The local edge runtime serves whatever worktree
// `npx supabase functions serve` was started from, so "port 54321 is open" says nothing about
// WHICH copy of admin-metrics is running — during this lane it was the main worktree's, i.e.
// the unfixed one. A gate that cannot tell those apart either skips when it should run or
// fails when it should skip; this one asks to be told.
//
//   npx supabase start -x studio
//   npx supabase functions serve            # from THIS worktree, leave it running
//   DC_LIVE_EDGE=1 npx vitest run src/test/adminMetricsUniversityAdmin.test.ts
//
// The reachability check still runs on top of the flag: a 5xx or a network error from an
// unauthenticated probe means nothing is serving, and skipping beats a red that blames the code.
const LOCAL_URL = 'http://127.0.0.1:54321';
const optedIn = process.env.DC_LIVE_EDGE === '1';
const reachable =
  optedIn &&
  (await new Promise<boolean>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: 54321, timeout: 1500 });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  })) &&
  (await fetch(`${LOCAL_URL}/functions/v1/admin-metrics`)
    // A healthy function rejects an unauthenticated probe (401). Anything 5xx, or a throw,
    // means the edge runtime is not actually serving it.
    .then((r) => r.status < 500)
    .catch(() => false));

if (!reachable) {
  console.warn(
    '[adminMetricsUniversityAdmin] SKIPPING the live PII proof' +
      (optedIn
        ? `: nothing is serving admin-metrics on ${LOCAL_URL}.`
        : ': set DC_LIVE_EDGE=1 with a local stack and `npx supabase functions serve` running ' +
          'from this worktree to run it.') +
      ' The source guards above still ran, and the recorded result is in this file\u2019s header.',
  );
}

type MetricsBody = {
  recentSignups?: unknown[];
  needsAttention?: { stuckUsers?: { sample?: unknown[] } };
  suppression?: { threshold: number; applied: boolean };
};

describe.skipIf(!reachable)('admin-metrics live, as a real university_admin', () => {
  it('gives a university_admin the metrics WITHOUT the user-level PII a superadmin gets', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const env = Object.fromEntries(
      readFileSync(join(__dirname, '../../.env.e2e'), 'utf8')
        .split('\n')
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    ) as Record<string, string>;
    const url = env.VITE_SUPABASE_URL;
    const anon = env.VITE_SUPABASE_ANON_KEY;
    const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: unis } = await admin.from('universities').select('id').eq('slug', 'pitt').limit(1);
    const universityId = (unis as Array<{ id: string }>)[0].id;

    const signIn = async (email: string, role: string) => {
      const password = 'AdminMetricsProbe!Passw0rd';
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      let id = created.data?.user?.id;
      if (created.error) {
        const { data: rows } = await admin.from('profiles').select('id').ilike('email', email).limit(1);
        id = (rows as Array<{ id: string }>)[0].id;
        await admin.auth.admin.updateUserById(id, { password, email_confirm: true });
      }
      // Set through the service role, which protect_profile_role() exempts; a client cannot
      // do this, and supabase/tests/admin_invitations_rails.test.sql is where that is proved.
      await admin.from('profiles').update({ role, university_id: universityId }).eq('id', id!);
      const client = createClient(url, anon, { auth: { persistSession: false } });
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`${email}: ${error.message}`);
      return data.session!.access_token;
    };
    const call = async (token: string, qs = '') => {
      const res = await fetch(`${url}/functions/v1/admin-metrics${qs}`, {
        headers: { Authorization: `Bearer ${token}`, apikey: anon },
      });
      return { status: res.status, body: (await res.json()) as MetricsBody };
    };

    const superadmin = await signIn('probe-metrics-sa@pitt.edu', 'superadmin');
    const universityAdmin = await signIn('probe-metrics-ua@pitt.edu', 'university_admin');

    // Positive control FIRST. If the superadmin view is also empty there is nothing to strip,
    // and the assertion below would pass on an empty database while proving nothing.
    const sa = await call(superadmin);
    expect(sa.status).toBe(200);
    expect(sa.body.suppression).toEqual({ threshold: 5, applied: false });
    expect(Array.isArray(sa.body.recentSignups)).toBe(true);
    expect(sa.body.recentSignups!.length).toBeGreaterThan(0);

    // The thing under test: an actual university_admin session, not a shaped superadmin.
    const ua = await call(universityAdmin);
    expect(ua.status).toBe(200); // 500 here is the 2026-08-06 scopedReports bug returning
    expect(ua.body.recentSignups).toEqual([]);
    expect(ua.body.needsAttention!.stuckUsers!.sample).toEqual([]);
    expect(ua.body.suppression).toEqual({ threshold: 5, applied: true });

    // A superadmin previewing the university_admin shape must be stripped identically —
    // otherwise the preview lies about what a delegated admin can see.
    const shaped = await call(superadmin, '?as_role=university_admin');
    expect(shaped.status).toBe(200);
    expect(shaped.body.recentSignups).toEqual([]);
    expect(shaped.body.needsAttention!.stuckUsers!.sample).toEqual([]);
    expect(shaped.body.suppression).toEqual({ threshold: 5, applied: true });
  }, 60_000);
});
