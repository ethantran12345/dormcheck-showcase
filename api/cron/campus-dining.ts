import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  authorizeCron,
  campusToday,
  Cursor,
  Deadline,
  diningDateCode,
  isoDate,
  loadCursor,
  loadSources,
  recordRun,
  saveCursor,
  upsertChunked,
} from '../_lib/pittIngest.js';
import {
  DiningLocation,
  fetchDiningLocations,
  fetchDiningMenus,
  fetchDiningWeeklyHours,
  locationsFromHours,
} from '../_lib/pittSources.js';

/**
 * Dining locations, hours and menus. Vercel Cron, hourly.
 *
 * Locations and the weekly hours are cheap and refresh every run. Menus are not:
 * ~35 locations, each with retries against a provider that returns intermittent
 * 502s, which does not fit one invocation. So menus page through a cursor and
 * the sweep finishes across successive runs — hours (the thing every location
 * has) are never held hostage to menus (which ten locations never publish).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = authorizeCron(req, res);
  if (!db) return;

  const deadline = new Deadline(25_000);
  const today = campusToday();
  const serviceDate = isoDate(today);
  const dateCode = diningDateCode(today);
  const sources = await loadSources(db, 'dining');
  const summary: Record<string, unknown>[] = [];

  for (const source of sources) {
    const siteId = String(source.config.site_id ?? '');
    const result = await recordRun(db, source, async () => {
      if (!siteId) throw new Error('dining source config has no site_id');

      const observedAt = new Date().toISOString();
      const hours = await fetchDiningWeeklyHours(siteId, dateCode);

      // The status endpoint carries open/closed and the address, but it is
      // refused independently of the rest under this provider's IP rate limit.
      // The schedule payload already names every location, so fall back to it
      // rather than losing the whole ingest to one blocked path.
      let locations: DiningLocation[];
      let statusDegraded = false;
      try {
        locations = await fetchDiningLocations(siteId);
      } catch (error) {
        statusDegraded = true;
        locations = locationsFromHours(hours);
        console.warn(
          `[campus-dining] status endpoint unavailable (${error instanceof Error ? error.message : error}); using ${locations.length} locations from the schedule payload`,
        );
      }
      if (locations.length === 0) throw new Error('no dining locations from either endpoint');

      await upsertChunked(
        db,
        'campus_dining_locations',
        locations.map((location) => ({
          university_id: source.universityId,
          external_id: location.externalId,
          name: location.name,
          ...(statusDegraded
            ? {}
            : { is_open: location.isOpen, status_label: location.statusLabel, address: location.address }),
          observed_at: observedAt,
        })),
        'university_id,external_id',
      );

      const hourRows = await upsertChunked(
        db,
        'campus_dining_hours',
        hours.map((day) => ({
          university_id: source.universityId,
          location_name: day.locationName,
          service_date: day.date,
          intervals: day.intervals,
          observed_at: observedAt,
        })),
        'university_id,location_name,service_date',
      );

      // A new day restarts the menu sweep; within a day it resumes where it stopped.
      let cursor: Cursor = await loadCursor(db, source.universityId, 'dining', serviceDate);
      if (cursor.stage === 'done') {
        return { rowsWritten: hourRows, detail: { locations: locations.length, hours: hourRows, menus: 'already swept' } };
      }

      const startIndex = cursor.lastKey ? locations.findIndex((l) => l.externalId === cursor.lastKey) + 1 : 0;
      let processed = 0;
      let menusWritten = 0;
      let withMenu = 0;
      let withoutMenu = 0;
      let unavailable = 0;
      let index = startIndex;

      for (; index < locations.length; index++) {
        if (deadline.expired) break;
        const location = locations[index];
        const outcome = await fetchDiningMenus(location.externalId, dateCode);
        processed += 1;

        const { data: saved } = await db
          .from('campus_dining_locations')
          .select('id')
          .eq('university_id', source.universityId)
          .eq('external_id', location.externalId)
          .single();
        const locationId = (saved as { id: string } | null)?.id;
        if (!locationId) continue;

        if (outcome.kind === 'ok') {
          withMenu += 1;
          menusWritten += await upsertChunked(
            db,
            'campus_dining_menus',
            outcome.menus.map((menu) => ({
              university_id: source.universityId,
              location_id: locationId,
              service_date: serviceDate,
              period_name: menu.periodName,
              categories: menu.categories,
              item_count: menu.itemCount,
              observed_at: observedAt,
            })),
            'location_id,service_date,period_name',
          );
        } else if (outcome.kind === 'no_periods') {
          withoutMenu += 1;
        } else {
          unavailable += 1;
        }

        // has_menu is what lets the UI say "hours only" instead of rendering an
        // empty menu that reads as a bug. Only a definitive answer may set it:
        // the provider rate-limits by IP, and treating a temporary 403 as "no
        // menu" would quietly strip menus from locations that have them.
        if (outcome.kind !== 'unavailable') {
          await db
            .from('campus_dining_locations')
            .update({ has_menu: outcome.kind === 'ok' })
            .eq('id', locationId);
        }

        cursor = { ...cursor, lastKey: location.externalId };
      }

      cursor.stage = index >= locations.length ? 'done' : 'menus';
      await saveCursor(db, source.universityId, 'dining', cursor);

      return {
        rowsWritten: hourRows + menusWritten,
        detail: {
          locations: locations.length,
          hours: hourRows,
          statusDegraded,
          menusProcessed: processed,
          withMenu,
          withoutMenu,
          unavailable,
          stage: cursor.stage,
        },
      };
    });
    summary.push({ university: source.universitySlug, ...result });
  }

  return res.status(200).json({ ok: true, sources: summary });
}
