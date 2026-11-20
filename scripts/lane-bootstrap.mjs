#!/usr/bin/env node
/**
 * lane:bootstrap — make authed live verification work from a lane worktree.
 *
 * `lane:start` already symlinks node_modules + .env/.env.local/.env.e2e from the
 * primary checkout, so a lane can build and run. What it does NOT carry is
 * `supabase/config.toml` (gitignored, and Supabase writes to it), and a fresh
 * `db reset` seeds only the two e2e USERS — no dorms/checklist/marketplace/
 * roommate content — so authed screens render empty. This command closes exactly
 * those two gaps and leaves the lane with a browsable, useful, seeded stack.
 *
 * Idempotent and safe to re-run. Steps:
 *   1. Carry supabase/config.toml from the primary checkout (if absent).
 *   2. Ensure .env.e2e exists (symlinked by lane:start; regenerated from the
 *      running stack if the primary never had one).
 *   3. Bring the local Supabase stack up (idempotent) and `db reset` it — which
 *      applies every migration INCLUDING the storage-buckets baseline, so
 *      uploads don't 404 "Bucket not found".
 *   4. Seed the two e2e users, then seed real content.
 *   5. Print the verify command + seeded creds.
 *
 * After this: `npm run lane:verify` → open http://localhost:8123 → sign in.
 * Full guide: docs/dev-loop.md § "Verifiable authed stack from a lane".
 *
 * Usage: node scripts/lane-bootstrap.mjs   (or: npm run lane:bootstrap)
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mainRoot } from './lib/lanes.mjs';
import { claimResource, resourceRefusalText, RESOURCE_LOCAL_DB } from './lib/agent-registry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(root, p) || '.';

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`✗ \`${cmd} ${args.join(' ')}\` failed (exit ${r.status ?? 'signal'}).`);
    process.exit(r.status ?? 1);
  }
  return r;
}

// Capture stdout without inheriting (for `supabase status` probes).
function capture(cmd, args) {
  return spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
}

const primary = mainRoot();
if (!primary) {
  console.error('✗ Could not resolve the primary checkout (git worktree list).');
  process.exit(1);
}
if (path.resolve(primary) === root) {
  console.log('ℹ Running in the primary checkout, not a lane — that is fine, but this');
  console.log('  command exists mainly to make a lane worktree verifiable.\n');
}

// ── 0. CLAIM THE ONE LOCAL SUPABASE STACK ──────────────────────────────────
// There is exactly ONE local stack on this machine, shared by every worktree — so two
// lanes bootstrapping at once do not get two databases, they fight over one. On
// 2026-08-05 that is precisely what happened: a second run's `supabase start`/`db reset`
// stopped the first session's DB container mid-verification, and the UI pass it was
// running was silently lost. Unlike the session warning, this is a REAL gate: the
// collision is destructive (a `db reset` wipes the seeded data being verified against)
// and there is no version of "proceed anyway" that leaves both sessions working.
//
// The claim is NOT released at the end of this script. Bootstrapping is the setup half of
// bootstrap → verify → click through, and releasing here would let a sibling reset the DB
// out from under the half that matters. It self-clears when the holding session's process
// dies, and `npm run agent:db:release` is the deliberate exit.
const dbClaim = claimResource(RESOURCE_LOCAL_DB, { label: `lane:bootstrap ${path.basename(root)}` });
if (!dbClaim.ok) {
  console.error('');
  console.error(resourceRefusalText(RESOURCE_LOCAL_DB, dbClaim.holder, {
    action: 'refusing to start or reset it.',
  }));
  console.error('');
  process.exit(1);
}
if (dbClaim.stolen) {
  console.log(`⚠️  cleared a stale ${RESOURCE_LOCAL_DB} claim from "${dbClaim.stolen.label}" (pid ${dbClaim.stolen.pid} is gone).`);
}
console.log(`🔒 claimed the local Supabase stack for this session (release: npm run agent:db:release).`);

// ── 1. Carry supabase/config.toml ──────────────────────────────────────────
const cfg = 'supabase/config.toml';
const cfgDst = path.join(root, cfg);
const cfgSrc = path.join(primary, cfg);
if (existsSync(cfgDst)) {
  console.log(`✓ ${cfg} already present.`);
} else if (existsSync(cfgSrc)) {
  copyFileSync(cfgSrc, cfgDst);
  console.log(`✓ carried ${cfg} from ${rel(cfgSrc)}.`);
} else {
  console.log(`ℹ no ${cfg} in the primary checkout — \`supabase start\` will generate one.`);
}

// ── 2. Ensure .env.e2e exists ───────────────────────────────────────────────
// lane:start symlinks it from the primary. If the primary never had one, we
// generate it from the running stack after step 3 (below).
const envE2e = path.join(root, '.env.e2e');
const hadEnvE2e = existsSync(envE2e);
console.log(hadEnvE2e ? '✓ .env.e2e present (symlinked by lane:start).' : 'ℹ .env.e2e missing — will generate from the stack.');

// ── 3. Bring up + reset the local Supabase stack ────────────────────────────
const status = capture('npx', ['supabase', 'status']);
if (status.status === 0) {
  console.log('✓ local Supabase stack already up.');
} else {
  console.log('→ starting local Supabase stack (npx supabase start -x studio)…');
  run('npx', ['supabase', 'start', '-x', 'studio']);
}

if (!hadEnvE2e) {
  // Materialize .env.e2e from the running stack, mirroring run-audit.sh.
  const env = capture('npx', ['supabase', 'status', '-o', 'env']);
  const pick = (k) => (env.stdout.match(new RegExp(`^${k}="?([^"\\n]+)"?`, 'm')) || [])[1] || '';
  const apiUrl = pick('API_URL');
  const anon = pick('ANON_KEY');
  const service = pick('SERVICE_ROLE_KEY');
  const body =
    `VITE_SUPABASE_URL=${apiUrl}\n` +
    `VITE_SUPABASE_ANON_KEY=${anon}\n` +
    `SUPABASE_SERVICE_ROLE_KEY=${service}\n` +
    `VITE_MAPBOX_TOKEN=pk.e2e.dummy\n` +
    `E2E_USER_EMAIL=e2e+user@pitt.edu\n` +
    `E2E_USER_PASSWORD=E2eUser!Passw0rd\n` +
    `E2E_ADMIN_EMAIL=e2e+admin@pitt.edu\n` +
    `E2E_ADMIN_PASSWORD=E2eAdmin!Passw0rd\n`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(envE2e, body);
  console.log('✓ generated .env.e2e from the running stack.');
}

console.log('→ resetting DB (npx supabase db reset --local) — applies all migrations + buckets…');
run('npx', ['supabase', 'db', 'reset', '--local']);

// ── 4. Seed users + content ─────────────────────────────────────────────────
console.log('→ seeding e2e users…');
run('node', ['scripts/e2e/seed-test-users.mjs']);
console.log('→ seeding content (dorms, checklist, marketplace, roommate)…');
run('node', ['scripts/e2e/seed-content.mjs']);

// ── 5. Next steps ───────────────────────────────────────────────────────────
console.log(`
────────────────────────────────────────────────────────────
✓ Lane stack is verifiable.

  Start the browsable server:   npm run lane:verify
  Then open:                    http://localhost:8123

  Sign in (Turnstile is disabled — leave nothing to enter):
    user   e2e+user@pitt.edu   / E2eUser!Passw0rd
    admin  e2e+admin@pitt.edu  / E2eAdmin!Passw0rd

  Guide: docs/dev-loop.md § "Verifiable authed stack from a lane"
────────────────────────────────────────────────────────────`);
