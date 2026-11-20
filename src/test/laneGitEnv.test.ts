/**
 * The lane reaper must not inherit git's plumbing environment into another worktree
 * (BA-31, docs/audits/backend-audit-2026-09-06.md).
 *
 * On 2026-09-06 `git commit -- <paths>` ran its pre-commit hook with GIT_INDEX_FILE set
 * to the partial commit's TEMPORARY index; the hook reaped a parked lane, whose salvage
 * `git add -A` (cwd = the lane worktree) inherited that variable and rewrote the parent's
 * temp index with the lane's tree. The parent commit landed with the lane's file under
 * the parent's message (f5d09dab). gitEnvFor() is the fix: any git call that names a cwd
 * gets an env with the plumbing variables stripped.
 */
import { describe, it, expect } from 'vitest';
import { gitEnvFor } from '../../scripts/lib/lanes.mjs';

const base = {
  PATH: '/usr/bin',
  HOME: '/Users/probe',
  GIT_AUTHOR_NAME: 'Probe',
  GIT_INDEX_FILE: '/repo/.git/index.lock.tmp',
  GIT_DIR: '/repo/.git',
  GIT_WORK_TREE: '/repo',
  GIT_PREFIX: 'docs/',
  GIT_COMMON_DIR: '/repo/.git',
  GIT_OBJECT_DIRECTORY: '/repo/.git/objects',
  GIT_QUARANTINE_PATH: '/repo/.git/objects/incoming',
};

describe('gitEnvFor', () => {
  it('strips every git plumbing variable when the call names another worktree', () => {
    const env = gitEnvFor({ cwd: '/Users/probe/dc-lanes/x' }, base) as Record<string, string>;
    for (const k of ['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_QUARANTINE_PATH']) {
      expect(env).not.toHaveProperty(k);
    }
  });
  it('keeps everything that is not plumbing', () => {
    const env = gitEnvFor({ cwd: '/Users/probe/dc-lanes/x' }, base) as Record<string, string>;
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/Users/probe');
    expect(env.GIT_AUTHOR_NAME).toBe('Probe');
  });
  it('leaves the environment untouched for a call in the current worktree', () => {
    expect(gitEnvFor({}, base)).toBe(base);
  });
  it('defers to an explicit env when the caller supplies one', () => {
    const custom = { PATH: '/x' };
    expect(gitEnvFor({ cwd: '/elsewhere', env: custom }, base)).toBe(custom);
  });
  it('does not mutate the base environment', () => {
    gitEnvFor({ cwd: '/elsewhere' }, base);
    expect(base.GIT_INDEX_FILE).toBe('/repo/.git/index.lock.tmp');
  });
});
