import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authorizeCron, loadSources, recordRun, upsertChunked } from '../_lib/pittIngest.js';
import { CALENDAR_FEEDS, CalendarKind, fetchCalendar } from '../_lib/pittSources.js';

/**
 * Academic calendar. Vercel Cron, weekly (Mondays 11:00 UTC).
 *
 * Five static JSON feeds, a few hundred events total. These replace the class of
 * staleness the 2026-07 Pitt Resources crawl found — live Pitt pages still
 * showing 2022 and 2025 deadlines — so the app's dates track the registrar's.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = authorizeCron(req, res);
  if (!db) return;

  const sources = await loadSources(db, 'calendar');
  const summary: Record<string, unknown>[] = [];

  for (const source of sources) {
    const prefix = String(source.config.prefix ?? '');
    const result = await recordRun(db, source, async () => {
      if (!prefix) throw new Error('calendar source config has no prefix');
      const observedAt = new Date().toISOString();
      const perCalendar: Record<string, number> = {};
      const failures: Record<string, string> = {};
      let written = 0;

      for (const kind of Object.keys(CALENDAR_FEEDS) as CalendarKind[]) {
        try {
          const events = await fetchCalendar(prefix, kind);
          perCalendar[kind] = events.length;
          written += await upsertChunked(
            db,
            'campus_academic_events',
            events.map((event) => ({
              university_id: source.universityId,
              calendar: event.calendar,
              event_date: event.date,
              title: event.title,
              content: event.content,
              categories: event.categories,
              observed_at: observedAt,
            })),
            'university_id,calendar,event_date,title',
          );
        } catch (error) {
          // One dead feed should not cost the other four.
          failures[kind] = error instanceof Error ? error.message : String(error);
        }
      }

      if (Object.keys(failures).length === Object.keys(CALENDAR_FEEDS).length) {
        throw new Error(`every calendar feed failed: ${JSON.stringify(failures)}`);
      }
      return { rowsWritten: written, detail: { perCalendar, failures } };
    });
    summary.push({ university: source.universitySlug, ...result });
  }

  return res.status(200).json({ ok: true, sources: summary });
}
