#!/usr/bin/env node
/**
 * Synthetic signup canary against the LOCAL Supabase stack.
 *
 * Why this exists: on 2026-07-09 the `protect_profile_role` trigger silently 500'd
 * EVERY new signup. Existing users were fine, so nothing looked broken until someone
 * tried to join. This canary actually signs up a throwaway @pitt.edu user through the
 * real public GoTrue path (anon key, `auth.signUp` - NOT the service-role admin API,
 * which would bypass the very triggers that break), then asserts the whole chain that
 * fires inside that one call succeeded:
 *   auth.users insert -> validate_pitt_email() -> handle_new_user() (profiles bootstrap)
 *   -> on_profile_created_checklist -> protect_profile_role
 * If any link 500s, `signUp` itself errors and this canary fails loudly.
 *
 * Runs against the E2E/local stack on purpose (not prod): it exercises the same
 * migrations + triggers without littering prod with test users or fighting the
 * @pitt.edu gate + email-confirmation flow. A future PROD variant MUST hard-delete
 * its test user unconditionally (this script already does, as a template).
 *
 * Local-only guard: refuses to run against anything but 127.0.0.1 / localhost.
 *
 * Usage: node scripts/e2e/signup_canary.mjs   (loads .env.e2e if present; CI passes
 *        VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY as env)
 */
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
loadEnv({ path: path.join(root, '.env.e2e') });

// `supabase status -o env` emits KEY="value" (quoted). GitHub's $GITHUB_ENV stores
// the line verbatim, so process.env then carries the literal surrounding quotes -
// e.g. VITE_SUPABASE_URL == '"http://127.0.0.1:54321"'. That is truthy and contains
// "127.0.0.1" (passing both guards below) yet fails supabase-js's ^https?:// check,
// which is why every run 500'd at createClient before ever reaching signUp. Strip the
// wrapping quotes + whitespace so the canary actually exercises the trigger chain.
const clean = (v) => (v ?? '').trim().replace(/^["']|["']$/g, '');
const URL = clean(process.env.VITE_SUPABASE_URL);
const ANON = clean(process.env.VITE_SUPABASE_ANON_KEY);
const SERVICE_ROLE = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!URL || !ANON || !SERVICE_ROLE) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if (!/127\.0\.0\.1|localhost/.test(URL)) {
  console.error(`Refusing to run: ${URL} is not a local Supabase stack. This canary is local-only.`);
  process.exit(1);
}

// Public path: anon key, exactly like a real browser signup.
const anon = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
// Service role: verification + mandatory cleanup only. Never used to create the user.
const admin = createClient(URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

const email = `signup-canary-${Date.now()}@pitt.edu`;
const password = `Canary!${Date.now().toString(36)}Aa1`;

const fail = (msg, extra) => {
  console.error(`✗ signup canary FAILED: ${msg}`);
  if (extra) console.error('  ', extra);
  process.exitCode = 1;
};

async function run() {
  let userId = null;
  try {
    // 1. Sign up through the real public path. A broken auth/profile trigger makes
    //    this error - the exact 2026-07-09 failure mode.
    const { data, error } = await anon.auth.signUp({ email, password });
    if (error) return fail(`auth.signUp errored (trigger/auth break?)`, error.message);
    userId = data.user?.id ?? null;
    if (!userId) return fail('signUp returned no user id', JSON.stringify(data));
    console.log(`✓ signUp succeeded: ${email} (${userId})`);

    // 2. Confirmations are off locally, so a healthy signup returns a live session.
    //    No session => the account isn't usable (a subtler auth break).
    if (!data.session?.access_token) return fail('signUp returned no session (account not usable)');
    console.log('✓ session issued');

    // 3. The profiles row must have been bootstrapped by handle_new_user(), and it
    //    must NOT come out privileged (guards against an escalation-on-signup regression).
    let profile = null;
    for (let i = 0; i < 10 && !profile; i++) {
      const { data: rows } = await admin.from('profiles').select('id, role, is_admin').eq('id', userId).limit(1);
      profile = rows?.[0] ?? null;
      if (!profile) await new Promise((r) => setTimeout(r, 500));
    }
    if (!profile) return fail('profiles row was not bootstrapped for the new user');
    if (profile.is_admin === true || (profile.role && !['user', 'student'].includes(profile.role))) {
      return fail(`new signup got an unexpected privileged role`, JSON.stringify(profile));
    }
    console.log(`✓ profile bootstrapped (role=${profile.role ?? 'null'}, is_admin=${profile.is_admin ?? false})`);

    // 4. The new user's OWN session can read its own profile under RLS - proves the
    //    authenticated read path (not just service-role) works end to end.
    const { data: ownRows, error: ownErr } = await anon.from('profiles').select('id').eq('id', userId).limit(1);
    if (ownErr) return fail('new user could not read own profile under RLS', ownErr.message);
    if (!ownRows?.length) return fail('new user got no rows reading own profile under RLS');
    console.log('✓ authenticated RLS read works for the new user');

    if (!process.exitCode) console.log('\nSignup canary passed - the full signup + profile-bootstrap chain is healthy.');
  } finally {
    // Mandatory cleanup, even on failure. Local CI tears the stack down anyway, but
    // this keeps local dev clean and is the template a prod variant would rely on.
    if (userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) console.error(`  (cleanup warning: could not delete ${userId}: ${error.message})`);
      else console.log(`✓ cleaned up test user ${userId}`);
    }
  }
}

run().catch((e) => {
  fail('unexpected error', e?.message ?? e);
});
