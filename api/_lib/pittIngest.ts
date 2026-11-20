/**
 * Shared plumbing for the campus data ingests.
 *
 * Every handler follows the same shape: authorize the cron caller, resolve the
 * per-university source config, do the work, and record the outcome in
 * campus_ingest_runs. That last step is not bookkeeping for its own sake — a
 * scheduled job that fails quietly looks exactly like one that had nothing to
 * do, so the row is what lets the UI show data age instead of implying freshness.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './supabase.js';

export type IngestSource = 'laundry' | 'dining' | 'calendar' | 'catalog';

export interface SourceConfig {
  universityId: string;
  universitySlug: string;
  source: IngestSource;
  config: Record<string, unknown>;
}

/**
 * The generated Database types do not know the campus_* tables yet: they are
 * created by migration 20261004000000, and src/integrations/supabase/types.ts is
 * regenerated only after a batch of migrations has been applied to prod (see
 * .claude/rules/supabase-backend.md). Until that regen lands, these handlers use
 * an untyped schema and get their safety from the row interfaces declared
 * alongside each query instead. Scope is deliberately limited to the ingest.
 */
// The generated Database types do not describe the campus_* tables until
// types.ts is regenerated after migration 20261004000000 reaches prod. An
// untyped schema here is deliberate and scoped; row shapes are asserted at
// each query instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, 'public', any>;

/**
 * Cron authorization. Vercel Cron sends the project's CRON_SECRET as a bearer
 * token; nothing else may trigger an ingest.
 */
export function authorizeCron(req: VercelRequest, res: VercelResponse): Db | null {
  const secret = process.env.CRON_SECRET?.trim();
  const header = req.headers.authorization ?? '';
  const token = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? header[0] : header)?.[1];
  if (!secret || token !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  if (!supabase) {
    console.error('[campus-ingest] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    res.status(503).json({ error: 'Service unavailable' });
    return null;
  }
  return supabase as unknown as Db;
}

/** Every enabled configuration for one source, across universities. */
export async function loadSources(db: Db, source: IngestSource): Promise<SourceConfig[]> {
  const { data, error } = await db
    .from('campus_data_sources')
    .select('university_id, source, config, universities!inner(slug)')
    .eq('source', source)
    .eq('is_enabled', true);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      university_id: string;
      source: IngestSource;
      config: Record<string, unknown>;
      universities: { slug: string } | { slug: string }[];
    };
    const university = Array.isArray(r.universities) ? r.universities[0] : r.universities;
    return {
      universityId: r.university_id,
      universitySlug: university?.slug ?? '',
      source: r.source,
      config: r.config ?? {},
    };
  });
}

export interface RunResult {
  rowsWritten: number;
  detail?: Record<string, unknown>;
}

/**
 * Run one source's ingest, recording start and outcome either way. A thrown
 * error is captured on the run row and rethrown to the caller, so a failure is
 * visible in the table and in the function log rather than only one of them.
 */
export async function recordRun(
  db: Db,
  source: SourceConfig,
  work: () => Promise<RunResult>,
): Promise<RunResult & { ok: boolean; error?: string }> {
  const { data: started } = await db
    .from('campus_ingest_runs')
    .insert({ university_id: source.universityId, source: source.source })
    .select('id')
    .single();
  const runId = (started as { id: string } | null)?.id;

  try {
    const result = await work();
    if (runId) {
      await db
        .from('campus_ingest_runs')
        .update({
          finished_at: new Date().toISOString(),
          ok: true,
          rows_written: result.rowsWritten,
          detail: result.detail ?? {},
        })
        .eq('id', runId);
    }
    return { ...result, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[campus-ingest:${source.source}] ${source.universitySlug}: ${message}`);
    if (runId) {
      await db
        .from('campus_ingest_runs')
        .update({ finished_at: new Date().toISOString(), ok: false, error: message.slice(0, 2000) })
        .eq('id', runId);
    }
    return { rowsWritten: 0, ok: false, error: message };
  }
}

/** YY-MM-DD, the format the dining provider expects. */
export function diningDateCode(date: Date): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** ISO calendar date in America/New_York, which is the campus's own day. */
export function campusToday(now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(get('year'), get('month') - 1, get('day'));
}

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Collapse rows that share the conflict key, keeping the last occurrence.
 *
 * Postgres refuses an INSERT ... ON CONFLICT DO UPDATE whose payload touches the
 * same row twice ("cannot affect row a second time"), and these feeds do publish
 * duplicates: LaundryView lists a stacked machine standalone and again inside its
 * pair, and Pitt's grades calendar carries two entries with the same date and
 * title. Deduping here means a duplicate upstream costs one row, not the run.
 */
export function dedupeByKey(rows: Record<string, unknown>[], onConflict: string): Record<string, unknown>[] {
  const columns = onConflict.split(',').map((column) => column.trim());
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    byKey.set(columns.map((column) => JSON.stringify(row[column] ?? null)).join('\u0000'), row);
  }
  return [...byKey.values()];
}

/** Upsert in chunks; PostgREST payload limits bite well before Pitt's row counts do. */
export async function upsertChunked(
  db: Db,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  chunkSize = 500,
): Promise<number> {
  const unique = dedupeByKey(rows, onConflict);
  let written = 0;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { error } = await db.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    written += chunk.length;
  }
  return written;
}

/**
 * Wall-clock budget. Serverless functions are killed at their timeout, and a
 * killed run leaves no outcome row — so every paging ingest stops itself early
 * and records progress instead of being cut off mid-write.
 */
export class Deadline {
  private readonly endsAt: number;
  constructor(budgetMs: number) {
    this.endsAt = Date.now() + budgetMs;
  }
  get expired(): boolean {
    return Date.now() >= this.endsAt;
  }
  get remainingMs(): number {
    return Math.max(0, this.endsAt - Date.now());
  }
}

export interface Cursor {
  scope: string;
  stage: string;
  lastKey: string | null;
}

export async function loadCursor(
  db: Db,
  universityId: string,
  source: IngestSource,
  scope: string,
): Promise<Cursor> {
  const { data } = await db
    .from('campus_ingest_cursor')
    .select('scope, stage, last_key')
    .eq('university_id', universityId)
    .eq('source', source)
    .eq('scope', scope)
    .maybeSingle();
  const row = data as { scope: string; stage: string; last_key: string | null } | null;
  return row ? { scope: row.scope, stage: row.stage, lastKey: row.last_key } : { scope, stage: 'start', lastKey: null };
}

export async function saveCursor(
  db: Db,
  universityId: string,
  source: IngestSource,
  cursor: Cursor,
): Promise<void> {
  const { error } = await db.from('campus_ingest_cursor').upsert(
    {
      university_id: universityId,
      source,
      scope: cursor.scope,
      stage: cursor.stage,
      last_key: cursor.lastKey,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'university_id,source,scope' },
  );
  if (error) throw new Error(`campus_ingest_cursor: ${error.message}`);
}
