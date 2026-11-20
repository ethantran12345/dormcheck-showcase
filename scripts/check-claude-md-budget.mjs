#!/usr/bin/env node
/**
 * CLAUDE.md byte-budget gate.
 *
 * CLAUDE.md loads into every turn's context, so its size is a recurring token tax.
 * This script is the SINGLE source of truth for the cap — the vault's `vault-lint.mjs`
 * TIER 3 check only sees this repo when it happens to be mounted in a Cowork session,
 * so the pre-push hook (which calls this) is the real gate.
 *
 * Usage: node scripts/check-claude-md-budget.mjs   (npm run check:claude-md)
 * Exits 1 when over budget.
 */
import { statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** The cap. Do not raise it — route content to docs/ or .claude/rules/ instead. */
export const CLAUDE_MD_MAX_BYTES = 16000;

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const file = join(root, 'CLAUDE.md');
const bytes = statSync(file).size;

if (bytes > CLAUDE_MD_MAX_BYTES) {
  const over = bytes - CLAUDE_MD_MAX_BYTES;
  console.error('');
  console.error('Push blocked: CLAUDE.md is over its context budget.');
  console.error(`  current: ${bytes} bytes`);
  console.error(`  cap:     ${CLAUDE_MD_MAX_BYTES} bytes`);
  console.error(`  over by: ${over} bytes`);
  console.error('');
  console.error('route content to docs/ or .claude/rules/ — do not raise the cap.');
  console.error('');
  process.exit(1);
}

console.log(`CLAUDE.md budget: ${bytes}/${CLAUDE_MD_MAX_BYTES} bytes (${CLAUDE_MD_MAX_BYTES - bytes} to spare).`);
