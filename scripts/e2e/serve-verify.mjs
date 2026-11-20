#!/usr/bin/env node
/**
 * Launch a BROWSABLE Vite dev server wired to the LOCAL Supabase e2e stack,
 * for hand/agent verification of authed surfaces from a lane worktree.
 *
 * This is the interactive sibling of playwright.config.ts's `webServer`: it
 * reuses the exact same env override so what you click through by hand is
 * byte-identical to what the automated crawl exercises — no drift between
 * "what I verified" and "what CI verifies".
 *
 *   - Port 8123 / --strictPort  → dedicated, never collides with Ethan's :8080.
 *   - VITE_SUPABASE_URL/ANON    → the local stack (from .env.e2e), NOT prod.
 *   - VITE_TURNSTILE_SITE_KEY='' → THE TRAP: a real Turnstile key in headless/
 *     localhost Chromium leaves the sign-in submit permanently disabled and
 *     looks exactly like a P0 auth bug. Blanking it enables the app's own
 *     keyless-dev bypass (src/lib/turnstile.ts). Shell env wins over
 *     .env/.env.local, same override mechanism playwright.config.ts uses.
 *
 * Usage: node scripts/e2e/serve-verify.mjs   (or: npm run lane:verify)
 * Then open http://localhost:8123 and sign in as a seeded user
 * (e2e+user@pitt.edu / E2eUser!Passw0rd — see scripts/e2e/seed-test-users.mjs).
 */
import { spawn } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { claimResource, releaseResource, resourceRefusalText, RESOURCE_LOCAL_DB } from '../lib/agent-registry.mjs';

const PORT = 8123;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const envFile = path.join(root, '.env.e2e');

if (!existsSync(envFile)) {
  console.error(
    `✗ ${envFile} not found.\n` +
      `  Run \`npm run lane:bootstrap\` first (it brings up the local stack and writes .env.e2e).`,
  );
  process.exit(1);
}

loadEnv({ path: envFile });

const url = process.env.VITE_SUPABASE_URL ?? '';
if (!/127\.0\.0\.1|localhost/.test(url)) {
  console.error(`✗ Refusing to serve: VITE_SUPABASE_URL (${url || 'empty'}) is not a local stack.`);
  process.exit(1);
}

// Mirror playwright.config.ts's webServerEnv exactly. Shell env overrides
// whatever .env/.env.local Vite would otherwise load, so the committed
// prod-pointing config can never leak into this verification server.
const env = {
  ...process.env,
  VITE_SUPABASE_URL: url,
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? '',
  VITE_MAPBOX_TOKEN: process.env.VITE_MAPBOX_TOKEN ?? 'pk.e2e.dummy',
  VITE_SITE_URL: `http://localhost:${PORT}`,
  VITE_TURNSTILE_SITE_KEY: '', // the trap — keep empty
};

// Claim the ONE local Supabase stack before serving against it. `lane:bootstrap` normally
// claimed it already and this is a no-op renewal for the same session; the case that
// matters is the OTHER order — this server browsing seeded data while a sibling session
// runs `lane:bootstrap` and `db reset`s it out from under the browser. Refusing here is
// what makes the claim meaningful in both directions.
const dbClaim = claimResource(RESOURCE_LOCAL_DB, { label: 'lane:verify (:8123)' });
if (!dbClaim.ok) {
  console.error('');
  console.error(resourceRefusalText(RESOURCE_LOCAL_DB, dbClaim.holder, { action: 'refusing to serve against it.' }));
  console.error('');
  process.exit(1);
}
// This server is the interactive session itself, so its claim ends when it does.
const dropClaim = () => { try { releaseResource(RESOURCE_LOCAL_DB); } catch { /* best-effort */ } };
process.on('SIGINT', () => { dropClaim(); process.exit(130); });
process.on('SIGTERM', () => { dropClaim(); process.exit(143); });

console.log(`→ serving verification stack at http://localhost:${PORT}  (Supabase: ${url})`);
console.log(`  Turnstile: disabled (keyless-dev bypass).  Sign in with a seeded e2e user.`);

const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
child.on('exit', (code) => { dropClaim(); process.exit(code ?? 0); });
