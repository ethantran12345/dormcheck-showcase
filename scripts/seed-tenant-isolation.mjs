#!/usr/bin/env node
/**
 * Seed checked-in two-school tenant-isolation fixture.
 * Idempotent upsert: creates pitt.demo@pitt.edu and cmu.demo@pitt.edu with profiles
 * linked to Pitt and CMU tenants respectively. Re-running resets passwords to the
 * documented value and ensures no duplicates.
 *
 *   node scripts/seed-tenant-isolation.mjs [--env .env]
 *
 * SCOPE
 *   - Creates exactly two users: pitt.demo@pitt.edu (Pitt tenant) and cmu.demo@pitt.edu (CMU tenant).
 *   - Uses DOT convention to match the style of seed-appreview-demo-data.mjs.
 *   - Password: from required env var DC_TENANT_FIXTURE_PASSWORD (never committed).
 *   - Idempotent: re-running re-creates profiles and resets passwords; never duplicates.
 *   - Scope: only these two demo users; never touches any real user data.
 *
 * WHY THIS EXISTS
 *   - Tenant-isolation e2e tests need two authenticated users from different tenants.
 *   - These users are now checked-in (scripts/seed-tenant-isolation.mjs), eliminating
 *     ad-hoc manual password resets.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const ENV_FILE = flag("--env") ?? ".env";

const PITT_UNIVERSITY_ID = "00000000-0000-4000-8000-000000000001";
const CMU_UNIVERSITY_ID = "00000000-0000-4000-8000-000000000002";

// Two fixture users: one per tenant
const FIXTURE_USERS = [
  {
    email: "pitt.demo@pitt.edu",
    full_name: "Pitt Tenant Demo",
    university_id: PITT_UNIVERSITY_ID,
  },
  {
    email: "cmu.demo@pitt.edu",
    full_name: "CMU Tenant Demo",
    university_id: CMU_UNIVERSITY_ID,
  },
];

function loadEnv(path) {
  const abs = join(REPO_ROOT, path);
  if (!existsSync(abs)) return;
  for (const line of readFileSync(abs, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv(ENV_FILE);
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(`Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (env file: ${ENV_FILE})`);
  process.exit(1);
}

// Target guard: LOCAL ONLY. This fixture fabricates @pitt.edu accounts and writes them,
// so the only database it may ever reach is a loopback stack.
//
// It briefly had a second door — DC_ALLOW_STAGING_SEED=1 plus a URL matching
// STAGING_SUPABASE_PROJECT_REF — added 2026-07-21 for `staging-sync.yml` to seed a staging
// project. That project was never provisioned, the workflow was deleted on 2026-08-06 having
// never run a single seed, and the door is now closed: a remote-write opt-in kept alive for a
// caller that does not exist is only ever available to a mistake. There is no staging tier
// (docs/release-gates.md); prod is the first real database this repo's migrations meet, and
// nothing in this file may write to it.
const isLocal = /127\.0\.0\.1|localhost/.test(SUPABASE_URL);
const PROD_REF = process.env.DC_SUPABASE_PROD_REF || "abcdefghijklmnopqrst";
if (SUPABASE_URL.includes(PROD_REF)) {
  console.error(`Refusing to run this synthetic fixture against the PROD project (${PROD_REF}).`);
  process.exit(1);
}
if (!isLocal) {
  console.error(`This fixture runs against a LOCAL stack only. Refusing to run against ${SUPABASE_URL}.`);
  console.error(`  There is no staging tier to seed; point VITE_SUPABASE_URL at 127.0.0.1 (npx supabase start).`);
  process.exit(1);
}

// REQUIRED — never committed, never defaulted, never echoed. A fallback would
// reintroduce the credential exposure this replaced (rotated 2026-08-02).
const DEMO_PASSWORD = process.env.DC_TENANT_FIXTURE_PASSWORD;
if (!DEMO_PASSWORD) {
  console.error("Missing required env var DC_TENANT_FIXTURE_PASSWORD (set locally / in CI secrets; no default).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const die = (msg) => {
  console.error(`ABORT: ${msg}`);
  process.exit(1);
};

async function ensureUser(email, password, universityId) {
  // Fetch or create via service-role admin API
  console.log(`Ensuring user ${email}...`);

  // Get or create auth user
  let user;
  try {
    const { data: users, error: fetchErr } = await supabase.auth.admin.listUsers({
      perPage: 1000,
    });
    if (fetchErr) throw fetchErr;

    user = users?.users?.find((u) => u.email === email);
    if (!user) {
      // Create new user
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createErr) throw createErr;
      user = newUser?.user;
    } else {
      // Reset password on existing user
      const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, {
        password,
      });
      if (updateErr) throw updateErr;
      console.log(`  Reused user ${email}, password reset`);
    }
  } catch (err) {
    die(`Failed to ensure auth user ${email}: ${err.message}`);
  }

  // Ensure profile (upsert)
  try {
    const { error: profileErr } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        full_name: FIXTURE_USERS.find((f) => f.email === email).full_name,
        university_id: universityId,
        email_notifications: false, // Disable email notifications for demo account
      },
      { onConflict: "id" }
    );
    if (profileErr) throw profileErr;
    console.log(`  Profile created/updated for ${email} (tenant ${universityId})`);
  } catch (err) {
    die(`Failed to upsert profile for ${email}: ${err.message}`);
  }

  return user;
}

async function main() {
  console.log(`Seeding two-school tenant-isolation fixture (${isLocal ? "LOCAL" : "STAGING"})...\n`);

  for (const fixture of FIXTURE_USERS) {
    await ensureUser(fixture.email, DEMO_PASSWORD, fixture.university_id);
  }

  console.log("\n✓ Fixture complete.");
  console.log("  pitt.demo@pitt.edu (Pitt tenant) and cmu.demo@pitt.edu (CMU tenant)");
  console.log("  sign in with the DC_TENANT_FIXTURE_PASSWORD value.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
