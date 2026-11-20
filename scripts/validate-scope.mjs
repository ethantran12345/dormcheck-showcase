#!/usr/bin/env node
/** Proportional local validation. Shipment still runs the full lane gate. */
import { execFileSync, spawnSync } from 'node:child_process';

const run = process.argv.includes('--run');
const git = (...args) => {
  try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return ''; }
};
const gitRaw = (...args) => {
  try { return execFileSync('git', args, { encoding: 'utf8' }); } catch { return ''; }
};
const base = git('merge-base', 'origin/dev', 'HEAD') || 'HEAD';
const committed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
const statusFields = gitRaw('status', '--porcelain=v1', '-z').split('\0').filter(Boolean);
const dirty = [];
for (let index = 0; index < statusFields.length; index += 1) {
  const field = statusFields[index];
  const status = field.slice(0, 2);
  dirty.push(field.slice(3));
  if (status.includes('R') || status.includes('C')) index += 1;
}
const files = [...new Set([...committed, ...dirty])];

const docsOnly = files.length > 0 && files.every((f) => /^(docs\/|.*\.md$)/.test(f));
const workflow = files.some((f) => /^(scripts\/(session-begin|agent-lock|lane|wrap|validate-scope)|scripts\/lib\/(agent-registry|lanes)|src\/test\/(agent|lane|session))/.test(f));
const source = files.filter((f) => /^(src|api)\/.*\.(ts|tsx)$/.test(f));
const backend = files.some((f) => /^(supabase\/|api\/)/.test(f));

const plan = [];
if (!files.length) plan.push({ label: 'clean tree', cmd: ['git', ['status', '--short']] });
if (docsOnly) plan.push({ label: 'documentation contracts', cmd: ['npm', ['run', 'docs:check']] });
if (workflow) {
  plan.push({ label: 'workflow regressions', cmd: ['npx', ['vitest', 'run',
    'src/test/agentConcurrencyGuard.test.ts', 'src/test/laneLiveness.test.ts',
    'src/test/laneRegistryCleanup.test.ts', 'src/test/sessionLifecycle.test.ts']] });
  plan.push({ label: 'workflow typecheck', cmd: ['npm', ['run', 'typecheck:crash']] });
}
if (source.length && !workflow) {
  plan.push({ label: 'related tests', cmd: ['npx', ['vitest', 'related', ...source, '--run']] });
  plan.push({ label: 'changed-file lint', cmd: ['npx', ['eslint', ...source]] });
  plan.push({ label: 'typecheck', cmd: ['npm', ['run', 'typecheck:crash']] });
}
if (backend) plan.push({ label: 'backend safety tests', cmd: ['npm', ['run', 'test:db']] });
if (files.some((f) => f === 'CLAUDE.md' || f === 'AGENTS.md')) {
  plan.push({ label: 'prompt budget', cmd: ['npm', ['run', 'check:claude-md']] });
  plan.push({ label: 'generated agent instructions', cmd: ['npm', ['run', 'docs:check']] });
}

console.log(`VALIDATE SCOPE — ${files.length} changed file(s), ${plan.length} check(s)`);
for (const f of files) console.log(`  · ${f}`);
for (const { label, cmd: [bin, args] } of plan) console.log(`  ${run ? '▶' : '→'} ${label}: ${bin} ${args.join(' ')}`);
if (!run) {
  console.log('\nPreview only. Run: npm run validate:scope -- --run');
  process.exit(0);
}
for (const { label, cmd: [bin, args] } of plan) {
  const result = spawnSync(bin, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.error(`✗ ${label} failed (${result.status ?? 'no exit code'}).`);
    process.exit(result.status || 1);
  }
}
console.log('✓ proportional validation passed. lane:ship will still run the full gate.');
