#!/usr/bin/env node
/**
 * Seed the two E2E test accounts into the LOCAL Supabase stack.
 *
 * Idempotent: safe to re-run. Creates (or reuses) e2e+user and e2e+admin,
 * marks them email-confirmed, and flips the admin's profile flags so the
 * full-app-preview crawl can un-gate housing/map/roommates.
 *
 * Refuses to run against anything that isn't a local (127.0.0.1 / localhost)
 * Supabase URL - a guard so this can never seed the prod project.
 *
 * Usage: node scripts/e2e/seed-test-users.mjs   (loads .env.e2e)
 */
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertStackHealthy } from './local-db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
loadEnv({ path: path.join(root, '.env.e2e') });

const URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE_ROLE) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.e2e');
  process.exit(1);
}
if (!/127\.0\.0\.1|localhost/.test(URL)) {
  console.error(`Refusing to seed: ${URL} is not a local Supabase stack. This script is local-only.`);
  process.exit(1);
}

const admin = createClient(URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Every shape of error this script can catch, rendered as something an operator can act on.
 *
 * A GoTrue error arrives as `{ __isAuthError, name, status, code, message }` in the happy
 * case, but the transport-level ones carry `msg` (GoTrue's own JSON field) and NO `message`.
 * The old handler printed `e.message ?? e`, so those rendered as the famously useless
 * `Seed failed: {}` — the exact output the 2026-08-06 UI pass got when the admin API was
 * returning 500 (docs/handoffs/authed-ui-pass-2026-08-06.md defect 4). Never print an error
 * object and hope it stringifies.
 */
export function describeError(e) {
  if (e == null) return 'unknown error (nothing was thrown)';
  if (typeof e === 'string') return e;
  const parts = [];
  const text = e.message || e.msg || e.error_description || e.error_message || e.details || e.error;
  if (text) parts.push(String(text));
  const code = e.code ?? e.error_code;
  if (code) parts.push(`code=${code}`);
  if (e.status) parts.push(`status=${e.status}`);
  if (e.hint) parts.push(`hint=${e.hint}`);
  if (parts.length === 0) {
    // Last resort: own-property dump, because JSON.stringify(Error) is '{}'.
    try {
      const own = Object.fromEntries(Object.getOwnPropertyNames(e).map((k) => [k, e[k]]));
      parts.push(JSON.stringify(own));
    } catch {
      parts.push(String(e));
    }
  }
  const out = parts.join(' · ');
  return e.stack && !out.includes('\n') ? `${out}\n${e.stack.split('\n').slice(1, 4).join('\n')}` : out;
}

const alreadyRegistered = (e) =>
  e?.code === 'email_exists' ||
  e?.status === 422 ||
  /already (been )?registered|already exists|duplicate key/i.test(e?.message || e?.msg || '');

/**
 * Create the user if absent, else adopt and re-converge the existing one.
 *
 * DELIBERATELY DOES NOT CALL `listUsers()`. The admin list endpoint pages the WHOLE
 * `auth.users` table through GoTrue's Go struct, so one row with a NULL token column —
 * which any SQL fixture inserting into auth.users can leave behind — makes it answer 500
 * for every caller, and this seed died on it immediately after a green `npm run test:db`
 * (defect 4). `createUser` + a targeted `getUserById` touch only the row we care about, so
 * the seed no longer depends on the health of rows it did not create. `assertStackHealthy()`
 * still runs first, because a poisoned stack is worth naming even when we can work around it.
 *
 * `updateUserById` on the existing path makes this genuinely idempotent: a re-run converges
 * the password and the confirmed flag instead of silently reusing an account whose password
 * no longer matches .env.e2e — a failure that surfaces much later as an unexplained login
 * timeout in the crawl.
 */
async function ensureUser(email, password) {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: email.split('@')[0] },
  });
  if (!created.error) return created.data.user;
  if (!alreadyRegistered(created.error)) throw created.error;

  // Exists already. Resolve the id WITHOUT the admin list: the `on_auth_user_created`
  // trigger mirrors every auth user into public.profiles, and the service role reads it
  // through PostgREST, which has no opinion about NULL token columns.
  const { data: rows, error: lookupError } = await admin
    .from('profiles')
    .select('id')
    .ilike('email', email)
    .limit(1);
  if (lookupError) throw lookupError;
  const id = rows?.[0]?.id;
  if (!id) {
    throw new Error(
      `${email} is already registered in auth.users but has no public.profiles row, so its id ` +
      'cannot be resolved without the admin list API. Either the on_auth_user_created trigger ' +
      'did not fire or the profile was deleted. Cheapest fix: npx supabase db reset --local'
    );
  }
  const { error: updateError } = await admin.auth.admin.updateUserById(id, {
    password,
    email_confirm: true,
  });
  if (updateError) throw updateError;
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error) throw error;
  return data.user;
}

/** Patch the profiles row (auto-created by the on_auth_user_created trigger). */
async function patchProfile(id, patch) {
  const { error } = await admin.from('profiles').update(patch).eq('id', id);
  if (error) throw error;
}

async function main() {
  // Refuse to start on a stack the auth admin API cannot survive. This runs FIRST and
  // names the cause, because every failure downstream of a poisoned auth.users points at
  // the wrong thing (defect 4: the seed died two lines after a green DB gate, printing
  // `Seed failed: {}`). Set E2E_REPAIR_STACK=1 to patch it in place instead of refusing.
  const health = assertStackHealthy({ repair: process.env.E2E_REPAIR_STACK === '1' });
  if (health.repaired) {
    console.log(`⚠ repaired ${health.poisoned.length} poisoned auth.users row(s): ${health.poisoned.join(', ')}`);
  }

  // Storage buckets are created by migration 20260820020000_storage_buckets_baseline.sql
  // (run-audit.sh applies it via `supabase db reset` before this seed), so this
  // script no longer needs to create them. The old ensureBuckets() helper was
  // removed 2026-07-20 to keep a single source of truth for bucket definitions.
  const user = await ensureUser(process.env.E2E_USER_EMAIL, process.env.E2E_USER_PASSWORD);
  await patchProfile(user.id, {
    role: 'user',
    is_admin: false,
    has_completed_onboarding: true,
    is_public: true,
    full_name: 'E2E User',
  });
  console.log(`✓ user  ${user.email} (${user.id})`);

  const adminUser = await ensureUser(process.env.E2E_ADMIN_EMAIL, process.env.E2E_ADMIN_PASSWORD);
  await patchProfile(adminUser.id, {
    // Tiered RBAC: role drives isAdmin in the app; the DB sync trigger keeps
    // is_admin aligned, but set both for pre-migration compatibility.
    role: 'superadmin',
    is_admin: true,
    has_completed_onboarding: true,
    is_public: true,
    full_name: 'E2E Admin',
  });
  console.log(`✓ admin ${adminUser.email} (${adminUser.id})`);

  console.log('\nSeed complete.');
}

main().catch((e) => {
  console.error(`Seed failed: ${describeError(e)}`);
  process.exit(1);
});
