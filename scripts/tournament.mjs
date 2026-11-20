#!/usr/bin/env node
/**
 * Design tournament — one selection round over the landing variants.
 *
 *   npm run tourney -- --round 1 --dimension "density rhythm"
 *   npm run tourney -- --round 2 --dimension hierarchy \
 *       --parents crescendo,steady --variants spine,ladder,inverted,anchor
 *
 * A round: capture every named variant with the EXISTING screenshot sweep
 * (spawned, never forked — its output layout is a contract with Command
 * Center's Taste tab), then write `round.json` next to the sweep's manifest:
 *
 *   .screenshots/<timestamp>/round.json
 *   { round, dimension, parents, rubric, variants:
 *       [{ name, dimension, files, score, notes }] }
 *
 * `score`/`notes` are written as null/"" — the critique pass fills them in
 * against docs/taste-rubric.md. This script renders and records; it has no
 * opinion. Culling and breeding live with the caller (the dc-taste-tournament
 * skill), because generation is model work, not script work.
 *
 * LOCAL STACK ONLY, inherited from the sweep: it refuses to run unless
 * .env.e2e points at 127.0.0.1, so a tournament can never screenshot prod.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(ROOT, '.screenshots');
const REGISTRY = path.join(ROOT, 'src/components/marketing/landing/variants/index.ts');
const RUBRIC = path.join(ROOT, 'docs/taste-rubric.md');

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { round: null, dimension: null, parents: [], variants: null, label: '' };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    if (argv[i] === '--round') out.round = Number(next());
    else if (argv[i] === '--dimension') out.dimension = next();
    else if (argv[i] === '--parents') out.parents = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === '--variants') out.variants = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === '--label') out.label = next();
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(
        'usage: npm run tourney -- --round <n> --dimension <name> [--parents a,b] [--variants a,b,c,d] [--label <name>]',
      );
      process.exit(0);
    }
  }
  if (!Number.isInteger(out.round) || out.round < 1) fail('--round <positive integer> is required.');
  if (!out.dimension) fail('--dimension <name> is required.');
  return out;
}

/** Variant ids as the registry declares them — the ONLY source of truth for what renders. */
function registryIds() {
  const src = readFileSync(REGISTRY, 'utf8');
  return [...src.matchAll(/^\s*id:\s*"([^"]+)"/gm)].map((m) => m[1]);
}

/** The rubric's version line, embedded in round.json so a re-read of an old round knows which contract scored it. */
function rubricVersion() {
  const m = readFileSync(RUBRIC, 'utf8').match(/\*\*Version ([^*]+)\*\*/);
  return m ? `taste-rubric ${m[1].trim()}` : 'taste-rubric (unversioned)';
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const known = registryIds();
  const variants = args.variants ?? known;
  const unknown = variants.filter((v) => !known.includes(v));
  if (unknown.length) fail(`not in the variants registry: ${unknown.join(', ')} (known: ${known.join(', ')})`);
  const missingParents = args.parents.filter((p) => !known.includes(p));
  if (missingParents.length) fail(`--parents not in the registry: ${missingParents.join(', ')}`);

  const label = args.label || `round-${args.round}-${args.dimension.replace(/\s+/g, '-')}`;
  const routes = variants.map((v) => `/__variants/${v}`).join(',');

  console.log(`\n🏆 Tournament round ${args.round} — dimension: ${args.dimension}`);
  console.log(`   variants: ${variants.join(', ')}`);
  if (args.parents.length) console.log(`   parents:  ${args.parents.join(', ')}`);

  const before = new Set(existsSync(SHOTS_DIR) ? readdirSync(SHOTS_DIR) : []);
  const sweep = spawnSync(
    'node',
    [path.join(ROOT, 'scripts/screenshot-sweep.mjs'), '--routes', routes, '--label', label],
    { cwd: ROOT, stdio: 'inherit' },
  );

  // The sweep exits 1 when any single capture failed but still writes its
  // manifest; only a missing manifest is fatal here.
  const after = readdirSync(SHOTS_DIR).filter((d) => !before.has(d)).sort();
  const runDir = after.at(-1);
  if (!runDir) fail('sweep produced no output directory.');
  const manifestPath = path.join(SHOTS_DIR, runDir, 'manifest.json');
  if (!existsSync(manifestPath)) fail(`sweep wrote no manifest in .screenshots/${runDir}.`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const byRoute = new Map(manifest.routes.map((r) => [r.route, r.files]));
  const round = {
    round: args.round,
    dimension: args.dimension,
    parents: args.parents,
    rubric: rubricVersion(),
    sweep: `.screenshots/${runDir}`,
    variants: variants.map((name) => ({
      name,
      dimension: args.dimension,
      files: byRoute.get(`/__variants/${name}`) ?? null,
      score: null,
      notes: '',
    })),
  };

  const uncaptured = round.variants.filter((v) => !v.files).map((v) => v.name);
  const outPath = path.join(SHOTS_DIR, runDir, 'round.json');
  writeFileSync(outPath, JSON.stringify(round, null, 2));

  console.log(`\n📋 round.json → .screenshots/${runDir}/round.json`);
  if (uncaptured.length) {
    console.error(`✗ uncaptured variants (files: null): ${uncaptured.join(', ')} — re-run before scoring.`);
    process.exit(1);
  }
  process.exit(sweep.status ?? 0);
}

main();
