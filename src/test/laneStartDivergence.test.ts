import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const LANE = resolve('scripts/lane.mjs');

if (process.platform === 'win32') vi.setConfig({ testTimeout: 20_000 });

function sh(cmd: string, cwd: string) {
  const result = spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${cmd}\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function startLane(repo: string, name: string) {
  return spawnSync('node', [LANE, 'start', name, '--owns', 'src/feature.ts'], {
    cwd: repo,
    encoding: 'utf8',
    env: process.env,
  });
}

let root: string;
let remote: string;
let repo: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'lane-start-divergence-')));
  remote = join(root, 'remote.git');
  repo = join(root, 'repo');
  mkdirSync(repo);
  sh(`git init -q --bare "${remote}"`, root);
  sh('git init -q -b dev && git config user.email t@t.com && git config user.name t', repo);
  mkdirSync(join(repo, 'src'));
  mkdirSync(join(repo, 'docs/handoffs'), { recursive: true });
  writeFileSync(join(repo, 'src/seed.ts'), 'export const seed = true;\n');
  writeFileSync(join(repo, 'docs/handoffs/.gitkeep'), '');
  sh('git add src/seed.ts docs/handoffs/.gitkeep && git commit -qm seed', repo);
  sh(`git remote add origin "${remote}" && git push -q -u origin dev`, repo);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('lane:start isolates before synchronizing main', () => {
  it('starts from local dev when it is only ahead, without pushing or changing main', () => {
    writeFileSync(join(repo, 'local.txt'), 'local context\n');
    sh('git add local.txt && git commit -qm local', repo);
    const localDev = sh('git rev-parse dev', repo);

    const result = startLane(repo, 'ahead-safe');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('starting from dev');
    expect(sh('git rev-parse lane/ahead-safe', repo)).toBe(localDev);
    expect(sh('git rev-parse dev', repo)).toBe(localDev);
    expect(sh('git rev-parse origin/dev', repo)).not.toBe(localDev);
  });

  it('starts a diverged checkout from origin/dev and leaves local-only work untouched', () => {
    writeFileSync(join(repo, 'local.txt'), 'local only\n');
    sh('git add local.txt && git commit -qm local', repo);
    const localDev = sh('git rev-parse dev', repo);

    const peer = join(root, 'peer');
    sh(`git clone -q --branch dev "${remote}" "${peer}"`, root);
    sh('git config user.email t@t.com && git config user.name t', peer);
    writeFileSync(join(peer, 'remote.txt'), 'remote only\n');
    sh('git add remote.txt && git commit -qm remote && git push -q origin dev', peer);
    sh('git fetch -q origin', repo);
    const originDev = sh('git rev-parse origin/dev', repo);

    // Unrelated main dirt is preserved too. A new agent may still isolate itself as
    // long as that dirt does not overlap its declared ownership.
    writeFileSync(join(repo, 'notes.txt'), 'someone else is editing this\n');
    const result = startLane(repo, 'diverged-safe');

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('diverged from origin/dev');
    expect(result.stdout).toContain('without modifying main');
    expect(sh('git rev-parse lane/diverged-safe', repo)).toBe(originDev);
    expect(sh('git rev-parse dev', repo)).toBe(localDev);
    expect(readFileSync(join(repo, 'notes.txt'), 'utf8')).toBe('someone else is editing this\n');
  }, process.platform === "win32" ? 20_000 : 5_000);
});
