/**
 * Orphaned-image sweeper core (A2, 20261013000000). Pure over an injected client
 * so src/test/storageSweep.test.ts drives it without a stack.
 *
 * WHAT IT DELETES. Objects in one of the eight public upload buckets that are older
 * than 24 hours and that no row references, as listed by the SQL function
 * public.storage_unreferenced_objects (whose "referenced" test is deliberately
 * over-inclusive). At most 500 per run across all buckets. Deletes go through the
 * Storage API, which removes the file, not only its row.
 *
 * WHAT IT NEVER TOUCHES. images-quarantine (REPORT Act one-year clock) and
 * images-held (photos a moderator has not ruled on). Refused here by name, and
 * refused again by the SQL function, independently.
 *
 * DRY RUN BY DEFAULT. Nothing is deleted unless STORAGE_SWEEP_MODE is exactly
 * "delete". The first production run is therefore a dry run by construction, and
 * deletes start only when an operator sets that variable after reviewing the counts.
 *
 * The bucket list is a hand-synced mirror (the API bundle cannot import
 * supabase/functions/_shared); the test pins it against both the shared registry
 * and the SQL allowlist.
 */

export const SWEEP_BUCKETS = [
  "avatars",
  "business-banners",
  "business-logos",
  "dm-photos",
  "dorm-photos",
  "marketplace-images",
  "roommate-post-photos",
  "setup-photos",
] as const;

export const NEVER_SWEPT = ["images-quarantine", "images-held"] as const;

export const SWEEP_CUTOFF_HOURS = 24;
export const SWEEP_MAX_PER_RUN = 500;
const SAMPLE_NAMES = 3;

export type SweepMode = "dry-run" | "delete";

export function sweepModeFromEnv(value: string | undefined): SweepMode {
  return value?.trim() === "delete" ? "delete" : "dry-run";
}

export function assertSweepable(bucket: string): void {
  if ((NEVER_SWEPT as readonly string[]).includes(bucket)) {
    throw new Error(`storage sweep: ${bucket} is a preserved bucket and is never swept`);
  }
  if (!(SWEEP_BUCKETS as readonly string[]).includes(bucket)) {
    throw new Error(`storage sweep: ${bucket} is not a sweepable public upload bucket`);
  }
}

export interface SweepClient {
  rpc(
    fn: "storage_unreferenced_objects",
    args: { p_bucket: string; p_created_before: string; p_limit: number },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
}

export interface BucketReport {
  candidates: number;
  deleted: number;
  sample: string[];
  error?: string;
}

export interface SweepReport {
  mode: SweepMode;
  cutoff: string;
  maxPerRun: number;
  totalCandidates: number;
  totalDeleted: number;
  buckets: Record<string, BucketReport>;
}

export async function runStorageSweep(
  client: SweepClient,
  {
    mode,
    now = new Date(),
    buckets = SWEEP_BUCKETS,
    maxPerRun = SWEEP_MAX_PER_RUN,
  }: {
    mode: SweepMode;
    now?: Date;
    buckets?: readonly string[];
    maxPerRun?: number;
  },
): Promise<SweepReport> {
  // Refuse the whole run before touching anything if any requested bucket is bad.
  for (const b of buckets) assertSweepable(b);
  const cap = Math.max(0, Math.min(maxPerRun, SWEEP_MAX_PER_RUN));
  const cutoff = new Date(now.getTime() - SWEEP_CUTOFF_HOURS * 3_600_000).toISOString();

  const report: SweepReport = {
    mode,
    cutoff,
    maxPerRun: cap,
    totalCandidates: 0,
    totalDeleted: 0,
    buckets: {},
  };

  for (const bucket of buckets) {
    const budget = cap - report.totalCandidates;
    if (budget <= 0) break;
    const entry: BucketReport = { candidates: 0, deleted: 0, sample: [] };
    report.buckets[bucket] = entry;

    const { data, error } = await client.rpc("storage_unreferenced_objects", {
      p_bucket: bucket,
      p_created_before: cutoff,
      p_limit: budget,
    });
    if (error) {
      entry.error = error.message;
      continue;
    }
    const names = (Array.isArray(data) ? data : [])
      .map((r) => (r as { name?: unknown })?.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0)
      .slice(0, budget);
    entry.candidates = names.length;
    entry.sample = names.slice(0, SAMPLE_NAMES);
    report.totalCandidates += names.length;

    if (mode !== "delete" || names.length === 0) continue;
    const { data: removed, error: rmErr } = await client.storage.from(bucket).remove(names);
    if (rmErr) {
      entry.error = rmErr.message;
      continue;
    }
    entry.deleted = Array.isArray(removed) ? removed.length : 0;
    report.totalDeleted += entry.deleted;
  }
  return report;
}
