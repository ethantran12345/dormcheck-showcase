#!/usr/bin/env node
/**
 * agent:new — ONE command to start an extra agent safely.
 *
 *   npm run agent:new -- <name> --owns "<globs>"
 *
 * WHY (2026-08-05). Extra agents get started by opening a new Herd tab and running Claude
 * in the repo root. Every tab then shares ONE working tree, and on 2026-08-05 four
 * of them did exactly that: the `[auto]` wip Stop hook swept work between sessions into
 * d06ca641 and 90d2a704, two commits nobody authored, each carrying two sessions' work.
 *
 * The lane system already prevents this completely and was simply never invoked, because
 * `lane:start` is one more thing to know and the handoffs said "commit on dev, no branch".
 * So the gap was never protection — it was that nothing MADE the safe path happen. This
 * command is the safe path with nothing to remember: it starts the lane AND prints, in a
 * box you cannot miss, the exact `cd` line to paste into the new tab BEFORE starting
 * Claude there. Paste it and the second agent is physically isolated: its own worktree,
 * its own branch, its own index.
 *
 * It is a thin wrapper on `lane:start` on purpose — every rule (ownership conflicts,
 * overdue lanes, dirty-overlap refusal, the lane contract) stays in scripts/lane.mjs, one
 * implementation. Extra flags (`--allow-broad "<reason>"`) pass straight through.
 *
 * `--owns` is REQUIRED and we never guess one. A guessed scope is worse than no lane: it
 * reads as protection while owning the wrong paths, which is how a lane ends up owning
 * nothing at all (see expandOwns in scripts/lib/lanes.mjs for two shipped instances).
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLanes } from './lib/lanes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
// Same positional rule lane.mjs uses: a bare token is the NAME only if it is not the value
// of a preceding flag, so `--owns "src/**" my-lane` parses the way it reads.
const nameIdx = argv.findIndex((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const name = nameIdx >= 0 ? argv[nameIdx].trim() : '';
const ownsIdx = argv.indexOf('--owns');
const owns = ownsIdx >= 0 ? argv[ownsIdx + 1] : null;

function usage(problem) {
  console.error(`✗ ${problem}`);
  console.error('');
  console.error('  usage:  npm run agent:new -- <name> --owns "<globs>"');
  console.error('');
  console.error('  example:');
  console.error('    npm run agent:new -- marketplace-filters \\');
  console.error('      --owns "src/components/marketplace/**,src/pages/Marketplace*"');
  console.error('');
  console.error('  <name>   kebab-case, names the lane, the branch and the worktree directory.');
  console.error('  --owns   the globs THIS agent may edit. Comma- or space-separated. Required:');
  console.error('           a guessed scope looks like protection while owning the wrong paths.');
  console.error('');
  console.error('  Then paste the printed `cd` line into the NEW tab BEFORE you start Claude there.');
  process.exit(1);
}

if (!name) usage('no lane name given.');
if (!owns || owns.startsWith('--')) usage('--owns is required, and I will not guess it.');

// Delegate every rule to lane:start — this wrapper adds the handoff, not the policy.
const passthrough = argv.filter((_, i) => i !== nameIdx && i !== ownsIdx && i !== ownsIdx + 1);
const started = spawnSync('node', [resolve(root, 'scripts/lane.mjs'), 'start', name, '--owns', owns, ...passthrough], {
  cwd: root, stdio: 'inherit',
});
if (started.status !== 0) process.exit(started.status ?? 1);

const lane = readLanes().find((l) => l.name === name);
if (!lane) {
  // lane:start reported success but the registry has no row — say so rather than print a
  // confident `cd` into a path we did not verify.
  console.error(`⚠️  lane "${name}" started but is not in the registry — run \`npm run lane:status\` and cd there by hand.`);
  process.exit(1);
}

const line = `cd ${lane.worktree}`;
const width = Math.max(line.length, 62) + 4;
const bar = (l, r, fill) => l + fill.repeat(width) + r;
const row = (text = '') => `║ ${text}${' '.repeat(Math.max(0, width - text.length - 2))} ║`;

console.log('');
console.log(bar('╔', '╗', '═'));
console.log(row(`AGENT "${name}" IS READY — DO THIS IN THE NEW TAB FIRST`));
console.log(bar('╠', '╣', '═'));
console.log(row(''));
console.log(row(`  ${line}`));
console.log(row(''));
console.log(row('  …THEN start Claude in that tab. Starting it here instead puts two'));
console.log(row('  agents in one working tree, which is the thing this prevents.'));
console.log(row(''));
console.log(bar('╚', '╝', '═'));
console.log('');
console.log(`  This agent owns:  ${(lane.owns || []).join(', ')}`);
console.log('  When it is done, from that tab:  npm run lane:ship');
console.log('  Guide: docs/dev-loop.md § "Running a second agent (a new Herd tab)"');
console.log('');
