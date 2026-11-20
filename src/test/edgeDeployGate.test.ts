/**
 * scripts/edge-deploy-gate.mjs — the decision that keeps moderate-image undeployable
 * until the quarantine bucket, its clock, and the account-deletion carve-out are all
 * live in the target project (BA-07, docs/audits/backend-audit-2026-09-06.md).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateGate, evaluateModerateImageGate, GATED_FUNCTIONS } from '../../scripts/edge-deploy-gate.mjs';

const ready = {
  bucketPublic: false,
  clockColumns: 2,
  localSourceHasCarveOut: true,
  carveOutSinceVersion: 24,
  deployedDeleteVersion: 24,
};

describe('evaluateModerateImageGate', () => {
  it('lists moderate-image as gated', () => {
    expect(Object.keys(GATED_FUNCTIONS)).toContain('moderate-image');
  });
  it('passes only when every precondition is live', () => {
    expect(evaluateModerateImageGate(ready)).toEqual({ ok: true, reasons: [] });
    expect(evaluateModerateImageGate({ ...ready, deployedDeleteVersion: 30 }).ok).toBe(true);
  });
  it('refuses when the bucket is absent or public', () => {
    expect(evaluateModerateImageGate({ ...ready, bucketPublic: null }).reasons.join()).toMatch(/does not exist/);
    expect(evaluateModerateImageGate({ ...ready, bucketPublic: true }).reasons.join()).toMatch(/PUBLIC/);
  });
  it('refuses when the preservation clock columns are missing', () => {
    expect(evaluateModerateImageGate({ ...ready, clockColumns: 1 }).reasons.join()).toMatch(/preserve_until/);
  });
  it('refuses when the carve-out is not recorded, not deployed, or older than recorded', () => {
    expect(evaluateModerateImageGate({ ...ready, carveOutSinceVersion: null }).reasons.join()).toMatch(/records no deployed version/);
    expect(evaluateModerateImageGate({ ...ready, deployedDeleteVersion: null }).reasons.join()).toMatch(/not deployed/);
    expect(evaluateModerateImageGate({ ...ready, deployedDeleteVersion: 23 }).reasons.join()).toMatch(/v23, before the carve-out \(v24\)/);
  });
  it('refuses when the repo source lost the carve-out, even if the registry claims it', () => {
    expect(evaluateModerateImageGate({ ...ready, localSourceHasCarveOut: false }).reasons.join()).toMatch(/purgeableUserBuckets/);
  });
  it('accumulates every reason rather than stopping at the first', () => {
    const v = evaluateModerateImageGate({ bucketPublic: null, clockColumns: 0, localSourceHasCarveOut: false, carveOutSinceVersion: null, deployedDeleteVersion: null });
    expect(v.ok).toBe(false);
    expect(v.reasons).toHaveLength(4);
  });
});

describe('send-push mutation harness', () => {
  const runner = fs.readFileSync(path.resolve(process.cwd(), 'scripts/test-edge-push.sh'), 'utf8');

  it('proves bearer rejection before driving the expensive scoping mutation', () => {
    const preflight = runner.indexOf('mutation auth preflight');
    const probe = runner.indexOf('node scripts/edge-probe/send-push.probe.mjs');
    expect(preflight).toBeGreaterThan(-1);
    expect(probe).toBeGreaterThan(preflight);
    expect(runner).toContain('NO_AUTH_CODE');
    expect(runner).toContain('WRONG_AUTH_CODE');
    expect(runner).toContain('ANON_AUTH_CODE');
  });

  it('does not reclassify a caught scope mutation from a later auth timeout', () => {
    expect(runner).not.toContain('MUTATION reddened the auth verdicts too');
    expect(runner).toContain('after the bearer gate passed its isolated preflight');
  });
});

describe('evaluateGate (A2, 20261013000000)', () => {
  const a2 = { ...ready, heldBucketPublic: false, holdActionAllowed: true };
  it('gates held-listing-images on images-held', () => {
    expect(Object.keys(GATED_FUNCTIONS)).toEqual(
      expect.arrayContaining(['moderate-image', 'held-listing-images']),
    );
    for (const fn of ['held-listing-images']) {
      expect(evaluateGate(fn, a2)).toEqual({ ok: true, reasons: [] });
      expect(evaluateGate(fn, { ...a2, heldBucketPublic: null }).reasons.join()).toMatch(/images-held bucket does not exist/);
      expect(evaluateGate(fn, { ...a2, heldBucketPublic: true }).reasons.join()).toMatch(/PUBLIC/);
    }
  });
  it('refuses moderate-image until auto_hold_image is an allowed action', () => {
    expect(evaluateGate('moderate-image', a2)).toEqual({ ok: true, reasons: [] });
    expect(evaluateGate('moderate-image', { ...a2, holdActionAllowed: false }).reasons.join()).toMatch(/auto_hold_image/);
    expect(evaluateGate('moderate-image', { ...a2, bucketPublic: null }).ok).toBe(false);
  });
  it('lets an ungated function through', () => {
    expect(evaluateGate('send-push', {})).toEqual({ ok: true, reasons: [] });
  });
});
