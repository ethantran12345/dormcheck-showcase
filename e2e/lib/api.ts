import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

/**
 * Direct Supabase API access for the security/behavior specs.
 *
 * UI specs drive the browser; these helpers exist for assertions the UI cannot
 * make honestly — "the SERVER refuses" claims (RLS / trigger end-state), where a
 * passing UI test would only prove the button is hidden. Everything here targets
 * the LOCAL stack from .env.e2e; the URL guard refuses anything non-local so a
 * misconfigured shell can never point these at prod.
 */

const URL = process.env.VITE_SUPABASE_URL ?? '';
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!/127\.0\.0\.1|localhost/.test(URL)) {
  throw new Error(`e2e/lib/api.ts refuses non-local Supabase URL: "${URL}" — load .env.e2e`);
}

const bare = () =>
  createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

/** Anonymous (signed-out) client — what a guest's browser session can reach. */
export const anonClient = (): SupabaseClient => bare();

/** Service-role client — test fixture setup ONLY, never the subject of an assertion. */
export const serviceClient = (): SupabaseClient =>
  createClient(URL, SERVICE_ROLE, { auth: { autoRefreshToken: false, persistSession: false } });

/** Password sign-in via the API (Turnstile only gates the UI form, not GoTrue). */
export async function userClient(email: string, password: string): Promise<SupabaseClient> {
  const c = bare();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in as ${email} failed: ${error.message}`);
  return c;
}

// --- Fixture users -----------------------------------------------------------

export const PITT_UNIVERSITY_ID = '00000000-0000-4000-8000-000000000001';
export const CMU_UNIVERSITY_ID = '00000000-0000-4000-8000-000000000002';

/** Deterministic per-fixture password; local-stack only, never a real secret. */
export const FIXTURE_PASSWORD = 'E2eFixture!Passw0rd';

/**
 * Idempotently ensure a confirmed user + patched profile exists in the local
 * stack. Mirrors scripts/e2e/seed-test-users.mjs but callable from a spec, so
 * the suite owns its fixtures instead of depending on a manual seed step.
 *
 * Deliberately avoids auth.admin.listUsers: the DB test suite
 * (supabase/tests/*.test.sql) leaves raw-SQL auth.users rows whose NULL token
 * columns make GoTrue's listUsers scan 500 ("converting NULL to string"), and
 * that suite can run against this shared stack at any time. Existing users are
 * resolved through public.profiles (kept in sync by the signup trigger), which
 * never touches the broken scan.
 */
export async function ensureUser(
  email: string,
  opts: { universityId?: string; fullName?: string; password?: string } = {},
): Promise<string> {
  const svc = serviceClient();
  const password = opts.password ?? FIXTURE_PASSWORD;
  const { data: existing, error: lookupErr } = await svc
    .from('profiles')
    .select('id')
    .ilike('email', email)
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  let userId = existing?.id as string | undefined;
  if (userId) {
    // Known password every run, even if a previous run changed it.
    const { error } = await svc.auth.admin.updateUserById(userId, { password });
    if (error) throw error;
  } else {
    const { data, error } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: opts.fullName ?? email.split('@')[0] },
    });
    if (error) throw error;
    userId = data.user.id;
  }
  const { error: pErr } = await svc
    .from('profiles')
    .update({
      has_completed_onboarding: true,
      is_public: true,
      email_notifications: false,
      ...(opts.fullName ? { full_name: opts.fullName } : {}),
      ...(opts.universityId ? { university_id: opts.universityId } : {}),
    })
    .eq('id', userId);
  if (pErr) throw pErr;
  return userId;
}

// --- TOTP (RFC 6238, SHA-1, 6 digits, 30s step) ------------------------------
// Implemented on node:crypto so the suite adds no dependency; GoTrue's TOTP
// factors use exactly these defaults.

function base32Decode(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secretBase32: string, at: number = Date.now()): string {
  const counter = Math.floor(at / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}
