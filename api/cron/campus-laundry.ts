import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  authorizeCron,
  Deadline,
  loadSources,
  recordRun,
  upsertChunked,
} from '../_lib/pittIngest.js';
import {
  fetchLaundryMachines,
  fetchLaundryRooms,
  matchResidenceHall,
  normalizeRoomName,
} from '../_lib/pittSources.js';

/**
 * Laundry machine status. Vercel Cron, every 15 minutes.
 *
 * Small enough to finish in one pass (Pitt publishes 8 rooms), but still guarded
 * by a deadline so a slow upstream degrades to partial progress rather than a
 * killed invocation with no outcome row.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = authorizeCron(req, res);
  if (!db) return;

  const deadline = new Deadline(20_000);
  const sources = await loadSources(db, 'laundry');
  const summary: Record<string, unknown>[] = [];

  for (const source of sources) {
    const schoolId = String(source.config.school_id ?? '');
    const result = await recordRun(db, source, async () => {
      if (!schoolId) throw new Error('laundry source config has no school_id');

      // Halls we actually model, so an upstream room can be attached to one.
      const { data: hallRows } = await db
        .from('master_housing')
        .select('residence_hall')
        .eq('university_id', source.universityId);
      const knownHalls = [
        ...new Set(
          (hallRows ?? [])
            .map((row) => String((row as { residence_hall: string | null }).residence_hall ?? '').trim())
            .filter(Boolean),
        ),
      ];

      // Curated provider-name -> hall corrections, held as config so a fix is a
      // row edit rather than a deploy. Matching is exact by design; see
      // matchResidenceHall for why a similarity heuristic is not used.
      const rawAliases = source.config.hall_aliases;
      const hallAliases: Record<string, string> =
        rawAliases && typeof rawAliases === 'object' && !Array.isArray(rawAliases)
          ? Object.fromEntries(
              Object.entries(rawAliases as Record<string, unknown>)
                .filter(([, value]) => typeof value === 'string')
                .map(([key, value]) => [key.toLowerCase(), value as string]),
            )
          : {};

      const rooms = await fetchLaundryRooms(schoolId);
      const observedAt = new Date().toISOString();
      let machineRows = 0;
      let unmatched = 0;

      for (const room of rooms) {
        if (deadline.expired) break;
        const machines = await fetchLaundryMachines(schoolId, room.externalId);
        const counts = {
          total_washers: machines.filter((m) => m.machineType !== 'dryer').length,
          total_dryers: machines.filter((m) => m.machineType === 'dryer').length,
          free_washers: machines.filter((m) => m.machineType !== 'dryer' && m.status === 'available').length,
          free_dryers: machines.filter((m) => m.machineType === 'dryer' && m.status === 'available').length,
        };
        const hall = matchResidenceHall(normalizeRoomName(room.name), knownHalls, hallAliases);
        if (!hall) unmatched += 1;

        const { data: saved, error } = await db
          .from('campus_laundry_rooms')
          .upsert(
            {
              university_id: source.universityId,
              external_id: room.externalId,
              upstream_name: room.name,
              residence_hall: hall,
              campus: room.campus,
              observed_at: observedAt,
              ...counts,
            },
            { onConflict: 'university_id,external_id' },
          )
          .select('id')
          .single();
        if (error) throw new Error(`campus_laundry_rooms: ${error.message}`);

        const roomId = (saved as { id: string }).id;
        machineRows += await upsertChunked(
          db,
          'campus_laundry_machines',
          machines
            .filter((machine) => machine.externalId)
            .map((machine) => ({
              university_id: source.universityId,
              room_id: roomId,
              external_id: machine.externalId,
              label: machine.label,
              machine_type: machine.machineType,
              status: machine.status,
              status_message: machine.statusMessage,
              minutes_remaining: machine.minutesRemaining,
              cycle_progress_percent: machine.cycleProgressPercent,
              is_stacked: machine.isStacked,
              observed_at: observedAt,
            })),
          'room_id,external_id',
        );
      }

      return {
        rowsWritten: machineRows,
        detail: { rooms: rooms.length, machines: machineRows, unmatchedRooms: unmatched },
      };
    });
    summary.push({ university: source.universitySlug, ...result });
  }

  return res.status(200).json({ ok: true, sources: summary });
}
