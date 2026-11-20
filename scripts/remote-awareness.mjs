#!/usr/bin/env node
/**
 * Read-only remote awareness for long-lived, cross-machine sessions.
 * Fetches origin and reports dev/main movement; never pulls, merges, or rebases.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const mode = args[0] === 'watch' ? 'watch' : 'check';
const quiet = args.includes('--quiet');
const repoIndex = args.indexOf('--repo');
if (repoIndex >= 0) {
  const repo = args[repoIndex + 1];
  if (!repo) throw new Error('--repo requires an absolute or relative repository path.');
  process.chdir(resolve(repo));
}
const intervalIndex = args.indexOf('--interval');
const requestedSeconds = intervalIndex >= 0 ? Number(args[intervalIndex + 1]) : 30;
const intervalSeconds = Number.isFinite(requestedSeconds)
  ? Math.max(10, Math.min(3600, requestedSeconds))
  : 30;

function git(argv, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', argv, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (allowFailure) return '';
    throw new Error(error.stderr?.toString().trim() || error.message);
  }
}

const ref = (name) => git(['rev-parse', '-q', '--verify', name], { allowFailure: true });
const short = (sha) => sha ? sha.slice(0, 8) : 'missing';
const snapshot = () => ({ dev: ref('origin/dev'), main: ref('origin/main') });

function relationship() {
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true }) || '(detached)';
  const head = ref('HEAD');
  const dev = ref('origin/dev');
  if (!head || !dev) return { branch, ahead: '?', behind: '?' };
  const counts = git(['rev-list', '--left-right', '--count', `${head}...${dev}`], { allowFailure: true });
  const [ahead = '?', behind = '?'] = counts.split(/\s+/);
  return { branch, ahead, behind };
}

function describeMovement(label, before, after) {
  if (before === after) return '';
  if (!before) return `REMOTE ${label} discovered at ${short(after)}`;
  if (!after) return `WARNING: origin/${label} disappeared after fetch (was ${short(before)})`;
  const mergeBase = git(['merge-base', before, after], { allowFailure: true });
  if (mergeBase === before) {
    const count = git(['rev-list', '--count', `${before}..${after}`], { allowFailure: true }) || '?';
    return `REMOTE ${label} advanced ${count} commit(s): ${short(before)} -> ${short(after)}`;
  }
  return `WARNING: origin/${label} changed non-fast-forward: ${short(before)} -> ${short(after)}`;
}

function check(previous = snapshot()) {
  try {
    git(['fetch', 'origin', '--quiet']);
  } catch (error) {
    // stdout is intentional: session-begin captures child stdout and suppresses
    // stderr, so an offline startup still surfaces that its refs may be stale.
    console.log(`WARNING: remote check could not fetch origin: ${error.message}`);
    return { snapshot: previous, ok: false };
  }

  const current = snapshot();
  const changes = [
    describeMovement('dev', previous.dev, current.dev),
    describeMovement('main', previous.main, current.main),
  ].filter(Boolean);
  for (const line of changes) console.log(line);

  const rel = relationship();
  if (!quiet || changes.length) {
    console.log(
      `REMOTE current: dev ${short(current.dev)} | main ${short(current.main)} | `
      + `${rel.branch} is ${rel.ahead} ahead / ${rel.behind} behind origin/dev`,
    );
  }
  return { snapshot: current, ok: true };
}

let state = check();
if (mode === 'watch') {
  console.log(`REMOTE watching origin/dev and origin/main every ${intervalSeconds}s (Ctrl+C to stop; no pulls or merges).`);
  const timer = setInterval(() => { state = check(state.snapshot); }, intervalSeconds * 1000);
  const stop = () => {
    clearInterval(timer);
    process.stdin.pause();
  };
  process.stdin.resume();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (!state.ok && mode === 'check') process.exitCode = 1;
