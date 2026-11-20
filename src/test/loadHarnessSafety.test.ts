import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, isProductionHost, validateLimits, validateTarget } from '../../scripts/load/policy.mjs';
import { percentile, summarize } from '../../scripts/load/stats.mjs';

describe('load harness safety policy', () => {
  it.each([
    'https://dormcheck.com',
    'https://www.dormcheck.com',
    'https://preview.dormcheck.com',
    'https://abcdefghijklmnopqrst.supabase.co',
  ])('always refuses production target %s', (url) => {
    expect(() => validateTarget(url, { LOAD_TEST_ACK: 'staging', LOAD_TEST_ALLOW_HOSTS: new URL(url).hostname })).toThrow(/Production load testing is forbidden/);
  });

  it('allows local targets without an acknowledgement', () => {
    expect(validateTarget('http://127.0.0.1:8123', {}).origin).toBe('http://127.0.0.1:8123');
  });

  it('requires both staging acknowledgement and exact host allowlist', () => {
    expect(() => validateTarget('https://staging.example.test', {})).toThrow(/LOAD_TEST_ACK/);
    expect(() => validateTarget('https://staging.example.test', { LOAD_TEST_ACK: 'staging' })).toThrow(/allowlisted/);
    expect(validateTarget('https://staging.example.test', {
      LOAD_TEST_ACK: 'staging',
      LOAD_TEST_ALLOW_HOSTS: 'staging.example.test',
    }).hostname).toBe('staging.example.test');
  });

  it('enforces bounded defaults and ceilings', () => {
    expect(validateLimits({})).toMatchObject({
      virtualUsers: DEFAULT_LIMITS.virtualUsers,
      durationSeconds: DEFAULT_LIMITS.durationSeconds,
    });
    expect(() => validateLimits({ virtualUsers: 101 })).toThrow(/safety ceiling/);
    expect(() => validateLimits({ durationSeconds: 301 })).toThrow(/safety ceiling/);
  });

  it('recognizes protected hostnames independently', () => {
    expect(isProductionHost('dormcheck.com')).toBe(true);
    expect(isProductionHost('foo.dormcheck.com')).toBe(true);
    expect(isProductionHost('staging.example.test')).toBe(false);
  });
});

describe('load harness statistics', () => {
  it('computes stable nearest-rank percentiles and error rate', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBe(5);
    expect(summarize([
      { ok: true, status: 200, ms: 10 },
      { ok: true, status: 200, ms: 20 },
      { ok: false, status: 500, ms: 30 },
    ], 0, 1_000)).toMatchObject({
      requests: 3,
      failed: 1,
      errorRate: 1 / 3,
      requestsPerSecond: 3,
      latencyMs: { median: 20, p95: 30, p99: 30 },
      statusCounts: { 200: 2, 500: 1 },
    });
  });
});
