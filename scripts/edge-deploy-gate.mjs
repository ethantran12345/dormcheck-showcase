#!/usr/bin/env node
/**
 * edge-deploy-gate — refuse to deploy an Edge Function whose preconditions are not
 * live in the target project (BA-07, docs/audits/backend-audit-2026-09-06.md).
 *
 *   node scripts/edge-deploy-gate.mjs moderate-image            # check only
 *   node scripts/edge-deploy-gate.mjs moderate-image --deploy   # check, then `supabase functions deploy`
 *
 * WHY. moderate-image MOVES a rejected image into the private `images-quarantine`
 * bucket and records a one-year preservation clock (18 U.S.C. § 2258A(h), REPORT
 * Act). Deployed into a project where that bucket does not exist, every reject would
 * fail its quarantine copy and the caller would delete the object — detection with no
 * preservation path, the exact state the vault note calls a violation rather than a
 * gap. Deployed alongside a delete-user-account that still purges by its own bucket
 * list, an uploader could delete their account and take quarantined material with
 * them. So this function is gated on three facts about the TARGET project, read
 * through the Management API (never assumed from the repo):
 *
 *   1. storage.buckets has `images-quarantine` and it is private   (20261008000000)
 *   2. moderation_actions carries quarantine_path + preserve_until (20261008000000)
 *   3. the DEPLOYED delete-user-account is a version that derives its purge list from
 *      _shared/storageBuckets.ts (the carve-out). The Management API cannot show us a
 *      deployed function's source, so the version at which the carve-out went live is
 *      recorded by the operator in scripts/edge-deploy-gate.json after that deploy, and
 *      this gate requires the deployed version to be at least that — AND that the local
 *      source still carries the marker, so the registry cannot claim what the code lost.
 *
 * Functions not listed in GATED_FUNCTIONS pass straight through (with --deploy they are
 * deployed as-is). Nothing here writes to the project: the only SQL is a SELECT and the
 * only mutation is the `supabase functions deploy` you asked for with --deploy.
 *
 * Env: SUPABASE_ACCESS_TOKEN (Management API), DC_SUPABASE_PROD_REF (default prod ref).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const REGISTRY_FILE = join(HERE, 'edge-deploy-gate.json');
const CARVE_OUT_MARKER = 'purgeableUserBuckets';

/** Function slug -> the facts it is gated on. Add here, and to evaluate(), together. */
export const GATED_FUNCTIONS = {
  'moderate-image': ['quarantine bucket is private', 'preservation clock columns exist', 'deployed delete-user-account carries the carve-out', 'auto_hold_image is an allowed moderation action (20261013000000)'],
  // A2 (20261013000000): moves held marketplace photos in or out of images-held.
  // Deployed before that bucket exists, every hold's move fails and the photo stays
  // at its public URL; refuse rather than ship a no-op that looks like a fix.
  'held-listing-images': ['images-held bucket is private (20261013000000)'],
};

/** The A2 facts: images-held exists and is private; the hold action is allowed. */
export function evaluateHeldGate(facts) {
  const reasons = [];
  if (facts.heldBucketPublic === null || facts.heldBucketPublic === undefined) {
    reasons.push('images-held bucket does not exist in the target project (apply 20261013000000 first)');
  } else if (facts.heldBucketPublic !== false) {
    reasons.push('images-held bucket exists but is PUBLIC; it must be private');
  }
  return { ok: reasons.length === 0, reasons };
}

/** Every gate a function is subject to, composed. */
export function evaluateGate(fn, facts) {
  const reasons = [];
  if (fn === 'moderate-image') {
    reasons.push(...evaluateModerateImageGate(facts).reasons);
    if (!facts.holdActionAllowed) {
      reasons.push("moderation_actions_action_check does not allow 'auto_hold_image' in the target project (apply 20261013000000 first)");
    }
  }
  if (fn === 'held-listing-images') reasons.push(...evaluateHeldGate(facts).reasons);
  return { ok: reasons.length === 0, reasons };
}

/**
 * Pure decision. `facts`:
 *   bucketPublic            true | false | null (null = bucket absent)
 *   clockColumns            number of the two moderation_actions columns present (0..2)
 *   localSourceHasCarveOut  boolean — the repo's delete-user-account imports the marker
 *   carveOutSinceVersion    number | null — from scripts/edge-deploy-gate.json
 *   deployedDeleteVersion   number | null — from the Management API (null = not deployed)
 */
export function evaluateModerateImageGate(facts) {
  const reasons = [];
  if (facts.bucketPublic === null || facts.bucketPublic === undefined) {
    reasons.push('images-quarantine bucket does not exist in the target project (apply 20261008000000 first)');
  } else if (facts.bucketPublic !== false) {
    reasons.push('images-quarantine bucket exists but is PUBLIC; it must be private');
  }
  if ((facts.clockColumns ?? 0) < 2) {
    reasons.push('moderation_actions.quarantine_path / preserve_until are missing in the target project (apply 20261008000000 first)');
  }
  if (!facts.localSourceHasCarveOut) {
    reasons.push(`the repo's delete-user-account no longer derives its purge list from _shared/storageBuckets.ts (marker "${CARVE_OUT_MARKER}" absent)`);
  }
  if (facts.carveOutSinceVersion === null || facts.carveOutSinceVersion === undefined) {
    reasons.push('scripts/edge-deploy-gate.json records no deployed version of delete-user-account that carries the carve-out — deploy delete-user-account first, then record its version there');
  } else if (facts.deployedDeleteVersion === null || facts.deployedDeleteVersion === undefined) {
    reasons.push('delete-user-account is not deployed in the target project');
  } else if (facts.deployedDeleteVersion < facts.carveOutSinceVersion) {
    reasons.push(`deployed delete-user-account is v${facts.deployedDeleteVersion}, before the carve-out (v${facts.carveOutSinceVersion})`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function readRegistry(file = REGISTRY_FILE) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}

async function mgmt(ref, token, path, init = {}) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function query(ref, token, sql) {
  if (!/^\s*select\b/i.test(sql)) throw new Error('edge-deploy-gate only ever runs SELECT');
  return mgmt(ref, token, '/database/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
}

export async function gatherModerateImageFacts(ref, token) {
  const bucketRows = await query(ref, token, "select public from storage.buckets where id = 'images-quarantine'");
  const bucketPublic = bucketRows.length ? bucketRows[0].public === true || bucketRows[0].public === 't' : null;
  const colRows = await query(ref, token,
    "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'moderation_actions' and column_name in ('quarantine_path', 'preserve_until')");
  const clockColumns = Number(colRows[0]?.n ?? 0);
  let deployedDeleteVersion = null;
  try {
    const fn = await mgmt(ref, token, '/functions/delete-user-account');
    deployedDeleteVersion = typeof fn.version === 'number' ? fn.version : null;
  } catch {
    deployedDeleteVersion = null;
  }
  let localSourceHasCarveOut = false;
  try {
    localSourceHasCarveOut = readFileSync(join(REPO, 'supabase/functions/delete-user-account/index.ts'), 'utf8').includes(CARVE_OUT_MARKER);
  } catch { /* absent file = no carve-out */ }
  const registry = readRegistry();
  const carveOutSinceVersion = registry?.['delete-user-account']?.carveOutSinceVersion ?? null;
  return { bucketPublic, clockColumns, localSourceHasCarveOut, carveOutSinceVersion, deployedDeleteVersion };
}

export async function gatherHeldFacts(ref, token) {
  const heldRows = await query(ref, token, "select public from storage.buckets where id = 'images-held'");
  const heldBucketPublic = heldRows.length ? heldRows[0].public === true || heldRows[0].public === 't' : null;
  const checkRows = await query(ref, token,
    "select count(*)::int as n from pg_constraint where conrelid = 'public.moderation_actions'::regclass and conname = 'moderation_actions_action_check' and pg_get_constraintdef(oid) like '%auto_hold_image%'");
  const holdActionAllowed = Number(checkRows[0]?.n ?? 0) === 1;
  return { heldBucketPublic, holdActionAllowed };
}

const INVOKED_DIRECTLY = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (INVOKED_DIRECTLY) await (async () => {
  const args = process.argv.slice(2);
  const fn = args.find((a) => !a.startsWith('--'));
  const deploy = args.includes('--deploy');
  const refIdx = args.indexOf('--project-ref');
  const ref = refIdx >= 0 ? args[refIdx + 1] : (process.env.DC_SUPABASE_PROD_REF || 'abcdefghijklmnopqrst');
  if (!fn) {
    console.error('usage: node scripts/edge-deploy-gate.mjs <function-slug> [--deploy] [--project-ref REF]');
    process.exit(2);
  }
  const doDeploy = () => {
    console.log(`▸ supabase functions deploy ${fn} --project-ref ${ref}`);
    execSync(`npx supabase functions deploy ${fn} --project-ref ${ref}`, { stdio: 'inherit', cwd: REPO });
  };
  if (!GATED_FUNCTIONS[fn]) {
    console.log(`· ${fn} has no deploy gate.`);
    if (deploy) doDeploy();
    process.exit(0);
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error('✗ SUPABASE_ACCESS_TOKEN is not set; the gate cannot read the target project and will not deploy on a guess.');
    process.exit(1);
  }
  const facts = {
    ...(fn === 'moderate-image' ? await gatherModerateImageFacts(ref, token) : {}),
    ...(await gatherHeldFacts(ref, token)),
  };
  const verdict = evaluateGate(fn, facts);
  console.log(`edge-deploy-gate  ${fn}  →  project ${ref}`);
  for (const f of GATED_FUNCTIONS[fn]) console.log(`  · requires: ${f}`);
  console.log(`  facts: ${JSON.stringify(facts)}`);
  if (!verdict.ok) {
    console.error(`✗ REFUSED to deploy ${fn}:`);
    for (const r of verdict.reasons) console.error(`  - ${r}`);
    process.exit(1);
  }
  console.log(`✓ ${fn} may be deployed to ${ref}.`);
  if (deploy) doDeploy();
  process.exit(0);
})();
