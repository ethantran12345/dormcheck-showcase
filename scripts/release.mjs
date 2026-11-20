#!/usr/bin/env node
/**
 * release - ship dev → main the safe way. Web deploys continuously from main
 * (Vercel), so this is the production gate.
 *
 *   npm run release           # dry-run: shows the plan, refuses a dirty tree, ends on dev
 *   npm run release -- --yes  # actually fast-forwards main to dev and pushes
 *
 * Invariants (why this exists):
 *   - REFUSES a dirty tree — uncommitted work must be committed (never carried in a
 *     stash) before a release, so nothing is silently left behind.
 *   - ALWAYS ends on dev — dev is the trunk / live-preview branch; a release must
 *     never strand Ethan's checkout on main.
 *   - main only ever fast-forwards from dev (the two-permanent-branch model).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryRun = (cmd) => { try { return run(cmd); } catch { return ''; } };
const say = (s) => console.log(s);
const die = (s) => { console.error(`✗ ${s}`); returnToDev(); process.exit(1); };
const CONFIRM = process.argv.includes('--yes') || process.env.RELEASE_CONFIRM === '1';

// Local-only Vercel Deployment Protection credential for the free dev-preview
// gate. The environment wins so CI/operators can provide it directly; this
// file is ignored by .gitignore and must never contain a VITE_ key.
function loadLocalReleaseEnv() {
  const envFile = '.env.release.local';
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
loadLocalReleaseEnv();

function returnToDev() {
  const cur = tryRun('git rev-parse --abbrev-ref HEAD');
  if (cur && cur !== 'dev') { tryRun('git checkout dev'); }
}

// ── post-deploy smoke helpers ────────────────────────────────────────────────
const httpCode = (url) => tryRun(`curl -s -o /dev/null -m 10 -w '%{http_code}' ${url}`);
const sleepS = (s) => { try { execSync(`sleep ${s}`); } catch { /* ignore */ } };

// Best-effort wait for Vercel to serve the URL. Web deploys continuously from main, so we
// can't cheaply confirm THIS commit is live without a Vercel API call; we give it an initial
// settle window, then poll for a 200. (Set DC_PROD_URL / DC_RELEASE_SETTLE_S to tune.)
function waitForDeploy(url) {
  const settle = Number(process.env.DC_RELEASE_SETTLE_S) || 45;
  const timeout = Number(process.env.DC_RELEASE_SETTLE_TIMEOUT_S) || 180;
  say(`  settling ${settle}s, then polling ${url} (≤${timeout}s) for a 200…`);
  sleepS(settle);
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    if (httpCode(url) === '200') return true;
    sleepS(5);
  }
  return httpCode(url) === '200';
}

function runSmoke(url) {
  try { execSync(`node scripts/smoke.mjs ${url}`, { stdio: 'inherit' }); return true; }
  catch { return false; }
}

// 1. Refuse a dirty tree — unconditionally, before touching anything.
const dirty = tryRun('git status --porcelain');
if (dirty) {
  console.error('✗ release refused: working tree is dirty.');
  console.error('  Commit your work first (git add -A && git commit -m "wip: ..."), never leave it in a stash.');
  console.error('  Nothing was changed; still on your current branch.');
  process.exit(1);
}

say('→ tree clean. Preparing dev → main release…');
tryRun('git fetch origin --quiet');

// 2. dev must be pushed (main can only mirror what origin/dev has).
const dev = tryRun('git rev-parse dev');
const odev = tryRun('git rev-parse origin/dev');
if (!dev) die('no local dev branch.');
if (dev !== odev) die(`dev ≠ origin/dev — push dev first (git push origin dev). local ${dev.slice(0, 8)}, origin ${odev.slice(0, 8)}.`);

// 3. main must be a fast-forward of dev (never diverged).
const main = tryRun('git rev-parse origin/main');
if (main && tryRun(`git merge-base --is-ancestor origin/main dev && echo ok`) !== 'ok') {
  die('origin/main is NOT an ancestor of dev — main diverged. Reconcile by hand.');
}
const ahead = tryRun('git rev-list --count origin/main..dev') || '0';
say(`  dev == origin/dev ✓   main is fast-forwardable ✓   dev is ${ahead} commit(s) ahead of main.`);

if (ahead === '0') { say('· main already equals dev — nothing to release.'); returnToDev(); process.exit(0); }

// 3b. MIGRATION GATE — the four-step database sequence (scripts/migration-gate.mjs):
//       1. clean apply from zero   supabase db reset + npm run test:db
//       2. backup freshness        db:preflight (the destructive-migration backup gate)
//       3. live-object probe       every object the release-set migrations touch, in prod
//       4. security advisors       advisors/security vs the committed baseline
//     Runs on BOTH dry-run and real releases, so the verdict is visible before anyone types
//     --yes. It replaced a "staging" gate that had never validated anything: STAGING_DB_URL
//     was never set, so both the workflow and this step's ancestor no-opped green forever.
//     There is NO bypass env var — see the header of migration-gate.mjs for why.
//     NOTE: step 1 resets the LOCAL Supabase stack; a release is not a moment to be holding
//     unsaved local database state (the dirty-tree refusal above says the same about git).
// 3b-pre. Fail fast on the post-promote CI proof's own preconditions. This gate runs AFTER the
//     push (it can only assert about main's new head), so its dependencies are checked here,
//     BEFORE anything is promoted — a missing `gh` must abort a release that hasn't happened,
//     not strand one that has.
const CRASH_GATE_WORKFLOW = 'crash-gate.yml';
const SKIP_CI_PROOF = process.env.SKIP_CRASH_GATE_PROOF === '1';
if (SKIP_CI_PROOF) {
  say('· post-promote crash-gate CI proof skipped (SKIP_CRASH_GATE_PROOF=1) — main will be promoted with NO verified CI run.');
} else {
  if (!tryRun('gh --version')) {
    die('gh CLI not found, and the post-promote crash-gate CI proof needs it.\n' +
        '  Install it (brew install gh) or, accepting that main gets promoted with no verified CI run, set SKIP_CRASH_GATE_PROOF=1.');
  }
  if (tryRun('gh auth status >/dev/null 2>&1 && echo ok') !== 'ok') {
    die('gh is installed but not authenticated (gh auth login), and the post-promote crash-gate CI proof needs it.\n' +
        '  Authenticate, or set SKIP_CRASH_GATE_PROOF=1 to promote with no verified CI run.');
  }
}

say('');
say('→ migration gate (clean replay · backup · prod objects · security advisors)…');
try {
  execSync('node scripts/migration-gate.mjs', { stdio: 'inherit' });
} catch {
  say('');
  die('migration gate failed — see the numbered step above. Release aborted; nothing was promoted.');
}

// 3c. Pre-promote DEV PREVIEW gate — the stable Vercel dev-branch alias is rebuilt for every
//     push to dev, so it is a no-extra-cost, deployed-build check before we mirror dev → main.
//     It shares the normal Preview environment rather than a separate database, and it never
//     claimed otherwise; this is a DEPLOYED-BUILD check and it is real, which is why it
//     survived the deletion of the staging gate it used to be tangled with. Runs on BOTH
//     dry-run and real releases so a red deployed dev build is caught before anyone types
//     --yes. Target override: DC_PREVIEW_GATE_URL (also honoured by `npm run preview:smoke`).
{
  const previewUrl = process.env.DC_PREVIEW_GATE_URL || 'https://dormcheck-git-dev-dormcheck.vercel.app';
  say('');
  say(`→ pre-promote dev-preview smoke: ${previewUrl}`);
  if (!runSmoke(previewUrl)) {
    die(`dev-preview smoke FAILED against ${previewUrl} — refusing to promote dev → main.\n` +
        `  The preview is Vercel's deployed dev branch; a red preview means this release build is not healthy.\n` +
        `  Investigate the failing assertion above. There is no bypass: this step checks a deployed build,\n` +
        `  and the only reason to want one would be to promote a build that failed it.`);
  }
  say('✓ dev-preview smoke passed — preview responds, mounts, auth reachable, console-clean.');
}

if (!CONFIRM) {
  say('');
  say(`DRY RUN — would fast-forward main → dev (${ahead} commit(s)) and push to origin.`);
  say('  Re-run with:  npm run release -- --yes');
  returnToDev();
  process.exit(0);
}

// 4. Execute: ff main to dev, push, always return to dev.
try {
  say(`→ merging ${ahead} commit(s) dev → main…`);
  run('git checkout main');
  run('git merge --ff-only dev');
  run('git push origin main');
  say(`✓ released: origin/main now at ${tryRun('git rev-parse --short dev')}. Vercel will deploy.`);
  // Bridge newly-shipped decisions + user-facing changes into the Obsidian vault. Runs
  // only here (what reaches main is what the vault cares about), never on every commit.
  // Skips cleanly if the vault isn't mounted; never fails the release.
  say('→ bridging journals to the vault (npm run vault:sync)…');
  try { say(execSync('npm run --silent vault:sync', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()); }
  catch (e) { say(`  (vault:sync skipped/failed, release unaffected: ${String(e.message || e).split('\n')[0]})`); }
} catch (e) {
  console.error(`✗ release failed mid-flight: ${e.message}`);
  returnToDev();
  process.exit(1);
} finally {
  returnToDev();
}
say(`· back on ${tryRun('git rev-parse --abbrev-ref HEAD')}.`);

// 4b. POST-PROMOTE CI PROOF — make main's crash gate a fact instead of a hope.
//
//     crash-gate.yml is the ONLY push-triggered workflow on main. On 2026-07-31 a
//     github-actions[bot] commit whose message ended in `[skip ci]` became dev's tip, was
//     fast-forwarded onto main by this script, and GitHub evaluated `[skip ci]` against the
//     pushed head — so ZERO workflow runs fired and main was promoted with no CI at all. The
//     other green runs on main (Prod Smoke, Signup Canary, Auth Gating Canary, RLS Coverage)
//     are schedule-triggered; they merely report main's SHA and must never be read as
//     promotion CI.
//
//     We dispatch crash-gate.yml UNCONDITIONALLY and wait for its result, rather than refusing
//     a release whose head says `[skip ci]`. Refusing would only cover the one suppression
//     string we happen to know about; a dispatch covers every reason CI might not have fired
//     (message variants like `[ci skip]`, path filters, a disabled workflow, a bot changing its
//     message format) because it does not care WHY the push run is missing. A duplicate run in
//     the normal case is cheap; an unverified promotion is not.
//
//     Fixing this with an empty commit is NOT an option — it would break the --ff-only
//     invariant this script exists to protect.
//
//     Escape hatch: SKIP_CRASH_GATE_PROOF=1 (an outage of the GH API, not a red gate).
if (!SKIP_CI_PROOF) {
  const released = tryRun('git rev-parse dev');
  say('');
  say(`→ crash-gate CI proof: dispatching ${CRASH_GATE_WORKFLOW} on main (${released.slice(0, 8)})…`);

  const failProof = (why) => {
    say('');
    say(`✗ CRASH-GATE CI PROOF FAILED — ${why}`);
    say('  main IS ALREADY RELEASED and Vercel is deploying it. This is not a dry run.');
    say('  To revert web to the pre-release commit, run exactly:');
    say(`     git push --force-with-lease origin ${main}:main`);
    say(`  (this moves origin/main back to ${(main || '').slice(0, 8)}; Vercel will redeploy it.)`);
    process.exit(2);
  };

  const lastRunId = Number(
    tryRun(`gh run list --workflow=${CRASH_GATE_WORKFLOW} --limit=1 --json databaseId --jq '.[0].databaseId // 0'`) || 0,
  );
  try {
    run(`gh workflow run ${CRASH_GATE_WORKFLOW} --ref main`);
  } catch (e) {
    failProof(`could not dispatch ${CRASH_GATE_WORKFLOW}: ${String(e.message || e).split('\n')[0]}`);
  }

  // GitHub registers the run asynchronously; poll for OUR run — a workflow_dispatch run on the
  // released SHA with an id newer than the newest run that existed before we dispatched.
  let runId = 0;
  for (let i = 0; i < 30 && !runId; i++) {
    sleepS(4);
    const id = Number(
      tryRun(
        `gh run list --workflow=${CRASH_GATE_WORKFLOW} --event=workflow_dispatch --limit=10 ` +
        `--json databaseId,headSha --jq '[.[] | select(.headSha == "${released}")] | .[0].databaseId // 0'`,
      ) || 0,
    );
    if (id > lastRunId) runId = id;
  }
  if (!runId) {
    failProof(
      `dispatched ${CRASH_GATE_WORKFLOW} but no matching run appeared on ${released.slice(0, 8)} within ~2 minutes.\n` +
      `  Do NOT assume it passed. Check: gh run list --workflow=${CRASH_GATE_WORKFLOW}`,
    );
  }

  say(`  run ${runId} — waiting for its conclusion…`);
  let proofOk = false;
  try {
    execSync(`gh run watch ${runId} --exit-status`, { stdio: 'inherit' });
    proofOk = true;
  } catch { proofOk = false; }
  if (!proofOk) {
    failProof(`crash-gate run ${runId} did not conclude successfully on the released commit.`);
  }
  say(`✓ crash-gate passed on main (${released.slice(0, 8)}) — run ${runId}. CI on this promotion is verified, not assumed.`);
}

// 5. Post-deploy smoke — a green build is not a working site. Verify prod actually boots.
//    Runs AFTER the release is fully done and we're back on dev, so it can never leave git
//    in a half-state. On failure we do NOT auto-rollback (a wrong auto-revert is worse than
//    a known-bad deploy) — we print the exact one-line revert and the failing assertion.
if (process.env.SKIP_SMOKE === '1') {
  say('· post-deploy smoke skipped (SKIP_SMOKE=1).');
  process.exit(0);
}
const prodUrl = process.env.DC_PROD_URL || 'https://dormcheck.com';
say('');
say(`→ post-deploy smoke: ${prodUrl}`);
if (!waitForDeploy(prodUrl)) say(`  ⚠ ${prodUrl} never returned 200 in the settle window — smoking anyway to report the failure.`);
const smokeOk = runSmoke(prodUrl);
if (!smokeOk) {
  say('');
  say('✗ POST-DEPLOY SMOKE FAILED — main is released and Vercel served a broken site.');
  say('  No auto-rollback. To revert web to the pre-release commit, run exactly:');
  say(`     git push --force-with-lease origin ${main}:main`);
  say(`  (this moves origin/main back to ${(main || '').slice(0, 8)}; Vercel will redeploy it.)`);
  say('  Then investigate the failing assertion printed above before re-releasing.');
  process.exit(2);
}
say('✓ post-deploy smoke passed — prod responds, mounts, and is console-clean.');
