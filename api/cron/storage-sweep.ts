import { supabase } from "../_lib/supabase.js";
import {
  runStorageSweep,
  sweepModeFromEnv,
  type SweepClient,
} from "../_lib/storageSweep.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Orphaned-image sweeper (A2, 20261013000000). Daily Vercel Cron.
 *
 * Lists objects in the eight public upload buckets that are over 24 hours old and
 * referenced by no row, at most 500 per run, and deletes them through the Storage
 * API ONLY when STORAGE_SWEEP_MODE=delete. Any other value, or none, is a dry run
 * that reports the counts and deletes nothing. images-quarantine and images-held
 * are refused in this code and in the SQL function. Core: api/_lib/storageSweep.ts.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = req.headers.authorization ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(
    Array.isArray(header) ? header[0] : header
  )?.[1];
  if (!secret || token !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!supabase) {
    console.error("[storage-sweep] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
    return res.status(503).json({ error: "Service unavailable" });
  }

  const mode = sweepModeFromEnv(process.env.STORAGE_SWEEP_MODE);
  try {
    const report = await runStorageSweep(supabase as unknown as SweepClient, { mode });
    console.log(`[storage-sweep] ${JSON.stringify(report)}`);
    return res.status(200).json(report);
  } catch (e) {
    console.error("[storage-sweep] failed:", e);
    return res.status(500).json({ error: "Sweep failed" });
  }
}
