/**
 * Orphaned-image sweeper (A2, 20261013000000). The sweeper DELETES, so the pins
 * here are about what it can never do: touch images-quarantine or images-held,
 * delete in dry-run mode, or exceed 500 per run. The SQL side of the same
 * refusals is asserted in supabase/tests/storage_cleanup.test.sql.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  NEVER_SWEPT,
  SWEEP_BUCKETS,
  SWEEP_CUTOFF_HOURS,
  SWEEP_MAX_PER_RUN,
  assertSweepable,
  runStorageSweep,
  sweepModeFromEnv,
  type SweepClient,
} from '../../api/_lib/storageSweep';
import { SWEEPABLE_BUCKETS, PRESERVED_BUCKETS } from '../../supabase/functions/_shared/storageBuckets';

function fakeClient(namesPerBucket: Record<string, string[]>) {
  const rpcCalls: { p_bucket: string; p_created_before: string; p_limit: number }[] = [];
  const removed: Record<string, string[]> = {};
  const client: SweepClient = {
    rpc: vi.fn(async (_fn, args) => {
      rpcCalls.push(args);
      const names = (namesPerBucket[args.p_bucket] ?? []).slice(0, args.p_limit);
      return { data: names.map((name) => ({ name })), error: null };
    }),
    storage: {
      from: (bucket: string) => ({
        remove: vi.fn(async (paths: string[]) => {
          removed[bucket] = [...(removed[bucket] ?? []), ...paths];
          return { data: paths.map((name) => ({ name })), error: null };
        }),
      }),
    },
  };
  return { client, rpcCalls, removed };
}

describe('bucket lists', () => {
  it('mirrors the shared registry and never lists a preserved bucket', () => {
    expect([...SWEEP_BUCKETS]).toEqual([...SWEEPABLE_BUCKETS]);
    expect([...NEVER_SWEPT]).toEqual([...PRESERVED_BUCKETS]);
    for (const b of NEVER_SWEPT) expect(SWEEP_BUCKETS as readonly string[]).not.toContain(b);
  });
  it("matches the SQL function's allowlist exactly", () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/migrations/20261013000000_storage_cleanup.sql'),
      'utf8',
    );
    const allow = /p_bucket NOT IN \(([\s\S]*?)\)/.exec(sql)?.[1] ?? '';
    const names = [...allow.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
    expect(names).toEqual([...SWEEP_BUCKETS].sort());
    expect(sql).toMatch(/IF p_bucket IN \('images-quarantine', 'images-held'\) THEN/);
  });
});

describe('assertSweepable', () => {
  it('refuses images-quarantine and images-held by name', () => {
    expect(() => assertSweepable('images-quarantine')).toThrow(/preserved/);
    expect(() => assertSweepable('images-held')).toThrow(/preserved/);
  });
  it('refuses any bucket that is not a public upload bucket', () => {
    expect(() => assertSweepable('templates')).toThrow(/not a sweepable/);
    expect(() => assertSweepable('dm-audio')).toThrow(/not a sweepable/);
  });
});

describe('sweepModeFromEnv', () => {
  it('is a dry run unless the value is exactly "delete"', () => {
    expect(sweepModeFromEnv(undefined)).toBe('dry-run');
    expect(sweepModeFromEnv('')).toBe('dry-run');
    expect(sweepModeFromEnv('true')).toBe('dry-run');
    expect(sweepModeFromEnv('DELETE')).toBe('dry-run');
    expect(sweepModeFromEnv(' delete ')).toBe('delete');
  });
});

describe('runStorageSweep', () => {
  const now = new Date('2026-10-12T09:00:00.000Z');

  it('a dry run reports counts and never calls remove', async () => {
    const { client, removed } = fakeClient({ avatars: ['u/a.jpg', 'u/b.jpg'], 'dm-photos': ['u/c.jpg'] });
    const report = await runStorageSweep(client, { mode: 'dry-run', now });
    expect(report.totalCandidates).toBe(3);
    expect(report.totalDeleted).toBe(0);
    expect(report.buckets.avatars).toMatchObject({ candidates: 2, deleted: 0, sample: ['u/a.jpg', 'u/b.jpg'] });
    expect(removed).toEqual({});
  });

  it('delete mode removes exactly what the function listed', async () => {
    const { client, removed } = fakeClient({ avatars: ['u/a.jpg'], 'setup-photos': ['u/s.jpg'] });
    const report = await runStorageSweep(client, { mode: 'delete', now });
    expect(report.totalDeleted).toBe(2);
    expect(removed).toEqual({ avatars: ['u/a.jpg'], 'setup-photos': ['u/s.jpg'] });
  });

  it('uses a 24-hour cutoff and never asks for more than the remaining 500 budget', async () => {
    const many = Array.from({ length: 400 }, (_, i) => `u/${i}.jpg`);
    const { client, rpcCalls } = fakeClient({ avatars: many, 'business-banners': many, 'dm-photos': many });
    const report = await runStorageSweep(client, { mode: 'delete', now });
    expect(SWEEP_MAX_PER_RUN).toBe(500);
    expect(report.totalCandidates).toBe(500);
    expect(report.totalDeleted).toBe(500);
    expect(rpcCalls[0].p_created_before).toBe(
      new Date(now.getTime() - SWEEP_CUTOFF_HOURS * 3_600_000).toISOString(),
    );
    expect(rpcCalls.map((c) => c.p_limit)).toEqual([500, 100]);
  });

  it('refuses the whole run, before any call, if a preserved bucket is requested', async () => {
    const { client, rpcCalls } = fakeClient({});
    await expect(
      runStorageSweep(client, { mode: 'delete', now, buckets: ['avatars', 'images-held'] }),
    ).rejects.toThrow(/preserved/);
    await expect(
      runStorageSweep(client, { mode: 'delete', now, buckets: ['images-quarantine'] }),
    ).rejects.toThrow(/preserved/);
    expect(rpcCalls).toEqual([]);
  });

  it('records a listing error and carries on with the next bucket', async () => {
    const { client } = fakeClient({ 'dm-photos': ['u/c.jpg'] });
    const rpc = client.rpc as ReturnType<typeof vi.fn>;
    rpc.mockImplementationOnce(async () => ({ data: null, error: { message: 'boom' } }));
    const report = await runStorageSweep(client, { mode: 'dry-run', now });
    expect(report.buckets.avatars.error).toBe('boom');
    expect(report.buckets['dm-photos'].candidates).toBe(1);
  });
});
